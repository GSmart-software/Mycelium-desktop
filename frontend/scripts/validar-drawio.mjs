#!/usr/bin/env node
// Validador estático de diagramas `.drawio` (`FUN-L-26`, parte B).
//
// Comprueba lo que se puede medir sin mirar el dibujo: que el XML esté bien
// formado, que el modelo de mxGraph sea coherente (celdas raíz, ids, `parent`,
// extremos de las aristas) y que la disposición sea legible (cajas encimadas,
// hijos fuera de su contenedor, texto que no entra, aristas que atraviesan cajas,
// que se cruzan o corren una encima de otra, o que tachan una etiqueta externa).
// Es la herramienta con la que la IA verifica lo que escribió; la skill
// `mycelium-drawio` explica cómo leer su salida.
//
// En el vault del usuario viaja con la skill y se corre desde la raíz del vault:
//
//   node .claude/skills/mycelium-drawio/validar-drawio.mjs <archivo.drawio>...
//        → lista errores y avisos; sale con código 1 si hay algún error
//   node .claude/skills/mycelium-drawio/validar-drawio.mjs --mapa <archivo.drawio>
//        → además imprime cada figura con su posición ABSOLUTA, su tamaño, su
//          contenedor (y la x,y relativa que va en el XML), las aristas y el
//          lugar libre: es lo que se mira antes de modificar un diagrama
//   node .claude/skills/mycelium-drawio/validar-drawio.mjs --json <archivo.drawio>
//        → el mismo resultado (problemas y mapa) en JSON, para otro programa
//
// En este repo vive en `frontend/scripts/validar-drawio.mjs`.
//
// > OJO: sin dependencias a propósito. Viaja con la skill al vault del usuario,
// > donde no hay `node_modules`: solo Node 20 y sus módulos propios.

import { readFileSync } from "node:fs";
import { inflateRawSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

// ── XML: un parser mínimo, estricto en lo que draw.io exige ─────────────────

const ENTIDADES = { lt: "<", gt: ">", amp: "&", quot: '"', apos: "'" };

class ErrorXml extends Error {
  constructor(mensaje, linea, columna) {
    super(`${mensaje} (línea ${linea}, columna ${columna})`);
    this.linea = linea;
    this.columna = columna;
  }
}

/** Decodifica entidades XML; `&` suelto o desconocido es error, como en draw.io. */
function decodificar(texto, pos, ubicar) {
  return texto.replace(/&([^;&\s<]{0,12});?/g, (m, nombre, off) => {
    if (!m.endsWith(";")) {
      const [l, c] = ubicar(pos + off);
      throw new ErrorXml(`«&» sin escapar: escribí «&amp;»`, l, c);
    }
    if (nombre[0] === "#") {
      const n = nombre[1] === "x" || nombre[1] === "X"
        ? parseInt(nombre.slice(2), 16)
        : parseInt(nombre.slice(1), 10);
      if (!Number.isFinite(n)) {
        const [l, c] = ubicar(pos + off);
        throw new ErrorXml(`referencia numérica inválida «${m}»`, l, c);
      }
      return String.fromCodePoint(n);
    }
    if (!(nombre in ENTIDADES)) {
      const [l, c] = ubicar(pos + off);
      throw new ErrorXml(
        `entidad desconocida «${m}» (en XML solo existen &lt; &gt; &amp; &quot; &apos; y las numéricas; &nbsp; va como &amp;nbsp; dentro de un valor HTML)`,
        l,
        c,
      );
    }
    return ENTIDADES[nombre];
  });
}

/**
 * Parsea XML a un árbol `{ nombre, attrs, hijos, texto }`.
 * Lanza `ErrorXml` con línea y columna ante cualquier cosa mal formada.
 */
export function parsearXml(fuente) {
  const src = fuente.replace(/^﻿/, "");
  const saltos = [];
  for (let i = 0; i < src.length; i++) if (src[i] === "\n") saltos.push(i);
  const ubicar = (pos) => {
    let lo = 0;
    let hi = saltos.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (saltos[mid] < pos) lo = mid + 1;
      else hi = mid;
    }
    const inicio = lo === 0 ? 0 : saltos[lo - 1] + 1;
    return [lo + 1, pos - inicio + 1];
  };
  const fallar = (msg, pos) => {
    const [l, c] = ubicar(pos);
    throw new ErrorXml(msg, l, c);
  };

  const raizFicticia = { nombre: "#doc", attrs: {}, hijos: [], texto: "" };
  const pila = [raizFicticia];
  let i = 0;
  let raices = 0;
  const reNombre = /[A-Za-z_:][\w.:-]*/y;

  while (i < src.length) {
    const lt = src.indexOf("<", i);
    const finTexto = lt === -1 ? src.length : lt;
    if (finTexto > i) {
      const texto = src.slice(i, finTexto);
      if (texto.includes(">") && pila.length > 1) {
        // `>` suelto en texto es válido en XML; no se reporta.
      }
      if (pila.length === 1 && texto.trim() !== "") fallar("texto fuera del elemento raíz", i);
      if (pila.length > 1) pila[pila.length - 1].texto += decodificar(texto, i, ubicar);
    }
    if (lt === -1) break;
    i = lt;
    if (src.startsWith("<!--", i)) {
      const fin = src.indexOf("-->", i + 4);
      if (fin === -1) fallar("comentario sin cerrar", i);
      i = fin + 3;
      continue;
    }
    if (src.startsWith("<![CDATA[", i)) {
      const fin = src.indexOf("]]>", i);
      if (fin === -1) fallar("CDATA sin cerrar", i);
      if (pila.length > 1) pila[pila.length - 1].texto += src.slice(i + 9, fin);
      i = fin + 3;
      continue;
    }
    if (src.startsWith("<?", i)) {
      const fin = src.indexOf("?>", i);
      if (fin === -1) fallar("instrucción <? sin cerrar", i);
      i = fin + 2;
      continue;
    }
    if (src.startsWith("<!", i)) {
      const fin = src.indexOf(">", i);
      if (fin === -1) fallar("declaración <! sin cerrar", i);
      i = fin + 1;
      continue;
    }
    if (src[i + 1] === "/") {
      reNombre.lastIndex = i + 2;
      const m = reNombre.exec(src);
      if (!m) fallar("etiqueta de cierre sin nombre", i);
      const fin = src.indexOf(">", i);
      if (fin === -1 || src.slice(i + 2 + m[0].length, fin).trim() !== "")
        fallar(`etiqueta de cierre </${m[0]}> mal formada`, i);
      const abierto = pila[pila.length - 1];
      if (pila.length === 1) fallar(`</${m[0]}> no cierra nada`, i);
      if (abierto.nombre !== m[0])
        fallar(`</${m[0]}> cierra a <${abierto.nombre}> (abierta en la línea ${abierto.linea})`, i);
      pila.pop();
      i = fin + 1;
      continue;
    }
    // Etiqueta de apertura.
    reNombre.lastIndex = i + 1;
    const m = reNombre.exec(src);
    if (!m) fallar("«<» suelto: dentro de un texto o valor se escribe «&lt;»", i);
    const nodo = { nombre: m[0], attrs: {}, hijos: [], texto: "", linea: ubicar(i)[0] };
    let j = i + 1 + m[0].length;
    let cerrada = false;
    for (;;) {
      while (j < src.length && /\s/.test(src[j])) j++;
      if (j >= src.length) fallar(`<${nodo.nombre}> sin cerrar`, i);
      if (src[j] === ">") {
        j++;
        break;
      }
      if (src[j] === "/" && src[j + 1] === ">") {
        j += 2;
        cerrada = true;
        break;
      }
      reNombre.lastIndex = j;
      const a = reNombre.exec(src);
      if (!a) fallar(`atributo inválido en <${nodo.nombre}>`, j);
      j += a[0].length;
      while (/\s/.test(src[j])) j++;
      if (src[j] !== "=") fallar(`al atributo «${a[0]}» le falta «=»`, j);
      j++;
      while (/\s/.test(src[j])) j++;
      const q = src[j];
      if (q !== '"' && q !== "'") fallar(`el valor de «${a[0]}» va entre comillas`, j);
      const finV = src.indexOf(q, j + 1);
      if (finV === -1) fallar(`el valor de «${a[0]}» no cierra sus comillas`, j);
      const crudo = src.slice(j + 1, finV);
      const lt2 = crudo.indexOf("<");
      if (lt2 !== -1)
        fallar(`«<» sin escapar en el atributo «${a[0]}»: escribí «&lt;»`, j + 1 + lt2);
      if (a[0] in nodo.attrs) fallar(`atributo «${a[0]}» repetido en <${nodo.nombre}>`, j);
      nodo.attrs[a[0]] = decodificar(crudo, j + 1, ubicar);
      j = finV + 1;
      if (!/[\s/>]/.test(src[j] ?? "")) fallar(`falta un espacio después del atributo «${a[0]}»`, j);
    }
    const padre = pila[pila.length - 1];
    if (pila.length === 1) {
      raices++;
      if (raices > 1) fallar("hay más de un elemento raíz", i);
    }
    padre.hijos.push(nodo);
    if (!cerrada) pila.push(nodo);
    i = j;
  }
  if (pila.length > 1) {
    const abierto = pila[pila.length - 1];
    throw new ErrorXml(`<${abierto.nombre}> nunca se cierra`, abierto.linea, 1);
  }
  if (raices === 0) throw new ErrorXml("el archivo no tiene ningún elemento", 1, 1);
  return raizFicticia.hijos[0];
}

// ── Estilos y medidas ─────────────────────────────────────────────────────────

/** `"rounded=1;whiteSpace=wrap;swimlane"` → `{ rounded: "1", …, _nombres: ["swimlane"] }`. */
export function parsearEstilo(estilo = "") {
  const out = { _nombres: [] };
  for (const parte of estilo.split(";")) {
    const p = parte.trim();
    if (!p) continue;
    const eq = p.indexOf("=");
    if (eq === -1) out._nombres.push(p);
    else out[p.slice(0, eq)] = p.slice(eq + 1);
  }
  return out;
}

const num = (v, def) => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : def;
};

/** Forma efectiva de una celda: `shape=` o el estilo con nombre que la define. */
function formaDe(est) {
  if (est.shape) return est.shape;
  for (const n of est._nombres) {
    if (["rhombus", "ellipse", "swimlane", "text", "triangle", "hexagon", "cylinder", "label", "group"].includes(n))
      return n;
  }
  return "rectangle";
}

function esContenedor(est) {
  const f = formaDe(est);
  return (
    est.container === "1" ||
    f === "swimlane" ||
    f === "table" ||
    f === "tableRow" ||
    est._nombres.includes("group") ||
    est.childLayout !== undefined
  );
}

/** Alto del encabezado de un contenedor con título (swimlane, tabla). */
function encabezadoDe(est) {
  const f = formaDe(est);
  if (f !== "swimlane" && f !== "table") return 0;
  if (est.startSize !== undefined) return num(est.startSize, 0);
  // El estilo con nombre `swimlane` del stylesheet de draw.io trae 23; la forma
  // pelada (`shape=swimlane`) usa el default de mxGraph, 40.
  if (est._nombres.includes("swimlane")) return 23;
  return f === "table" ? 0 : 40;
}

/**
 * Ancho estimado de un texto en px. Calibrado contra Helvetica/Arial en
 * Chromium: minúsculas ~0,49 em, mayúsculas y dígitos ~0,66 em, angostas ~0,28 em.
 */
export function anchoTexto(texto, fontSize = 12, negrita = false) {
  let em = 0;
  for (const ch of texto) {
    if (ch === " " || ch === " ") em += 0.28;
    else if ("iljtfrI.,;:'!|()[]".includes(ch)) em += 0.3;
    else if ("mwMW@%".includes(ch)) em += 0.85;
    else if (/[A-ZÁÉÍÓÚÑÜ0-9]/.test(ch)) em += 0.66;
    else em += 0.5;
  }
  return em * fontSize * (negrita ? 1.08 : 1);
}

/** Entidades HTML que importan al medir; cualquier otra cuenta como un carácter. */
const ENTIDADES_HTML = { nbsp: " ", lt: "<", gt: ">", amp: "&", quot: '"', apos: "'" };

/**
 * Texto visible de una etiqueta (HTML si `html=1`). Llega ya decodificado del
 * XML: el `&amp;gt;` del archivo es acá `&gt;`, una entidad HTML que el
 * navegador muestra como UN carácter, y así se cuenta. Se decodifica en una
 * sola pasada para que `&amp;lt;` (que se ve «&lt;») no se decodifique dos veces.
 */
export function textoVisible(valor, esHtml) {
  if (!esHtml) return valor;
  return valor
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(div|p|li|h\d|tr)>/gi, "\n")
    .replace(/<\/?[A-Za-z][^>]*>/g, "")
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/gi, (m, n) => {
      if (n[0] === "#") {
        const cp = n[1] === "x" || n[1] === "X" ? parseInt(n.slice(2), 16) : parseInt(n.slice(1), 10);
        return Number.isFinite(cp) && cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : m;
      }
      return ENTIDADES_HTML[n.toLowerCase()] ?? "•";
    })
    .replace(/\n+$/, "");
}

/**
 * Con `html=1`, un `<` seguido de una letra y sin `>` después abre una etiqueta
 * que nunca cierra: el navegador se come todo lo que sigue (comprobado: «a &lt;b
 * (x)» se ve «a»). Devuelve el fragmento culpable, o `null`.
 */
export function menorSinEscapar(valor, esHtml) {
  if (!esHtml) return null;
  const m = /<\/?[A-Za-z][^>]*$/.exec(valor);
  return m ? m[0].slice(0, 20) : null;
}

/** Parte en líneas como lo hace el navegador con `white-space: normal`. */
function envolver(linea, anchoMax, fontSize, negrita) {
  // Un &nbsp; no parte la línea: solo se corta en los espacios comunes.
  const palabras = linea.split(/[ \t\r\n]+/).filter(Boolean);
  const lineas = [];
  let actual = "";
  for (const p of palabras) {
    const prueba = actual ? `${actual} ${p}` : p;
    if (actual && anchoTexto(prueba, fontSize, negrita) > anchoMax) {
      lineas.push(actual);
      actual = p;
    } else actual = prueba;
  }
  if (actual || lineas.length === 0) lineas.push(actual);
  return lineas;
}

/**
 * ¿Entra la etiqueta en su caja? Devuelve `null` si entra, o un motivo.
 * Modela lo que hace draw.io: con `whiteSpace=wrap` parte las líneas al ancho
 * de la caja (menos `spacing`); sin él, cada línea va entera.
 */
export function motivoTextoNoCabe(valor, est, w, h) {
  const esHtml = est.html === "1";
  if (esHtml && /<(table|img|svg)\b/i.test(valor)) return null; // no se puede estimar
  // Etiqueta afuera de la figura (íconos, actores, eventos): no ocupa la caja.
  const afuera = (v) => v !== undefined && v !== "center" && v !== "middle";
  if (afuera(est.verticalLabelPosition) || afuera(est.labelPosition)) return null;
  const texto = textoVisible(valor, esHtml).trim();
  if (!texto) return null;
  const fontSize = num(est.fontSize, 12);
  const negrita = (num(est.fontStyle, 0) & 1) === 1;
  const sp = num(est.spacing, 2);
  const anchoUtil = w - 2 * sp - num(est.spacingLeft, 0) - num(est.spacingRight, 0);
  const forma = formaDe(est);
  const envuelve = est.whiteSpace === "wrap";
  const cab = encabezadoDe(est);
  const altoUtil = (cab > 0 ? cab : h) - 2 * sp - num(est.spacingTop, 0) - num(est.spacingBottom, 0);
  // Contenedores sin encabezado (un grupo, un rectángulo con container=1): la
  // etiqueta va arriba y el resto es para los hijos; solo se mira el ancho.
  const soloAncho = cab === 0 && esContenedor(est);

  const lineas = [];
  for (const l of texto.split("\n")) {
    if (envuelve) lineas.push(...envolver(l, anchoUtil, fontSize, negrita));
    else lineas.push(l);
  }
  const anchos = lineas.map((l) => anchoTexto(l, fontSize, negrita));
  const maxAncho = Math.max(...anchos);
  const altoTexto = lineas.length * fontSize * 1.2;
  const tol = 1;

  if (maxAncho > anchoUtil + tol) {
    const larga = lineas[anchos.indexOf(maxAncho)];
    return envuelve
      ? `la palabra «${larga.slice(0, 30)}» (~${Math.round(maxAncho)} px) no entra en el ancho útil de ${Math.round(anchoUtil)} px`
      : `la línea «${larga.slice(0, 40)}» mide ~${Math.round(maxAncho)} px y la caja deja ${Math.round(anchoUtil)} px (sin whiteSpace=wrap no se parte)`;
  }
  if (!soloAncho && altoTexto > altoUtil + tol) {
    return `${lineas.length} línea(s) a ${fontSize}px necesitan ~${Math.round(altoTexto)} px de alto y ${cab > 0 ? "el encabezado" : "la caja"} deja ${Math.round(altoUtil)} px`;
  }
  // Rombos y elipses: draw.io parte al ancho de la CAJA, pero la figura es más
  // angosta arriba y abajo. Se mide el ancho de la figura a la altura del
  // renglón más alejado del centro.
  if (forma === "rhombus" || forma === "ellipse") {
    const d = altoTexto / 2 / (h / 2); // fracción del semialto ocupada por el texto
    if (d >= 1) return `el texto (${lineas.length} líneas) es más alto que la figura`;
    const factor = forma === "rhombus" ? 1 - d : Math.sqrt(1 - d * d);
    const anchoFigura = w * factor - 8;
    if (maxAncho > anchoFigura + tol) {
      return `en ${forma === "rhombus" ? "el rombo" : "la elipse"} el texto se sale del contorno: el renglón más ancho mide ~${Math.round(maxAncho)} px y la figura deja ~${Math.round(anchoFigura)} px a esa altura (agrandala: en un rombo, width = max(180, caracteres de la línea más larga × 10 + 40))`;
    }
  }
  return null;
}

// ── Geometría ────────────────────────────────────────────────────────────────

const interseca = (a, b, margen = 0) =>
  a.x < b.x + b.w - margen && b.x < a.x + a.w - margen && a.y < b.y + b.h - margen && b.y < a.y + a.h - margen;

const contiene = (a, b) => a.x <= b.x && a.y <= b.y && a.x + a.w >= b.x + b.w && a.y + a.h >= b.y + b.h;

/** ¿El segmento p→q atraviesa el interior del rectángulo r? (Liang-Barsky) */
function segmentoCruza(p, q, r) {
  const m = 2; // se tolera rozar el borde
  const xmin = r.x + m;
  const xmax = r.x + r.w - m;
  const ymin = r.y + m;
  const ymax = r.y + r.h - m;
  if (xmax <= xmin || ymax <= ymin) return false;
  let t0 = 0;
  let t1 = 1;
  const dx = q.x - p.x;
  const dy = q.y - p.y;
  const bordes = [
    [-dx, p.x - xmin],
    [dx, xmax - p.x],
    [-dy, p.y - ymin],
    [dy, ymax - p.y],
  ];
  for (const [pp, qq] of bordes) {
    if (pp === 0) {
      if (qq < 0) return false;
    } else {
      const t = qq / pp;
      if (pp < 0) {
        if (t > t1) return false;
        if (t > t0) t0 = t;
      } else {
        if (t < t0) return false;
        if (t < t1) t1 = t;
      }
    }
  }
  return t1 - t0 > 1e-6;
}

const centro = (r) => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });

/**
 * Punto donde los segmentos p1→p2 y q1→q2 se cruzan de verdad (en el interior
 * de los dos, a más de 1 px de cada punta), o `null`. Paralelos y colineales no
 * cuentan: dos flechas que comparten un tramo (el «peine» de un árbol, un
 * empalme) se funden, no se cruzan; y una que termina sobre otra es un empalme.
 */
function cruceDeSegmentos(p1, p2, q1, q2) {
  const rx = p2.x - p1.x;
  const ry = p2.y - p1.y;
  const sx = q2.x - q1.x;
  const sy = q2.y - q1.y;
  const d = rx * sy - ry * sx;
  const l1 = Math.hypot(rx, ry);
  const l2 = Math.hypot(sx, sy);
  if (l1 < 1 || l2 < 1 || Math.abs(d) < 1e-9 * l1 * l2) return null;
  const qx = q1.x - p1.x;
  const qy = q1.y - p1.y;
  const t = (qx * sy - qy * sx) / d;
  const u = (qx * ry - qy * rx) / d;
  if (t * l1 <= 1 || (1 - t) * l1 <= 1 || u * l2 <= 1 || (1 - u) * l2 <= 1) return null;
  return { x: Math.round(p1.x + t * rx), y: Math.round(p1.y + t * ry) };
}

/**
 * Recorta la punta de una ruta que arranca adentro de su caja (sin puerto, el
 * recorrido sale del centro) hasta el borde: así dos flechas que salen del
 * mismo lado de la misma caja arrancan en el mismo punto, como en el dibujo.
 */
function recortarAlBorde(ruta, r) {
  const dentro = (p) => p.x > r.x && p.x < r.x + r.w && p.y > r.y && p.y < r.y + r.h;
  const out = ruta.slice();
  while (out.length > 1 && dentro(out[0])) {
    const [p, q] = out;
    if (dentro(q)) {
      out.shift();
      continue;
    }
    const ts = [];
    if (q.x !== p.x) ts.push(((q.x > p.x ? r.x + r.w : r.x) - p.x) / (q.x - p.x));
    if (q.y !== p.y) ts.push(((q.y > p.y ? r.y + r.h : r.y) - p.y) / (q.y - p.y));
    const t = Math.min(...ts.filter((x) => x >= 0));
    out[0] = { x: p.x + t * (q.x - p.x), y: p.y + t * (q.y - p.y) };
  }
  return out;
}

/**
 * Tramo que comparten dos segmentos horizontales (o verticales) sobre la misma
 * línea, si mide más de 5 px: `{ x, y, largo }` en su punto medio, o `null`.
 */
function tramoComun(p1, p2, q1, q2) {
  const horiz = (a, b) => Math.abs(a.y - b.y) < 1 && Math.abs(a.x - b.x) >= 1;
  const vert = (a, b) => Math.abs(a.x - b.x) < 1 && Math.abs(a.y - b.y) >= 1;
  for (const [es, k, o] of [[horiz, "x", "y"], [vert, "y", "x"]]) {
    if (!es(p1, p2) || !es(q1, q2) || Math.abs(p1[o] - q1[o]) >= 1) continue;
    const ini = Math.max(Math.min(p1[k], p2[k]), Math.min(q1[k], q2[k]));
    const fin = Math.min(Math.max(p1[k], p2[k]), Math.max(q1[k], q2[k]));
    if (fin - ini > 5) return { [k]: Math.round((ini + fin) / 2), [o]: Math.round(p1[o]), largo: Math.round(fin - ini) };
  }
  return null;
}

/**
 * Rectángulo que ocupa una etiqueta EXTERNA (íconos, actores: la etiqueta va
 * abajo, arriba o a un costado de la figura), o `null` si la etiqueta va
 * adentro. draw.io la pone en una caja del tamaño de la figura corrida hacia
 * ese lado, y adentro la alinea con `align`/`verticalAlign`.
 */
function rectEtiquetaExterna(valor, est, r) {
  const vp = est.verticalLabelPosition ?? "middle";
  const lp = est.labelPosition ?? "center";
  if ((vp === "middle" || vp === "center") && lp === "center") return null;
  const texto = textoVisible(valor, est.html === "1").trim();
  if (!texto) return null;
  const fontSize = num(est.fontSize, 12);
  const negrita = (num(est.fontStyle, 0) & 1) === 1;
  const lineas = [];
  for (const l of texto.split("\n"))
    if (est.whiteSpace === "wrap") lineas.push(...envolver(l, r.w - 4, fontSize, negrita));
    else lineas.push(l);
  const tw = Math.max(...lineas.map((l) => anchoTexto(l, fontSize, negrita)));
  const th = lineas.length * fontSize * 1.2;
  const caja = {
    x: r.x + (lp === "right" ? r.w : lp === "left" ? -r.w : 0),
    y: r.y + (vp === "bottom" ? r.h : vp === "top" ? -r.h : 0),
  };
  const align = est.align ?? "center";
  const valign = est.verticalAlign ?? "middle";
  const sp = num(est.spacing, 2);
  const x = align === "left" ? caja.x + sp : align === "right" ? caja.x + r.w - sp - tw : caja.x + (r.w - tw) / 2;
  const y = valign === "top" ? caja.y + sp : valign === "bottom" ? caja.y + r.h - sp - th : caja.y + (r.h - th) / 2;
  const lado = vp === "bottom" ? "abajo" : vp === "top" ? "arriba" : lp === "right" ? "a la derecha" : "a la izquierda";
  return { x, y, w: tw, h: th, lado };
}

/** Punto del borde de `r` indicado por un puerto relativo (exitX/exitY…). */
function puerto(r, px, py) {
  return { x: r.x + r.w * px, y: r.y + r.h * py };
}

/** Lado de salida de un puerto: "h" (izquierda/derecha) o "v" (arriba/abajo). */
function ejeDePuerto(px, py) {
  if (px === 0 || px === 1) return "h";
  if (py === 0 || py === 1) return "v";
  return null;
}

/**
 * Aproximación del recorrido que dibuja draw.io para una arista, en coordenadas
 * absolutas. No es el router exacto: alcanza para advertir de cruces groseros.
 */
function recorrido(arista, rs, rt, puntosAbs) {
  const est = arista.est;
  const exit = est.exitX !== undefined && est.exitY !== undefined ? [num(est.exitX, 0.5), num(est.exitY, 0.5)] : null;
  const entry = est.entryX !== undefined && est.entryY !== undefined ? [num(est.entryX, 0.5), num(est.entryY, 0.5)] : null;
  const cs = centro(rs);
  const ct = centro(rt);
  const ini = exit ? puerto(rs, ...exit) : cs;
  const fin = entry ? puerto(rt, ...entry) : ct;
  const estilo = est.edgeStyle ?? "";
  const ortogonal = /orthogonal|elbow|entityRelation/i.test(estilo);

  if (puntosAbs.length > 0) {
    const pts = [ini, ...puntosAbs, fin];
    if (!ortogonal) return pts;
    const out = [pts[0]];
    for (let k = 1; k < pts.length; k++) {
      const a = out[out.length - 1];
      const b = pts[k];
      if (a.x !== b.x && a.y !== b.y) out.push({ x: b.x, y: a.y });
      out.push(b);
    }
    return out;
  }
  if (!ortogonal) return [ini, fin];

  if (/entityRelation/i.test(estilo)) {
    // Lo que hace `mxEdgeStyle.EntityRelation` (comprobado en el draw.io
    // empaquetado): sale por la izquierda solo si el destino queda ENTERO a la
    // izquierda del origen, y entra por la izquierda solo si el origen queda
    // entero a la izquierda del destino. Con tablas apiladas, sale y entra por
    // la derecha. Hace un tramo de 30 px hacia afuera en cada punta y los une en
    // línea recta. Un puerto fijado (exitX/entryX) mueve la punta pero no el
    // sentido del tramo, y la línea termina cruzando la tabla.
    const p0 = exit ? ini : null;
    const pe = entry ? fin : null;
    const izqS = (pe ? pe.x : rt.x + rt.w) < (p0 ? p0.x : rs.x);
    const izqT = (p0 ? p0.x : rs.x + rs.w) < (pe ? pe.x : rt.x);
    const s = p0 ?? { x: izqS ? rs.x : rs.x + rs.w, y: cs.y };
    const t = pe ?? { x: izqT ? rt.x : rt.x + rt.w, y: ct.y };
    const seg = 30;
    return [s, { x: s.x + (izqS ? -seg : seg), y: s.y }, { x: t.x + (izqT ? -seg : seg), y: t.y }, t];
  }

  // Sin puertos: si las cajas se solapan en X, draw.io traza una vertical recta
  // por la zona común; si se solapan en Y, una horizontal.
  const solapX = Math.min(rs.x + rs.w, rt.x + rt.w) - Math.max(rs.x, rt.x);
  const solapY = Math.min(rs.y + rs.h, rt.y + rt.h) - Math.max(rs.y, rt.y);
  if (!exit && !entry) {
    if (solapX > 0) {
      const x = Math.max(rs.x, rt.x) + solapX / 2;
      return [{ x, y: cs.y }, { x, y: ct.y }];
    }
    if (solapY > 0) {
      const y = Math.max(rs.y, rt.y) + solapY / 2;
      return [{ x: cs.x, y }, { x: ct.x, y }];
    }
  }
  const ejeIni = (exit && ejeDePuerto(...exit)) || (Math.abs(ct.x - cs.x) >= Math.abs(ct.y - cs.y) ? "h" : "v");
  const ejeFin = (entry && ejeDePuerto(...entry)) || ejeIni;
  if (ejeIni === "v" && ejeFin === "v") {
    const midY = (ini.y + fin.y) / 2;
    return [ini, { x: ini.x, y: midY }, { x: fin.x, y: midY }, fin];
  }
  if (ejeIni === "h" && ejeFin === "h") {
    const midX = (ini.x + fin.x) / 2;
    return [ini, { x: midX, y: ini.y }, { x: midX, y: fin.y }, fin];
  }
  if (ejeIni === "v") return [ini, { x: ini.x, y: fin.y }, fin];
  return [ini, { x: fin.x, y: ini.y }, fin];
}

// ── El modelo ────────────────────────────────────────────────────────────────

/** Saca los `mxGraphModel` de un archivo: `mxfile/diagram*` o un modelo suelto. */
function paginasDe(raiz, reportar) {
  if (raiz.nombre === "mxGraphModel") return [{ nombre: "(sin mxfile)", modelo: raiz }];
  if (raiz.nombre !== "mxfile") {
    reportar("E", "raiz-desconocida", null, `el elemento raíz es <${raiz.nombre}>; un .drawio empieza con <mxfile>`);
    return [];
  }
  const diagramas = raiz.hijos.filter((h) => h.nombre === "diagram");
  if (diagramas.length === 0) {
    reportar("E", "sin-diagramas", null, "<mxfile> no tiene ninguna <diagram> (página)");
    return [];
  }
  const ids = new Set();
  const out = [];
  diagramas.forEach((d, k) => {
    const nombre = d.attrs.name ?? `Página ${k + 1}`;
    if (d.attrs.id !== undefined) {
      if (ids.has(d.attrs.id)) reportar("A", "pagina-id-duplicado", null, `dos páginas con id="${d.attrs.id}"`);
      ids.add(d.attrs.id);
    }
    const modelo = d.hijos.find((h) => h.nombre === "mxGraphModel");
    if (modelo) {
      out.push({ nombre, modelo });
      return;
    }
    const crudo = d.texto.trim();
    if (!crudo) {
      reportar("E", "pagina-vacia", null, `la página «${nombre}» no tiene <mxGraphModel>`);
      return;
    }
    try {
      const xml = decodeURIComponent(inflateRawSync(Buffer.from(crudo, "base64")).toString("latin1"));
      out.push({ nombre, modelo: parsearXml(xml), comprimida: true });
      reportar(
        "A",
        "pagina-comprimida",
        null,
        `la página «${nombre}» está comprimida: se puede leer así, pero NO la escribas comprimida (Mycelium guarda sin comprimir)`,
      );
    } catch (e) {
      reportar("E", "pagina-ilegible", null, `la página «${nombre}» no es XML ni un comprimido válido: ${e.message}`);
    }
  });
  return out;
}

/** Celdas de un modelo, desenvolviendo `<object>`/`<UserObject>`. */
function celdasDe(modelo, reportar) {
  const root = modelo.hijos.find((h) => h.nombre === "root");
  if (!root) {
    reportar("E", "sin-root", null, "<mxGraphModel> no tiene <root>");
    return [];
  }
  const celdas = [];
  for (const h of root.hijos) {
    let attrs;
    let cell;
    if (h.nombre === "mxCell") {
      cell = h;
      attrs = { ...h.attrs };
    } else if (h.nombre === "object" || h.nombre === "UserObject") {
      cell = h.hijos.find((x) => x.nombre === "mxCell");
      if (!cell) {
        reportar("E", "objeto-sin-celda", h.attrs.id ?? null, `<${h.nombre}> sin <mxCell> adentro`);
        continue;
      }
      attrs = { ...cell.attrs, id: h.attrs.id, value: h.attrs.label ?? "" };
    } else {
      reportar("A", "elemento-desconocido", h.attrs.id ?? null, `<${h.nombre}> dentro de <root> no es una celda`);
      continue;
    }
    const geo = cell.hijos.find((x) => x.nombre === "mxGeometry");
    celdas.push({
      id: attrs.id,
      parent: attrs.parent,
      value: attrs.value ?? "",
      est: parsearEstilo(attrs.style),
      vertex: attrs.vertex === "1",
      edge: attrs.edge === "1",
      source: attrs.source,
      target: attrs.target,
      geo,
    });
  }
  return celdas;
}

function geometriaDe(geo) {
  const a = geo.attrs;
  return {
    x: num(a.x, 0),
    y: num(a.y, 0),
    w: num(a.width, NaN),
    h: num(a.height, NaN),
    relativa: a.relative === "1",
  };
}

/** Valida un `mxGraphModel`. `reportar(nivel, codigo, id, mensaje)`. */
function validarModelo(modelo, reportar) {
  const celdas = celdasDe(modelo, reportar);
  const porId = new Map();
  for (const c of celdas) {
    if (c.id === undefined || c.id === "") {
      reportar("E", "id-faltante", null, "hay una celda sin id");
      continue;
    }
    if (porId.has(c.id)) {
      reportar("E", "id-duplicado", c.id, `id="${c.id}" está repetido (draw.io renombra el segundo en silencio y las aristas terminan en el primero)`);
      continue;
    }
    porId.set(c.id, c);
  }

  // Raíz y capas.
  const raices = celdas.filter((c) => c.parent === undefined);
  if (raices.length === 0) reportar("E", "sin-celda-raiz", null, 'falta la celda raíz: <mxCell id="0"/>');
  if (raices.length > 1)
    reportar("E", "varias-raices", null, `hay ${raices.length} celdas sin parent (${raices.map((c) => c.id).join(", ")}); solo la raíz "0" va sin parent`);
  const raiz = raices[0];
  const capas = new Set(celdas.filter((c) => raiz && c.parent === raiz.id && !c.vertex && !c.edge).map((c) => c.id));
  if (raiz && capas.size === 0) reportar("E", "sin-capa", null, 'falta la capa: <mxCell id="1" parent="0"/>');

  for (const c of celdas) {
    if (c === raiz || c.parent === undefined) continue;
    if (!porId.has(c.parent)) reportar("E", "parent-inexistente", c.id, `parent="${c.parent}" no existe`);
    if (c.vertex && c.edge) reportar("E", "vertice-y-arista", c.id, "tiene vertex=\"1\" y edge=\"1\" a la vez");
    if (raiz && c.parent === raiz.id && (c.vertex || c.edge))
      reportar("E", "cuelga-de-raiz", c.id, `cuelga de la raíz "${raiz.id}"; las figuras y aristas van en una capa (parent="1")`);
  }

  // Ciclos de parent.
  for (const c of celdas) {
    const vistos = new Set();
    let p = c;
    while (p && p.parent !== undefined) {
      if (vistos.has(p.id)) {
        reportar("E", "parent-ciclico", c.id, "la cadena de parent forma un ciclo");
        break;
      }
      vistos.add(p.id);
      p = porId.get(p.parent);
    }
  }

  // Geometría absoluta de los vértices.
  const abs = new Map();
  const esEtiquetaDeArista = (c) => c.vertex && porId.get(c.parent)?.edge;
  const absDe = (c, prof = 0) => {
    if (abs.has(c.id)) return abs.get(c.id);
    if (prof > 50) return null;
    const g = geometriaDe(c.geo);
    const padre = porId.get(c.parent);
    let ox = 0;
    let oy = 0;
    if (padre && padre.vertex && padre.geo) {
      const rp = absDe(padre, prof + 1);
      if (rp) {
        ox = rp.x;
        oy = rp.y;
      }
    }
    const r = { x: g.x + ox, y: g.y + oy, w: g.w, h: g.h };
    abs.set(c.id, r);
    return r;
  };

  const vertices = [];
  for (const c of celdas) {
    if (!c.vertex || !porId.has(c.id) || porId.get(c.id) !== c) continue;
    if (esEtiquetaDeArista(c)) continue;
    if (!c.geo) {
      reportar("E", "vertice-sin-geometria", c.id, 'vértice sin <mxGeometry … as="geometry"/>');
      continue;
    }
    if (c.geo.attrs.as !== "geometry") reportar("E", "geometria-sin-as", c.id, '<mxGeometry> sin as="geometry": draw.io la ignora');
    const g = geometriaDe(c.geo);
    if (g.relativa) continue; // decoraciones relativas al padre: no se miden
    if (!(g.w > 0) || !(g.h > 0)) {
      reportar("E", "geometria-invalida", c.id, `width/height inválidos (${c.geo.attrs.width ?? "—"} × ${c.geo.attrs.height ?? "—"})`);
      continue;
    }
    vertices.push(c);
    absDe(c);
  }
  const esVertice = new Set(vertices.map((v) => v.id));

  const ancestros = (id) => {
    const out = new Set();
    let p = porId.get(id);
    let guarda = 0;
    while (p && p.parent !== undefined && guarda++ < 50) {
      out.add(p.parent);
      p = porId.get(p.parent);
    }
    return out;
  };

  // Posición: negativas o muy lejos.
  for (const v of vertices) {
    const r = abs.get(v.id);
    if (r.x < 0 || r.y < 0)
      reportar("A", "coordenadas-negativas", v.id, `queda en (${r.x}, ${r.y}): empezá el diagrama en x≥40, y≥40`);
    if (r.x + r.w > 8000 || r.y + r.h > 8000)
      reportar("A", "muy-lejos", v.id, `queda en (${r.x}, ${r.y}), lejos del resto de la página`);
  }

  // Hijos dentro de su contenedor.
  for (const v of vertices) {
    const padre = porId.get(v.parent);
    if (!padre || !esVertice.has(padre.id)) continue;
    const g = geometriaDe(v.geo);
    const gp = geometriaDe(padre.geo);
    const rel = { x: g.x, y: g.y, w: g.w, h: g.h };
    const caja = { x: 0, y: 0, w: gp.w, h: gp.h };
    if (!contiene(caja, rel)) {
      reportar(
        "E",
        "fuera-del-contenedor",
        v.id,
        `se sale de su contenedor "${padre.id}" (${gp.w}×${gp.h}): sus x,y son RELATIVAS al contenedor y ocupa ${g.x},${g.y} a ${g.x + g.w},${g.y + g.h}`,
      );
      continue;
    }
    const cab = encabezadoDe(padre.est);
    const horizontal = padre.est.horizontal !== "0";
    if (cab > 0 && (horizontal ? g.y < cab : g.x < cab))
      reportar("A", "tapa-encabezado", v.id, `tapa el encabezado de "${padre.id}" (${cab} px): empezá en ${horizontal ? "y" : "x"}≥${cab}`);
  }

  // Superposición entre hermanos.
  const porPadre = new Map();
  for (const v of vertices) {
    if (!porPadre.has(v.parent)) porPadre.set(v.parent, []);
    porPadre.get(v.parent).push(v);
  }
  for (const hermanos of porPadre.values()) {
    for (let a = 0; a < hermanos.length; a++) {
      for (let b = a + 1; b < hermanos.length; b++) {
        const A = hermanos[a];
        const B = hermanos[b];
        const ra = abs.get(A.id);
        const rb = abs.get(B.id);
        if (!interseca(ra, rb, 1)) continue;
        if (contiene(ra, rb) || contiene(rb, ra)) {
          const [grande, chica] = contiene(ra, rb) ? [A, B] : [B, A];
          reportar(
            "E",
            "encima-sin-ser-hijo",
            chica.id,
            `está dibujada encima de "${grande.id}" sin ser su hija: si "${grande.id}" es un contenedor, poné parent="${grande.id}" (con x,y relativas); si no, separalas`,
          );
        } else {
          reportar("E", "superposicion", A.id, `se encima con "${B.id}": (${ra.x},${ra.y} ${ra.w}×${ra.h}) y (${rb.x},${rb.y} ${rb.w}×${rb.h})`);
        }
      }
    }
  }

  // Texto que no cabe.
  for (const c of celdas) {
    const frag = c.value && menorSinEscapar(c.value, c.est.html === "1");
    if (frag)
      reportar(
        "A",
        "html-menor-sin-escapar",
        c.id,
        `con html=1, «${frag}» se lee como una etiqueta HTML sin cerrar y el texto desde ahí no se ve: un «<» visible va como &amp;lt; en el XML`,
      );
  }
  for (const v of vertices) {
    if (!v.value) continue;
    const r = abs.get(v.id);
    const motivo = motivoTextoNoCabe(v.value, v.est, r.w, r.h);
    if (motivo) reportar("E", "texto-no-cabe", v.id, motivo);
  }

  // Aristas.
  const rutas = []; // { e, ruta } en orden del documento: el orden importa para los saltos
  for (const e of celdas) {
    if (!e.edge || porId.get(e.id) !== e) continue;
    const puntos = { source: null, target: null, array: [] };
    if (!e.geo) reportar("A", "arista-sin-geometria", e.id, 'arista sin <mxGeometry relative="1" as="geometry"/>');
    else {
      for (const h of e.geo.hijos) {
        if (h.nombre === "mxPoint" && (h.attrs.as === "sourcePoint" || h.attrs.as === "targetPoint"))
          puntos[h.attrs.as === "sourcePoint" ? "source" : "target"] = { x: num(h.attrs.x, 0), y: num(h.attrs.y, 0) };
        if (h.nombre === "Array" && h.attrs.as === "points")
          for (const p of h.hijos) if (p.nombre === "mxPoint") puntos.array.push({ x: num(p.attrs.x, 0), y: num(p.attrs.y, 0) });
      }
    }
    let ok = true;
    for (const lado of ["source", "target"]) {
      const ref = e[lado];
      if (ref === undefined || ref === "") {
        ok = false;
        if (puntos[lado])
          reportar("A", "arista-suelta", e.id, `no tiene ${lado}: su extremo flota en un punto fijo y no sigue a ninguna caja`);
        else reportar("E", "arista-sin-extremo", e.id, `no tiene ${lado} (ni un ${lado}Point): draw.io la dibuja colgando o no la dibuja`);
        continue;
      }
      const dest = porId.get(ref);
      if (!dest) {
        ok = false;
        reportar("E", "arista-extremo-inexistente", e.id, `${lado}="${ref}" no existe: draw.io borra el extremo en silencio y la flecha queda suelta`);
        continue;
      }
      if (dest.edge) {
        ok = false;
        reportar("A", "arista-a-arista", e.id, `${lado}="${ref}" es otra arista`);
      } else if (!dest.vertex) {
        ok = false;
        reportar("E", "arista-extremo-no-vertice", e.id, `${lado}="${ref}" es una capa o la raíz, no una figura`);
      }
    }
    if (!ok) continue;

    // Con `direction` distinto de east, draw.io gira los puertos junto con la
    // figura (comprobado: en un cilindro con direction=south, entryX=0.5;entryY=0
    // entra por la DERECHA). El recorrido de acá no lo modela: se avisa.
    for (const [lado, px] of [["source", "exitX"], ["target", "entryX"]]) {
      const dir = porId.get(e[lado])?.est.direction;
      if (e.est[px] !== undefined && dir && dir !== "east")
        reportar(
          "A",
          "puerto-girado",
          e.id,
          `${lado}="${e[lado]}" tiene direction=${dir}: sus puertos giran con la figura y ${px === "exitX" ? "exitX/exitY" : "entryX/entryY"} no cae en el lado que dice; usá una forma que no necesite direction o sacá los puertos`,
        );
    }
    if (!esVertice.has(e.source) || !esVertice.has(e.target)) continue;
    if (e.source === e.target) continue;

    // Cruces: el recorrido aproximado no debe atravesar otras cajas.
    const rs = abs.get(e.source);
    const rt = abs.get(e.target);
    const padreE = porId.get(e.parent);
    const origen = padreE && esVertice.has(padreE.id) ? abs.get(padreE.id) : { x: 0, y: 0 };
    const wps = puntos.array.map((p) => ({ x: p.x + origen.x, y: p.y + origen.y }));
    const ruta = recorrido(e, rs, rt, wps);
    rutas.push({ e, ruta: recortarAlBorde(recortarAlBorde(ruta, rs).reverse(), rt).reverse() });

    // Waypoints desalineados con su puerto: el router de draw.io une el puerto y
    // el waypoint con un codo, y si es la ENTRADA la punta llega de costado,
    // corriendo pegada al borde de la caja (comprobado con un cubo y exitX=0.8).
    if (wps.length > 0) {
      const chequeos = [
        ["salida", "exitX", "exitY", rs, wps[0]],
        ["entrada", "entryX", "entryY", rt, wps[wps.length - 1]],
      ];
      for (const [nombre, kx, ky, r, wp] of chequeos) {
        if (e.est[kx] === undefined || e.est[ky] === undefined) continue;
        const px = num(e.est[kx], 0.5);
        const py = num(e.est[ky], 0.5);
        const eje = ejeDePuerto(px, py);
        const pt = puerto(r, px, py);
        const fuera = eje === "v" ? Math.abs(wp.x - pt.x) > 1 : eje === "h" ? Math.abs(wp.y - pt.y) > 1 : false;
        if (fuera)
          reportar(
            "A",
            "waypoint-desalineado",
            e.id,
            `el ${nombre === "salida" ? "primer" : "último"} waypoint (${wp.x}, ${wp.y}) no está alineado con el puerto de ${nombre} (${Math.round(pt.x)}, ${Math.round(pt.y)}): draw.io agrega un codo${nombre === "entrada" ? " y la punta entra de costado" : ""}. Poné ${eje === "v" ? `x = ${Math.round(pt.x)}` : `y = ${Math.round(pt.y)}`} (x + ${kx} × width, y + ${ky} × height)`,
          );
      }
    }
    const excluir = new Set([e.source, e.target, ...ancestros(e.source), ...ancestros(e.target)]);
    const cruzadas = [];
    for (const v of vertices) {
      if (excluir.has(v.id)) continue;
      const anc = ancestros(v.id);
      if (anc.has(e.source) || anc.has(e.target)) continue; // hijos de los extremos
      const r = abs.get(v.id);
      for (let k = 0; k + 1 < ruta.length; k++) {
        if (segmentoCruza(ruta[k], ruta[k + 1], r)) {
          cruzadas.push(v.id);
          break;
        }
      }
    }
    // Si cruza un contenedor Y a sus hijos, basta con nombrar a los hijos.
    const nombradas = cruzadas.filter((id) => !cruzadas.some((o) => o !== id && ancestros(o).has(id)));
    // Cruzar el borde de los contenedores de sus extremos es normal (así sale
    // una flecha de una capa a otra) y ya quedó excluido; cruzar un contenedor
    // AJENO —una capa intermedia— se avisa aparte, porque se arregla distinto.
    if (nombradas.length > 0) {
      const ajenos = nombradas.filter((id) => esContenedor(porId.get(id).est));
      const cajas = nombradas.filter((id) => !ajenos.includes(id));
      const lista = (ids) => ids.map((x) => `"${x}"`).join(", ");
      const partes = [];
      if (cajas.length) partes.push(`pasa por encima de ${lista(cajas)}`);
      if (ajenos.length) partes.push(`atraviesa ${ajenos.length > 1 ? "los contenedores" : "el contenedor"} ${lista(ajenos)}, que no ${ajenos.length > 1 ? "son" : "es"} de ninguno de sus extremos`);
      const arreglo = /entityRelation/i.test(e.est.edgeStyle ?? "")
        ? "con entityRelationEdgeStyle no fijes puertos: mové las tablas (la línea sale hacia el lado donde la otra tabla queda entera; si están apiladas, por la derecha)"
        : ajenos.length && !cajas.length
          ? "rodealo con waypoints por el pasillo entre contenedores, o poné la figura en una capa vecina"
          : "desviala con waypoints o puertos (exitX/entryX), o mové las cajas";
      reportar("A", "arista-atraviesa", e.id, `la arista ${e.source}→${e.target} ${partes.join(" y ")}: ${arreglo}`);
    }

    // Títulos de contenedores: una arista que entra o sale de una capa cruza su
    // encabezado, y si el título está centrado lo tacha. Acá no se excluyen los
    // ancestros: es justamente el caso típico.
    for (const v of vertices) {
      if (v.id === e.source || v.id === e.target || !v.value) continue;
      const cab = encabezadoDe(v.est);
      if (cab === 0 || v.est.horizontal === "0") continue;
      const r = abs.get(v.id);
      const texto = textoVisible(v.value, v.est.html === "1").split("\n")[0];
      const tw = anchoTexto(texto, num(v.est.fontSize, 12), (num(v.est.fontStyle, 1) & 1) === 1) + 8;
      const align = v.est.align ?? "center";
      const sl = num(v.est.spacingLeft, 0) + num(v.est.spacing, 2);
      const tx = align === "left" ? r.x + sl : align === "right" ? r.x + r.w - tw - sl : r.x + (r.w - tw) / 2;
      const titulo = { x: tx - 4, y: r.y, w: tw + 8, h: cab };
      if (ruta.some((p, k) => k + 1 < ruta.length && segmentoCruza(p, ruta[k + 1], titulo)))
        reportar(
          "A",
          "arista-tacha-titulo",
          e.id,
          `la arista ${e.source}→${e.target} pasa por el título de "${v.id}": alineá el título a un lado (align=left;spacingLeft=10) o mové la arista`,
        );
    }
  }

  // Etiquetas externas (íconos de red, actores): la flecha que sale o pasa por
  // el lado donde está la etiqueta la tacha. Comprobado: en un flujo vertical
  // de íconos con la etiqueta abajo, cada flecha que baja pasa sobre el texto.
  for (const v of vertices) {
    if (!v.value) continue;
    const et = rectEtiquetaExterna(v.value, v.est, abs.get(v.id));
    if (!et) continue;
    for (const { e, ruta } of rutas) {
      if (!ruta.some((p, k) => k + 1 < ruta.length && segmentoCruza(p, ruta[k + 1], et))) continue;
      const propia = e.source === v.id || e.target === v.id;
      reportar(
        "A",
        "arista-pisa-etiqueta",
        e.id,
        `la arista ${e.source}→${e.target} pasa sobre la etiqueta de "${v.id}", que va ${et.lado} de la figura: ${
          propia
            ? "llevá la etiqueta a un costado donde no salgan flechas (labelPosition=right;align=left;verticalLabelPosition=middle;verticalAlign=middle) o sacá la flecha por otro lado"
            : "desviá la arista o mové la figura"
        }`,
      );
    }
  }

  // Cruces entre aristas. Un cruce no siempre se puede evitar, pero sin marca
  // se lee como un empalme. Con `jumpStyle` draw.io dibuja un salto en la arista
  // que está MÁS ADELANTE en el archivo (comprobado: en la anterior no se ve).
  // Y dos aristas que corren una sobre otra se leen como una sola: eso solo vale
  // si salen del mismo punto (el «peine» de un árbol) o llegan al mismo punto
  // (una confluencia con los mismos puertos).
  const mismo = (p, q) => Math.abs(p.x - q.x) < 1 && Math.abs(p.y - q.y) < 1;
  for (let b = 1; b < rutas.length; b++) {
    for (let a = 0; a < b; a++) {
      const A = rutas[a];
      const B = rutas[b];
      const comparteSalida = A.e.source === B.e.source && mismo(A.ruta[0], B.ruta[0]);
      const comparteLlegada = A.e.target === B.e.target && mismo(A.ruta[A.ruta.length - 1], B.ruta[B.ruta.length - 1]);
      if (!comparteSalida && !comparteLlegada) {
        let comun = null;
        for (let i = 0; !comun && i + 1 < A.ruta.length; i++)
          for (let j = 0; !comun && j + 1 < B.ruta.length; j++)
            comun = tramoComun(A.ruta[i], A.ruta[i + 1], B.ruta[j], B.ruta[j + 1]);
        if (comun) {
          reportar(
            "A",
            "aristas-superpuestas",
            B.e.id,
            `la arista ${B.e.source}→${B.e.target} corre ${comun.largo} px encima de ${A.e.source}→${A.e.target} cerca de (${comun.x}, ${comun.y}) y se leen como una sola: separalas con puertos distintos (exitX/entryX 0.3 y 0.7, o lados distintos) o con waypoints por otra línea`,
          );
          continue;
        }
      }
      let punto = null;
      for (let i = 0; !punto && i + 1 < A.ruta.length; i++)
        for (let j = 0; !punto && j + 1 < B.ruta.length; j++)
          punto = cruceDeSegmentos(A.ruta[i], A.ruta[i + 1], B.ruta[j], B.ruta[j + 1]);
      if (!punto) continue;
      const salta = (x) => x.e.est.jumpStyle !== undefined && x.e.est.jumpStyle !== "none";
      if (salta(B)) continue;
      reportar(
        "A",
        "cruce-de-aristas",
        B.e.id,
        `la arista ${B.e.source}→${B.e.target} cruza a ${A.e.source}→${A.e.target} cerca de (${punto.x}, ${punto.y}): probá otro orden de las cajas en la fila o sacala por otro lado; si el cruce es inevitable, poné jumpStyle=arc;jumpSize=10; en "${B.e.id}"${
          salta(A) ? ` (el salto lo dibuja la que está MÁS ADELANTE en el archivo: el jumpStyle de "${A.e.id}" acá no se ve)` : ""
        }`,
      );
    }
  }

  // El mapa: lo que la IA necesita para modificar sin encimar (`--mapa`).
  const mapa = {
    figuras: vertices.map((v) => {
      const r = abs.get(v.id);
      const g = geometriaDe(v.geo);
      return {
        id: v.id,
        parent: v.parent,
        texto: textoVisible(v.value, v.est.html === "1").replace(/\n/g, " / ").slice(0, 60),
        forma: formaDe(v.est),
        contenedor: esContenedor(v.est),
        abs: { x: r.x, y: r.y, w: r.w, h: r.h },
        rel: v.parent !== undefined && esVertice.has(v.parent) ? { x: g.x, y: g.y } : null,
      };
    }),
    aristas: celdas
      .filter((c) => c.edge && porId.get(c.id) === c)
      .map((e) => ({ id: e.id, source: e.source, target: e.target, texto: textoVisible(e.value, e.est.html === "1") })),
  };
  const xs = vertices.map((v) => abs.get(v.id));
  mapa.limites = xs.length
    ? {
        x: Math.min(...xs.map((r) => r.x)),
        y: Math.min(...xs.map((r) => r.y)),
        derecha: Math.max(...xs.map((r) => r.x + r.w)),
        abajo: Math.max(...xs.map((r) => r.y + r.h)),
      }
    : null;

  return { celdas: celdas.length, vertices: vertices.length, aristas: celdas.filter((c) => c.edge).length, mapa };
}

/**
 * Valida el texto de un `.drawio`. Devuelve `{ problemas, paginas }`, donde
 * cada problema es `{ nivel: "error"|"aviso", codigo, pagina, id, mensaje }`.
 */
export function validarDrawio(texto) {
  const problemas = [];
  let paginaActual = null;
  const reportar = (nivel, codigo, id, mensaje) =>
    problemas.push({ nivel: nivel === "E" ? "error" : "aviso", codigo, pagina: paginaActual, id, mensaje });
  let raiz;
  try {
    raiz = parsearXml(texto);
  } catch (e) {
    reportar(
      "E",
      "xml-malformado",
      null,
      `${e.message}. XML inválido: cuando draw.io no puede leerlo muestra «No es un archivo de diagrama» y abre un lienzo VACÍO, y si el usuario guarda se pierde el contenido`,
    );
    return { problemas, paginas: [] };
  }
  const paginas = paginasDe(raiz, reportar);
  const resumen = [];
  for (const p of paginas) {
    paginaActual = p.nombre;
    if (p.modelo.nombre !== "mxGraphModel") {
      reportar("E", "pagina-sin-modelo", null, `la página contiene <${p.modelo.nombre}>, no <mxGraphModel>`);
      continue;
    }
    resumen.push({ nombre: p.nombre, ...validarModelo(p.modelo, reportar) });
  }
  return { problemas, paginas: resumen };
}

// ── CLI ──────────────────────────────────────────────────────────────────────

/** Imprime las figuras y aristas de cada página con coordenadas absolutas. */
function imprimirMapa(r) {
  for (const p of r.paginas) {
    const m = p.mapa;
    console.log(`  página «${p.nombre}»`);
    if (m.limites)
      console.log(
        `    ocupa x ${m.limites.x}…${m.limites.derecha}, y ${m.limites.y}…${m.limites.abajo}  (lugar libre: a la derecha de x=${m.limites.derecha + 60} o debajo de y=${m.limites.abajo + 60})`,
      );
    console.log("    figuras (x,y ABSOLUTAS; «rel» = lo que va en el XML si tiene contenedor):");
    for (const f of m.figuras) {
      const rel = f.rel ? `  rel ${f.rel.x},${f.rel.y} en "${f.parent}"` : "";
      const tipo = f.contenedor ? `${f.forma}, contenedor` : f.forma;
      console.log(`      ${f.id.padEnd(18)} ${`${f.abs.x},${f.abs.y}`.padEnd(10)} ${`${f.abs.w}×${f.abs.h}`.padEnd(9)} [${tipo}] «${f.texto}»${rel}`);
    }
    console.log("    aristas:");
    for (const a of m.aristas)
      console.log(`      ${a.id.padEnd(18)} ${a.source ?? "?"} → ${a.target ?? "?"}${a.texto ? `  «${a.texto}»` : ""}`);
  }
}

function main(argv) {
  const json = argv.includes("--json");
  const verMapa = argv.includes("--mapa");
  const archivos = argv.filter((a) => a !== "--json" && a !== "--mapa");
  if (archivos.length === 0) {
    console.error("uso: node validar-drawio.mjs [--mapa] [--json] <archivo.drawio>...");
    return 2;
  }
  let hayErrores = false;
  const salida = [];
  for (const archivo of archivos) {
    let texto;
    try {
      texto = readFileSync(archivo, "utf8");
    } catch (e) {
      console.error(`${archivo}: no se pudo leer (${e.message})`);
      hayErrores = true;
      continue;
    }
    const r = validarDrawio(texto);
    const errores = r.problemas.filter((p) => p.nivel === "error");
    const avisos = r.problemas.filter((p) => p.nivel === "aviso");
    if (errores.length) hayErrores = true;
    if (json) {
      salida.push({ archivo, ...r });
      continue;
    }
    console.log(`\n${archivo}`);
    if (verMapa) imprimirMapa(r);
    else for (const p of r.paginas) console.log(`  página «${p.nombre}»: ${p.vertices} figuras, ${p.aristas} aristas`);
    for (const p of [...errores, ...avisos]) {
      const donde = [p.pagina ? `«${p.pagina}»` : null, p.id ? `celda "${p.id}"` : null].filter(Boolean).join(" ");
      console.log(`  ${p.nivel === "error" ? "ERROR" : "aviso"} [${p.codigo}]${donde ? ` ${donde}` : ""}: ${p.mensaje}`);
    }
    console.log(`  → ${errores.length} error(es), ${avisos.length} aviso(s)${errores.length ? "" : " — OK"}`);
  }
  if (json) console.log(JSON.stringify(salida, null, 2));
  return hayErrores ? 1 : 0;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  process.exitCode = main(process.argv.slice(2));
}
