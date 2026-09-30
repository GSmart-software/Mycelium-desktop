#!/usr/bin/env node
// Validador de lienzos `.canvas` (JSON Canvas 1.0) tal como los dibuja Mycelium
// (`FUN-L-26`, parte B). Sin dependencias: Node 20 y nada más, para que pueda
// viajar junto a la skill `mycelium-canvas` y correr dentro de cualquier vault.
//
//   node scripts/validar-canvas.mjs [--vault <ruta>] [--estricto] <archivo.canvas>...
//
// Comprueba lo que se puede medir sin abrir la app: que el JSON sea un canvas,
// que las flechas apunten a nodos que existen y salgan por el lado que mira a su
// destino, que las tarjetas no se encimen, que los grupos contengan por completo
// a lo que tocan, que el texto quepa en su caja y, con `--vault`, que las
// tarjetas de nota apunten a notas reales.
//
// > [!important] La geometría es la de Mycelium, copiada a propósito
// > `anclaDe`, `ladosAutomaticos` y `trazoArista` replican `lib/canvas.ts`. Van
// > copiadas —no importadas— porque este script tiene que funcionar fuera del
// > repo. `scripts/test-validar-canvas.mjs` compara las dos versiones para que
// > no puedan divergir en silencio.
//
// Salida: `ERROR` hace fallar (exit 1); `AVISO` no, salvo con `--estricto`.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

// ── Medidas de Mycelium (`components/canvas/CanvasView.module.css`) ───────────

/**
 * Lo que ocupa la tarjeta además del texto. Vertical: bordes (2) + cabecera con
 * el título, que TODA tarjeta tiene, incluso las de texto y los grupos (~22) +
 * relleno del cuerpo (0.45rem × 2) + relleno de `.mic-preview` (16 × 2).
 * Horizontal: bordes + relleno del cuerpo (0.6rem × 2) + el de `.mic-preview`.
 */
export const MEDIDAS = {
  cabecera: 22,
  extraAlto: 72,
  extraAncho: 56,
  /** Texto del cuerpo: 0.82rem en Source Serif, interlineado 1.7. */
  linea: 23,
  /** Ancho medio de un carácter del cuerpo (estimación conservadora). */
  caracter: 7,
  /** Títulos `#` dentro de la tarjeta: 0.95rem en negrita. */
  lineaTitulo: 27,
  caracterTitulo: 8.4,
  /** Separación tras un párrafo, una lista o un título. */
  parrafo: 7,
  /** Sangría de una lista (1.5rem). */
  sangriaLista: 24,
  /** Lo mínimo a lo que la app deja achicar una tarjeta. */
  anchoMinimo: 120,
  altoMinimo: 60,
};

const TIPOS = new Set(["text", "file", "link", "group"]);
const LADOS = new Set(["top", "right", "bottom", "left"]);
const PUNTAS = new Set(["none", "arrow"]);
const ESTILOS_FONDO = new Set(["cover", "ratio", "repeat"]);
const EXT_NOTA = new Set(["md"]);
/** Tipos que Mycelium abre como «nota» pero que en una tarjeta se ven crudos. */
const EXT_NO_MARKDOWN = new Set(["canvas", "base", "excalidraw", "drawio"]);

// ── Geometría (copia de `lib/canvas.ts`) ──────────────────────────────────────

export function anclaDe(n, lado) {
  switch (lado) {
    case "top":
      return { x: n.x + n.width / 2, y: n.y };
    case "bottom":
      return { x: n.x + n.width / 2, y: n.y + n.height };
    case "left":
      return { x: n.x, y: n.y + n.height / 2 };
    default:
      return { x: n.x + n.width, y: n.y + n.height / 2 };
  }
}

export function ladosAutomaticos(a, b) {
  const dx = b.x + b.width / 2 - (a.x + a.width / 2);
  const dy = b.y + b.height / 2 - (a.y + a.height / 2);
  if (Math.abs(dx) >= Math.abs(dy)) {
    return dx >= 0 ? { desde: "right", hasta: "left" } : { desde: "left", hasta: "right" };
  }
  return dy >= 0 ? { desde: "bottom", hasta: "top" } : { desde: "top", hasta: "bottom" };
}

/**
 * Lados que el validador SUGIERE (y que enseña la skill): se elige el eje por el
 * HUECO entre los rectángulos, no por la distancia entre centros. Con hueco
 * horizontal mayor o igual que el vertical, la flecha va de costado; si no, de
 * arriba abajo. Como el eje elegido siempre tiene hueco (≥ 0) cuando las
 * tarjetas no se encimen, el par sugerido pasa siempre el chequeo de enganches
 * (`LADO_OPUESTO`). La regla por centros de Mycelium (`ladosAutomaticos`) no:
 * en diagonal, con las tarjetas solapadas en x, puede dar un lado de espaldas.
 */
export function ladosSugeridos(a, b) {
  const { sx, sy } = separacion(a, b);
  if (sx >= sy) {
    return b.x + b.width / 2 >= a.x + a.width / 2 ? { desde: "right", hasta: "left" } : { desde: "left", hasta: "right" };
  }
  return b.y + b.height / 2 >= a.y + a.height / 2 ? { desde: "bottom", hasta: "top" } : { desde: "top", hasta: "bottom" };
}

function normal(lado) {
  switch (lado) {
    case "top":
      return { x: 0, y: -1 };
    case "bottom":
      return { x: 0, y: 1 };
    case "left":
      return { x: -1, y: 0 };
    default:
      return { x: 1, y: 0 };
  }
}

/** Los cuatro puntos de la bezier que dibuja Mycelium para una flecha. */
export function controlesArista(a, ladoA, b, ladoB) {
  const p1 = anclaDe(a, ladoA);
  const p2 = anclaDe(b, ladoB);
  const dist = Math.hypot(p2.x - p1.x, p2.y - p1.y);
  const tirador = Math.min(120, Math.max(40, dist / 2));
  const n1 = normal(ladoA);
  const n2 = normal(ladoB);
  return [
    p1,
    { x: p1.x + n1.x * tirador, y: p1.y + n1.y * tirador },
    { x: p2.x + n2.x * tirador, y: p2.y + n2.y * tirador },
    p2,
  ];
}

function puntoBezier([p0, p1, p2, p3], t) {
  const u = 1 - t;
  const a = u * u * u;
  const b = 3 * u * u * t;
  const c = 3 * u * t * t;
  const d = t * t * t;
  return { x: a * p0.x + b * p1.x + c * p2.x + d * p3.x, y: a * p0.y + b * p1.y + c * p2.y + d * p3.y };
}

// ── Rectángulos ───────────────────────────────────────────────────────────────

const derecha = (n) => n.x + n.width;
const abajo = (n) => n.y + n.height;

/** Separación entre dos rectángulos; negativa en los dos ejes = se superponen. */
function separacion(a, b) {
  const sx = Math.max(b.x - derecha(a), a.x - derecha(b));
  const sy = Math.max(b.y - abajo(a), a.y - abajo(b));
  return { sx, sy };
}

const seSuperponen = (a, b) => {
  const { sx, sy } = separacion(a, b);
  return sx < 0 && sy < 0;
};

const contiene = (g, n) =>
  n.x >= g.x && n.y >= g.y && derecha(n) <= derecha(g) && abajo(n) <= abajo(g);

const dentro = (p, n, margen) =>
  p.x > n.x + margen && p.x < derecha(n) - margen && p.y > n.y + margen && p.y < abajo(n) - margen;

// ── Texto ─────────────────────────────────────────────────────────────────────

/** Texto visible de una línea de markdown (sin marcas que no ocupan lugar). */
function visible(linea) {
  return linea
    .replace(/!?\[\[([^\]|]+)\|([^\]]+)\]\]/g, "$2")
    .replace(/!?\[\[([^\]]+)\]\]/g, (_, d) => d.slice(d.lastIndexOf("/") + 1))
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[*_`~]/g, "")
    .replace(/^>\s?/, "");
}

/**
 * Alto que necesita una tarjeta de texto para mostrar su markdown sin barra de
 * desplazamiento. Es una ESTIMACIÓN: cuenta renglones por caracteres con un
 * ancho medio conservador. Sirve para detectar lo que claramente no entra.
 *
 * > [!important] Un salto de línea simple NO corta el renglón
 * > Mycelium renderiza CommonMark sin `breaks`: dos líneas seguidas son un solo
 * > párrafo, unidas por un espacio. Solo cortan una línea en blanco (párrafo
 * > nuevo), un ítem de lista, un título, o terminar la línea con `\` o con dos
 * > espacios. Por eso se cuentan los caracteres del párrafo entero.
 */
export function altoNecesario(texto, ancho) {
  const util = Math.max(40, ancho - MEDIDAS.extraAncho);
  let alto = MEDIDAS.extraAlto;
  /** Renglones forzados del bloque actual, cada uno con su ancho disponible. */
  let segmentos = [];
  let actual = null;
  let enCodigo = false;

  const cerrarSegmento = () => {
    if (actual !== null) segmentos.push(actual);
    actual = null;
  };
  const cerrarBloque = () => {
    cerrarSegmento();
    if (segmentos.length === 0) return;
    for (const s of segmentos) {
      const porRenglon = Math.max(1, Math.floor(s.ancho / MEDIDAS.caracter));
      alto += Math.max(1, Math.ceil(s.chars / porRenglon)) * MEDIDAS.linea + s.extra;
    }
    alto += MEDIDAS.parrafo;
    segmentos = [];
  };

  for (const cruda of texto.replace(/\r\n/g, "\n").split("\n")) {
    const linea = cruda.trimEnd();
    if (/^\s*(```|~~~)/.test(linea)) {
      cerrarBloque();
      enCodigo = !enCodigo;
      if (!enCodigo) alto += MEDIDAS.parrafo;
      continue;
    }
    if (enCodigo) {
      // Código: monoespaciado, sin partir renglones (se desplaza en horizontal).
      alto += MEDIDAS.linea;
      continue;
    }
    if (linea.trim() === "") {
      cerrarBloque();
      continue;
    }
    const titulo = /^#{1,6}\s+(.*)$/.exec(linea);
    if (titulo) {
      cerrarBloque();
      const chars = visible(titulo[1]).length;
      const porRenglon = Math.max(1, Math.floor(util / MEDIDAS.caracterTitulo));
      alto += Math.max(1, Math.ceil(chars / porRenglon)) * MEDIDAS.lineaTitulo + MEDIDAS.parrafo;
      continue;
    }
    const lista = /^(\s*)([-*+]|\d+[.)])\s+(\[[ xX]\]\s+)?(.*)$/.exec(linea);
    if (lista) {
      // Cada ítem empieza renglón; entre ítems hay un margen chico (0.25rem).
      cerrarSegmento();
      const nivel = 1 + Math.floor(lista[1].replace(/\t/g, "    ").length / 2);
      actual = { chars: visible(lista[4]).length, ancho: Math.max(40, util - nivel * MEDIDAS.sangriaLista), extra: 4 };
    } else if (actual !== null) {
      actual.chars += 1 + visible(linea.trim()).length; // salto blando: se une
    } else {
      actual = { chars: visible(linea.trim()).length, ancho: util, extra: 0 };
    }
    // Salto duro: `\` o dos espacios al final cortan el renglón.
    if (/(\\|\s{2})$/.test(cruda)) cerrarSegmento();
  }
  cerrarBloque();
  return Math.round(alto);
}

// ── Rutas del vault ───────────────────────────────────────────────────────────

/**
 * ¿Existe `ruta` dentro de `vault` con ESAS mayúsculas? En Windows el sistema de
 * archivos no distingue, pero Mycelium compara la ruta exacta contra el id de la
 * nota: `notas/idea.md` no encuentra `Notas/Idea.md`.
 */
function existeExacta(vault, ruta) {
  let actual = vault;
  const partes = ruta.split("/");
  for (let i = 0; i < partes.length; i++) {
    let nombres;
    try {
      nombres = readdirSync(actual);
    } catch {
      return { existe: false, casi: false };
    }
    const parte = partes[i];
    if (!nombres.includes(parte)) {
      const parecido = nombres.find((n) => n.toLowerCase() === parte.toLowerCase());
      if (parecido === undefined) return { existe: false, casi: false };
      return { existe: false, casi: true };
    }
    actual = path.join(actual, parte);
  }
  try {
    return { existe: statSync(actual).isFile(), casi: false };
  } catch {
    return { existe: false, casi: false };
  }
}

// ── Validación ────────────────────────────────────────────────────────────────

const esTexto = (v) => typeof v === "string";
const esNumero = (v) => typeof v === "number" && Number.isFinite(v);
const esColor = (v) => /^[1-6]$/.test(v) || /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(v);

/**
 * Valida el contenido de un `.canvas`.
 *
 * @param {string} contenido  el texto del archivo
 * @param {{ vault?: string }} [opciones]  `vault`: raíz para comprobar los `file`
 * @returns {{ errores: {codigo: string, mensaje: string}[], avisos: {codigo: string, mensaje: string}[] }}
 */
export function validarCanvas(contenido, opciones = {}) {
  const errores = [];
  const avisos = [];
  const error = (codigo, mensaje) => errores.push({ codigo, mensaje });
  const aviso = (codigo, mensaje) => avisos.push({ codigo, mensaje });

  if (contenido.trim() === "") {
    aviso("VACIO", "El archivo está vacío: Mycelium lo abre como un lienzo sin nada.");
    return { errores, avisos };
  }

  let raiz;
  try {
    raiz = JSON.parse(contenido);
  } catch (e) {
    error("JSON_INVALIDO", `No es JSON válido: ${e instanceof Error ? e.message : e}. Mycelium no lo abre.`);
    return { errores, avisos };
  }
  if (typeof raiz !== "object" || raiz === null || Array.isArray(raiz)) {
    error("RAIZ_INVALIDA", "La raíz tiene que ser un objeto `{ \"nodes\": [...], \"edges\": [...] }`.");
    return { errores, avisos };
  }
  for (const clave of Object.keys(raiz)) {
    if (clave !== "nodes" && clave !== "edges") {
      aviso(
        "CLAVE_RAIZ",
        `Clave \`${clave}\` en la raíz: Mycelium solo conserva \`nodes\` y \`edges\`; se pierde en cuanto el usuario mueva algo.`,
      );
    }
  }
  if (raiz.nodes !== undefined && !Array.isArray(raiz.nodes)) error("NODES_NO_ARRAY", "`nodes` tiene que ser un array.");
  if (raiz.edges !== undefined && !Array.isArray(raiz.edges)) error("EDGES_NO_ARRAY", "`edges` tiene que ser un array.");
  if (raiz.nodes === undefined) aviso("SIN_NODES", "Falta `nodes` (se toma como vacío).");
  const nodosCrudos = Array.isArray(raiz.nodes) ? raiz.nodes : [];
  const aristasCrudas = Array.isArray(raiz.edges) ? raiz.edges : [];

  // ── Nodos ──
  const ids = new Map(); // id → "nodo" | "arista"
  /** Nodos con geometría válida, en el orden del archivo (= orden de dibujo). */
  const nodos = [];
  nodosCrudos.forEach((n, i) => {
    const donde = `nodes[${i}]`;
    if (typeof n !== "object" || n === null || Array.isArray(n)) {
      error("NODO_INVALIDO", `${donde} no es un objeto.`);
      return;
    }
    if (!esTexto(n.id) || n.id === "") {
      error("ID_INVALIDO", `${donde} no tiene \`id\` (texto): Mycelium lo descarta al abrir y lo borra al guardar.`);
      return;
    }
    const nombre = `nodo "${n.id}"`;
    if (ids.has(n.id)) error("ID_DUPLICADO", `El id "${n.id}" se repite (${nombre}). Los ids son únicos entre nodos y aristas.`);
    ids.set(n.id, "nodo");

    if (!TIPOS.has(n.type)) {
      error(
        "TIPO_INVALIDO",
        `${nombre}: \`type\` = ${JSON.stringify(n.type)}. Solo text, file, link o group; Mycelium convierte cualquier otro en texto.`,
      );
    }
    let geometriaOk = true;
    for (const campo of ["x", "y", "width", "height"]) {
      if (!esNumero(n[campo])) {
        error("GEOMETRIA_INVALIDA", `${nombre}: \`${campo}\` tiene que ser un número (es ${JSON.stringify(n[campo])}).`);
        geometriaOk = false;
      } else if (!Number.isInteger(n[campo])) {
        aviso("NO_ENTERO", `${nombre}: \`${campo}\` = ${n[campo]} no es entero; el formato pide enteros y Mycelium lo redondea al guardar.`);
      }
    }
    if (geometriaOk && (n.width <= 0 || n.height <= 0)) {
      error("GEOMETRIA_INVALIDA", `${nombre}: ancho y alto tienen que ser positivos.`);
      geometriaOk = false;
    }
    if (geometriaOk && (n.width < MEDIDAS.anchoMinimo || n.height < MEDIDAS.altoMinimo)) {
      aviso(
        "TAMANO_CHICO",
        `${nombre}: ${n.width}×${n.height} es menos que el mínimo que permite la app (${MEDIDAS.anchoMinimo}×${MEDIDAS.altoMinimo}).`,
      );
    }
    if (n.color !== undefined && !(esTexto(n.color) && esColor(n.color))) {
      error("COLOR_INVALIDO", `${nombre}: \`color\` = ${JSON.stringify(n.color)}. Usá "1".."6" o un hex "#RRGGBB".`);
    }

    if (n.type === "text" && !esTexto(n.text)) error("CAMPO_FALTANTE", `${nombre}: un nodo text necesita \`text\` (markdown).`);
    if (n.type === "link" && !esTexto(n.url)) error("CAMPO_FALTANTE", `${nombre}: un nodo link necesita \`url\`.`);
    if (n.type === "group") {
      if (n.label !== undefined && !esTexto(n.label)) error("CAMPO_INVALIDO", `${nombre}: \`label\` tiene que ser texto.`);
      if (n.label === undefined) aviso("GRUPO_SIN_ETIQUETA", `${nombre}: sin \`label\`, la cabecera dice «Grupo».`);
      if (n.backgroundStyle !== undefined && !ESTILOS_FONDO.has(n.backgroundStyle)) {
        aviso("FONDO_INVALIDO", `${nombre}: \`backgroundStyle\` = ${JSON.stringify(n.backgroundStyle)} (cover, ratio o repeat).`);
      }
      if (n.background !== undefined) aviso("FONDO_NO_DIBUJADO", `${nombre}: Mycelium no dibuja la imagen de fondo de un grupo (se conserva).`);
    }
    if (n.type === "file") {
      if (!esTexto(n.file) || n.file === "") {
        error("CAMPO_FALTANTE", `${nombre}: un nodo file necesita \`file\` (ruta relativa al vault).`);
      } else {
        validarRuta(n.file, nombre, opciones.vault, error, aviso);
      }
      if (n.subpath !== undefined && !(esTexto(n.subpath) && n.subpath.startsWith("#"))) {
        error("SUBPATH_INVALIDO", `${nombre}: \`subpath\` tiene que empezar con "#".`);
      }
    }
    if (n.type === "text" && esTexto(n.text) && geometriaOk) {
      const necesita = altoNecesario(n.text, n.width);
      if (necesita > n.height + MEDIDAS.linea) {
        error(
          "TEXTO_NO_CABE",
          `${nombre}: el texto necesita ~${necesita}px de alto y la tarjeta mide ${n.height} (ancho ${n.width}). Agrandala o acortá el texto.`,
        );
      } else if (necesita > n.height) {
        aviso("TEXTO_JUSTO", `${nombre}: el texto necesita ~${necesita}px y la tarjeta mide ${n.height}; puede salir barra de desplazamiento.`);
      }
    }
    if (geometriaOk) nodos.push({ ...n, indice: i });
  });

  const porId = new Map(nodos.map((n) => [n.id, n]));
  const grupos = nodos.filter((n) => n.type === "group");
  const tarjetas = nodos.filter((n) => n.type !== "group");

  // Sin chequeo de «vista inicial»: Mycelium abre el lienzo ENCUADRADO en su
  // contenido, así que dónde empiezan las coordenadas (negativas, lejos del
  // origen) no cambia lo que se ve al abrir.

  // ── Superposición entre tarjetas ──
  for (let i = 0; i < tarjetas.length; i++) {
    for (let j = i + 1; j < tarjetas.length; j++) {
      const a = tarjetas[i];
      const b = tarjetas[j];
      const { sx, sy } = separacion(a, b);
      if (sx < 0 && sy < 0) {
        error("SUPERPOSICION", `Los nodos "${a.id}" y "${b.id}" se superponen (${-sx}×${-sy}px). Solo un grupo puede contener a otro nodo.`);
      } else if (Math.max(sx, sy) < 16) {
        aviso("MUY_JUNTOS", `Los nodos "${a.id}" y "${b.id}" quedan a ${Math.max(sx, sy)}px: dejá al menos 24.`);
      }
    }
  }

  // ── Grupos ──
  for (const g of grupos) {
    for (const n of nodos) {
      if (n === g || !seSuperponen(g, n)) continue;
      if (contiene(g, n)) {
        if (g.indice < n.indice) continue; // bien: el grupo va antes (debajo)
        error(
          "GRUPO_TAPA_NODOS",
          `El grupo "${g.id}" está después de "${n.id}" en \`nodes\`: se dibuja ENCIMA y lo tapa. Los grupos van antes que lo que contienen.`,
        );
      } else if (n.type === "group" && contiene(n, g)) {
        continue; // `g` anidado dentro de `n`: lo revisa la vuelta de `n`
      } else {
        error(
          "GRUPO_PARCIAL",
          `El nodo "${n.id}" queda a medias dentro del grupo "${g.id}": un grupo tiene que contener por completo a lo que toca, o no tocarlo.`,
        );
      }
    }
    for (const n of nodos) {
      if (n === g || !contiene(g, n)) continue;
      const arriba = n.y - g.y;
      const lados = Math.min(n.x - g.x, derecha(g) - derecha(n), abajo(g) - abajo(n));
      if (arriba < MEDIDAS.cabecera + 14 || lados < 12) {
        aviso(
          "GRUPO_SIN_MARGEN",
          `"${n.id}" está pegado al borde del grupo "${g.id}" (arriba ${arriba}px, lados ${lados}px): dejá 40 arriba —ahí va la etiqueta— y 20 en los demás.`,
        );
      }
    }
  }

  // ── Aristas ──
  const vistas = new Set();
  aristasCrudas.forEach((e, i) => {
    const donde = `edges[${i}]`;
    if (typeof e !== "object" || e === null || Array.isArray(e)) {
      error("ARISTA_INVALIDA", `${donde} no es un objeto.`);
      return;
    }
    if (!esTexto(e.id) || e.id === "") {
      error("ID_INVALIDO", `${donde} no tiene \`id\`: Mycelium la descarta.`);
      return;
    }
    const nombre = `arista "${e.id}"`;
    if (ids.has(e.id)) error("ID_DUPLICADO", `El id "${e.id}" se repite (${nombre}). Los ids son únicos entre nodos y aristas.`);
    ids.set(e.id, "arista");

    let extremosOk = true;
    for (const campo of ["fromNode", "toNode"]) {
      if (!esTexto(e[campo])) {
        error("CAMPO_FALTANTE", `${nombre}: falta \`${campo}\`.`);
        extremosOk = false;
      } else if (!porId.has(e[campo])) {
        error(
          "ARISTA_SIN_NODO",
          `${nombre}: \`${campo}\` = "${e[campo]}" no es ningún nodo. Mycelium no la dibuja y la BORRA al guardar.`,
        );
        extremosOk = false;
      }
    }
    for (const campo of ["fromSide", "toSide"]) {
      if (e[campo] !== undefined && !LADOS.has(e[campo])) {
        error("LADO_INVALIDO", `${nombre}: \`${campo}\` = ${JSON.stringify(e[campo])} (top, right, bottom o left).`);
      }
    }
    for (const campo of ["fromEnd", "toEnd"]) {
      if (e[campo] !== undefined && !PUNTAS.has(e[campo])) {
        error("PUNTA_INVALIDA", `${nombre}: \`${campo}\` = ${JSON.stringify(e[campo])} (none o arrow).`);
      }
    }
    if (e.color !== undefined && !(esTexto(e.color) && esColor(e.color))) {
      error("COLOR_INVALIDO", `${nombre}: \`color\` = ${JSON.stringify(e.color)}.`);
    } else if (e.color !== undefined) {
      aviso("COLOR_ARISTA_NO_DIBUJADO", `${nombre}: Mycelium dibuja todas las flechas del mismo color; el \`color\` se conserva pero no se ve.`);
    }
    if (e.label !== undefined) {
      aviso(
        "ETIQUETA_ARISTA_NO_DIBUJADA",
        `${nombre}: Mycelium NO dibuja la \`label\` de una flecha ("${e.label}"). Si el rótulo importa, ponelo en una tarjeta.`,
      );
    }
    if (!extremosOk) return;
    if (e.fromNode === e.toNode) {
      error("ARISTA_A_SI_MISMO", `${nombre}: sale y llega al mismo nodo "${e.fromNode}".`);
      return;
    }

    const a = porId.get(e.fromNode);
    const b = porId.get(e.toNode);
    const auto = ladosAutomaticos(a, b);
    const ladoA = LADOS.has(e.fromSide) ? e.fromSide : auto.desde;
    const ladoB = LADOS.has(e.toSide) ? e.toSide : auto.hasta;

    const clave = `${e.fromNode}|${ladoA}|${e.toNode}|${ladoB}`;
    if (vistas.has(clave)) aviso("ARISTA_DUPLICADA", `${nombre}: repite otra flecha entre "${e.fromNode}" y "${e.toNode}" por los mismos lados.`);
    vistas.add(clave);
    // Dos nodos encimados ya son un error; la flecha entre ellos no tiene
    // geometría que evaluar.
    if (seSuperponen(a, b)) return;

    // Coherencia, medida en los PUNTOS DE ENGANCHE: el lado de salida tiene que
    // mirar hacia el enganche de llegada, y el de llegada hacia el de salida. Si
    // no, la curva da la vuelta por detrás de la tarjeta. Es el único criterio:
    // la skill enseña a elegir lados con `ladosSugeridos`, que siempre lo cumple.
    // Un lazo por el mismo lado (`right → right`) pasa si los dos bordes están
    // alineados; un codo (`top → right`) pasa si el destino queda arriba y al
    // costado.
    const p1 = anclaDe(a, ladoA);
    const p2 = anclaDe(b, ladoB);
    const n1 = normal(ladoA);
    const n2 = normal(ladoB);
    const saleMal = (p2.x - p1.x) * n1.x + (p2.y - p1.y) * n1.y < -10;
    const entraMal = (p1.x - p2.x) * n2.x + (p1.y - p2.y) * n2.y < -10;
    if (saleMal || entraMal) {
      const sug = ladosSugeridos(a, b);
      const implicitos = !LADOS.has(e.fromSide) || !LADOS.has(e.toSide);
      const que = [
        saleMal ? `sale de "${a.id}" por \`${ladoA}\`, que le da la espalda a "${b.id}"` : null,
        entraMal ? `entra a "${b.id}" por \`${ladoB}\`, que le da la espalda a "${a.id}"` : null,
      ].filter(Boolean).join(" y ");
      aviso(
        "LADO_OPUESTO",
        `${nombre}: ${que}; la curva da la vuelta por detrás.${implicitos ? " (Sin fromSide/toSide, Mycelium elige por centros y en diagonal falla.)" : ""} Lo coherente acá: \`fromSide: "${sug.desde}"\` → \`toSide: "${sug.hasta}"\`.`,
      );
    }

    const { sx, sy } = separacion(a, b);
    if (Math.max(sx, sy) < 40 && a.type !== "group" && b.type !== "group") {
      aviso("FLECHA_CORTA", `${nombre}: "${a.id}" y "${b.id}" están a ${Math.max(sx, sy)}px; con menos de 40 la flecha casi no se ve.`);
    }

    // ¿La curva pasa por debajo de otra tarjeta? Las flechas se dibujan DEBAJO
    // de todos los nodos: una que cruza una tarjeta desaparece bajo ella.
    const ctrl = controlesArista(a, ladoA, b, ladoB);
    const cruzados = new Set();
    for (let k = 1; k < 48; k++) {
      const p = puntoBezier(ctrl, k / 48);
      for (const n of tarjetas) {
        if (n === a || n === b || cruzados.has(n.id)) continue;
        if (dentro(p, n, 4)) cruzados.add(n.id);
      }
    }
    for (const id of cruzados) {
      aviso("ARISTA_CRUZA_NODO", `${nombre} ("${a.id}" → "${b.id}") pasa por debajo de "${id}": se corta a la vista. Mové la tarjeta o cambiá los lados.`);
    }
  });

  return { errores, avisos };
}

function validarRuta(ruta, nombre, vault, error, aviso) {
  if (ruta.includes("\\")) {
    error("RUTA_INVALIDA", `${nombre}: "${ruta}" usa "\\"; las rutas van con "/".`);
    return;
  }
  if (ruta.startsWith("/") || /^[a-zA-Z]:/.test(ruta) || ruta.startsWith("./") || ruta.split("/").includes("..")) {
    error("RUTA_INVALIDA", `${nombre}: "${ruta}" tiene que ser relativa a la raíz del vault, sin "/", "./" ni "..".`);
    return;
  }
  const punto = ruta.lastIndexOf(".");
  const ext = punto > ruta.lastIndexOf("/") ? ruta.slice(punto + 1).toLowerCase() : "";
  if (ext === "") {
    error("RUTA_INVALIDA", `${nombre}: "${ruta}" no tiene extensión: la ruta de una nota termina en ".md".`);
    return;
  }
  if (EXT_NO_MARKDOWN.has(ext)) {
    aviso("ARCHIVO_CRUDO", `${nombre}: "${ruta}" no es una nota .md; la tarjeta mostrará su contenido crudo (JSON/XML/YAML).`);
  } else if (!EXT_NOTA.has(ext)) {
    error(
      "ARCHIVO_NO_DIBUJABLE",
      `${nombre}: "${ruta}" no es una nota. Mycelium solo muestra notas en un nodo file; una imagen o un PDF sale como «ya no existe».`,
    );
    return;
  }
  if (vault !== undefined) {
    const r = existeExacta(vault, ruta);
    if (!r.existe) {
      error(
        "ARCHIVO_NO_EXISTE",
        r.casi
          ? `${nombre}: "${ruta}" existe con OTRAS mayúsculas; Mycelium compara la ruta exacta.`
          : `${nombre}: "${ruta}" no existe en el vault; la tarjeta dirá «ya no existe».`,
      );
    }
  }
}

// ── Línea de comandos ─────────────────────────────────────────────────────────

function main(argv) {
  let vault;
  let estricto = false;
  const archivos = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--vault") vault = argv[++i];
    else if (a === "--estricto") estricto = true;
    else if (a === "-h" || a === "--help") {
      console.log("Uso: node validar-canvas.mjs [--vault <ruta>] [--estricto] <archivo.canvas>...");
      return 0;
    } else archivos.push(a);
  }
  if (archivos.length === 0) {
    console.error("Uso: node validar-canvas.mjs [--vault <ruta>] [--estricto] <archivo.canvas>...");
    return 2;
  }
  if (vault !== undefined && !existsSync(vault)) {
    console.error(`No existe el vault "${vault}".`);
    return 2;
  }

  let falla = false;
  for (const archivo of archivos) {
    let contenido;
    try {
      contenido = readFileSync(archivo, "utf8");
    } catch (e) {
      console.log(`ERROR ${archivo}: no se pudo leer (${e instanceof Error ? e.message : e})`);
      falla = true;
      continue;
    }
    const { errores, avisos } = validarCanvas(contenido.replace(/^﻿/, ""), { vault });
    const estado = errores.length > 0 ? "FALLA" : avisos.length > 0 ? "OK con avisos" : "OK";
    console.log(`${estado}  ${archivo}  (${errores.length} errores, ${avisos.length} avisos)`);
    for (const e of errores) console.log(`  ERROR [${e.codigo}] ${e.mensaje}`);
    for (const a of avisos) console.log(`  AVISO [${a.codigo}] ${a.mensaje}`);
    if (errores.length > 0 || (estricto && avisos.length > 0)) falla = true;
  }
  return falla ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  process.exitCode = main(process.argv.slice(2));
}

export { main };
