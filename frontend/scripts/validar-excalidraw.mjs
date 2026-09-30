#!/usr/bin/env node
// Validador de dibujos `.excalidraw` tal como los abre Mycelium (`FUN-L-26`).
// Sin dependencias: corre con Node 20 dentro de cualquier vault.
//
//   node scripts/validar-excalidraw.mjs <archivo o carpeta>... [--estricto]
//
// Comprueba lo que se puede medir sin mirar el dibujo: la forma del archivo, ids
// únicos, campos que Excalidraw necesita para no descartar (o romper) la escena,
// enlaces recíprocos flecha↔forma y texto↔contenedor, extremos de flecha pegados
// al borde de su forma, texto que entra en su caja, formas encimadas o demasiado
// juntas, etiquetas de flecha sin lugar y flechas que atraviesan formas ajenas.
// Sale con código 1 si hay errores (o avisos, con `--estricto`).
//
// Lo que sabe de Excalidraw (0.18) sale de su `restore`: ver la skill
// `mycelium-excalidraw` y `docs/features/ia-skills-herramientas.md`.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// ── Constantes de Excalidraw ─────────────────────────────────────────────────
const TIPOS = new Set([
  "rectangle", "ellipse", "diamond", "arrow", "line", "text", "frame", "magicframe",
  "freedraw", "image", "embeddable", "iframe",
]);
const LINEALES = new Set(["arrow", "line"]);
const CONTENEDORES = new Set(["rectangle", "ellipse", "diamond", "arrow"]);
const ENLAZABLES = new Set(["rectangle", "ellipse", "diamond", "text", "image", "frame", "magicframe", "embeddable", "iframe"]);
const FORMAS = new Set(["rectangle", "ellipse", "diamond", "image", "embeddable", "iframe"]);
const FUENTES = { 1: "Virgil", 2: "Helvetica", 3: "Cascadia", 5: "Excalifont", 6: "Nunito", 7: "Lilita One", 8: "Comic Shanns", 9: "Liberation Sans" };
// Ancho medio real de un carácter, en fracciones de fontSize (medido con las fuentes de Excalidraw).
const ANCHO_REAL = { 1: 0.55, 2: 0.5, 3: 0.59, 5: 0.55, 6: 0.5, 7: 0.5, 8: 0.55, 9: 0.5 };
const PADDING = 5; // BOUND_TEXT_PADDING
// Regla de oro 6 de la skill: entre los BORDES de dos formas, al menos 60 px en
// horizontal o 50 en vertical (basta una: están en columnas o en filas distintas).
const SEP_H = 60, SEP_V = 50;
// El tramo de flecha que lleva una etiqueta mide al menos la etiqueta + 40 px, y 100 px.
const AIRE_ETIQUETA = 40, TRAMO_ETIQUETADO = 100;
const ESTILOS_RELLENO = new Set(["hachure", "cross-hatch", "solid", "zigzag"]);
const ESTILOS_TRAZO = new Set(["solid", "dashed", "dotted"]);
const PUNTAS = new Set([null, "arrow", "bar", "dot", "circle", "circle_outline", "triangle", "triangle_outline", "diamond", "diamond_outline", "crowfoot_one", "crowfoot_many", "crowfoot_one_or_many"]);
// Campos que `restore` completa si faltan: no rompen, pero conviene escribirlos.
const RECOMENDADOS = ["angle", "strokeColor", "backgroundColor", "fillStyle", "strokeWidth", "strokeStyle", "roughness", "opacity", "seed", "version", "versionNonce", "isDeleted", "groupIds", "boundElements", "frameId", "roundness", "locked"];

const esNum = (v) => typeof v === "number" && Number.isFinite(v);
const esEntero = (v) => Number.isInteger(v);

// ── Geometría ────────────────────────────────────────────────────────────────
function caja(e) {
  if (LINEALES.has(e.type) && Array.isArray(e.points)) {
    const xs = e.points.map((p) => e.x + p[0]), ys = e.points.map((p) => e.y + p[1]);
    return { x1: Math.min(...xs), y1: Math.min(...ys), x2: Math.max(...xs), y2: Math.max(...ys) };
  }
  if (!e.angle) return { x1: e.x, y1: e.y, x2: e.x + e.width, y2: e.y + e.height };
  const cx = e.x + e.width / 2, cy = e.y + e.height / 2, c = Math.cos(e.angle), s = Math.sin(e.angle);
  const esq = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([i, j]) => {
    const dx = (i * e.width) / 2, dy = (j * e.height) / 2;
    return [cx + dx * c - dy * s, cy + dx * s + dy * c];
  });
  return { x1: Math.min(...esq.map((p) => p[0])), y1: Math.min(...esq.map((p) => p[1])), x2: Math.max(...esq.map((p) => p[0])), y2: Math.max(...esq.map((p) => p[1])) };
}
const contiene = (a, b, m = 1) => a.x1 <= b.x1 + m && a.y1 <= b.y1 + m && a.x2 >= b.x2 - m && a.y2 >= b.y2 - m;
const solapa = (a, b, m = 2) => Math.min(a.x2, b.x2) - Math.max(a.x1, b.x1) > m && Math.min(a.y2, b.y2) - Math.max(a.y1, b.y1) > m;

function radioEsquina(e) {
  if (!e.roundness) return 0;
  const x = Math.min(e.width, e.height);
  if (e.roundness.type === 3) {
    const fijo = e.roundness.value ?? 32;
    return x <= fijo / 0.25 ? x * 0.25 : fijo;
  }
  return x * 0.25;
}

function distASegmento(px, py, ax, ay, bx, by) {
  const vx = bx - ax, vy = by - ay, L = vx * vx + vy * vy;
  const t = L ? Math.max(0, Math.min(1, ((px - ax) * vx + (py - ay) * vy) / L)) : 0;
  return Math.hypot(px - (ax + t * vx), py - (ay + t * vy));
}

/** Distancia con signo de (px, py) al contorno de la forma: > 0 afuera, < 0 adentro. */
function distAlContorno(e, px, py) {
  const cx = e.x + e.width / 2, cy = e.y + e.height / 2;
  let x = px - cx, y = py - cy;
  if (e.angle) {
    const c = Math.cos(-e.angle), s = Math.sin(-e.angle);
    [x, y] = [x * c - y * s, x * s + y * c];
  }
  const a = e.width / 2, b = e.height / 2;
  if (e.type === "ellipse") {
    let min = Infinity;
    for (let i = 0; i < 720; i++) {
      const t = (i / 720) * 2 * Math.PI;
      min = Math.min(min, Math.hypot(x - a * Math.cos(t), y - b * Math.sin(t)));
    }
    return (x / a) ** 2 + (y / b) ** 2 < 1 ? -min : min;
  }
  if (e.type === "diamond") {
    const v = [[0, -b], [a, 0], [0, b], [-a, 0]];
    let min = Infinity;
    for (let i = 0; i < 4; i++) min = Math.min(min, distASegmento(x, y, ...v[i], ...v[(i + 1) % 4]));
    return Math.abs(x) / a + Math.abs(y) / b < 1 ? -min : min;
  }
  // rectángulo (con esquinas redondeadas si corresponde), texto, imagen, marco
  const r = Math.min(radioEsquina(e), a, b);
  const qx = Math.abs(x) - (a - r), qy = Math.abs(y) - (b - r);
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
}

/** ¿El segmento cruza el rectángulo (Liang-Barsky)? */
function segmentoCruza(ax, ay, bx, by, r) {
  let t0 = 0, t1 = 1;
  const dx = bx - ax, dy = by - ay;
  for (const [p, q] of [[-dx, ax - r.x1], [dx, r.x2 - ax], [-dy, ay - r.y1], [dy, r.y2 - ay]]) {
    if (p === 0) { if (q < 0) return false; continue; }
    const t = q / p;
    if (p < 0) { if (t > t1) return false; if (t > t0) t0 = t; }
    else { if (t < t0) return false; if (t < t1) t1 = t; }
  }
  return true;
}

function medioDeFlecha(a) {
  const p = a.points, n = p.length;
  if (n % 2 === 1) { const q = p[(n - 1) / 2]; return { x: a.x + q[0], y: a.y + q[1] }; }
  const q1 = p[n / 2 - 1], q2 = p[n / 2];
  return { x: a.x + (q1[0] + q2[0]) / 2, y: a.y + (q1[1] + q2[1]) / 2 };
}

/** Área útil para el texto dentro de un contenedor (getBoundTextMaxWidth/Height). */
function areaUtil(c) {
  if (c.type === "ellipse") return { w: Math.round((c.width / 2) * Math.SQRT2) - 2 * PADDING, h: Math.round((c.height / 2) * Math.SQRT2) - 2 * PADDING };
  if (c.type === "diamond") return { w: Math.round(c.width / 2) - 2 * PADDING, h: Math.round(c.height / 2) - 2 * PADDING };
  return { w: c.width - 2 * PADDING, h: c.height - 2 * PADDING };
}

// ── Validación ───────────────────────────────────────────────────────────────
const NOMBRE_TIPO = { rectangle: "rectángulo", ellipse: "elipse", diamond: "rombo", arrow: "flecha", line: "línea", text: "texto", frame: "marco", image: "imagen", freedraw: "trazo" };

/**
 * Valida el contenido de un `.excalidraw`. Devuelve `{ errores, avisos, elementos }`,
 * cada problema como texto legible que nombra al elemento.
 */
export function validar(texto) {
  const errores = [], avisos = [];
  if (!texto.trim()) {
    avisos.push("archivo vacío: Mycelium lo abre como un dibujo en blanco");
    return { errores, avisos, elementos: 0 };
  }
  let j;
  try {
    j = JSON.parse(texto);
  } catch (e) {
    errores.push(`JSON inválido (${e.message}). Mycelium lo abriría como un dibujo VACÍO y al primer cambio lo sobrescribiría`);
    return { errores, avisos, elementos: 0 };
  }
  if (!j || typeof j !== "object" || Array.isArray(j)) {
    errores.push("el archivo tiene que ser un objeto JSON { type, version, elements, appState, files }");
    return { errores, avisos, elementos: 0 };
  }
  if (j.type === undefined) avisos.push('falta "type": "excalidraw"');
  else if (j.type !== "excalidraw") errores.push(`"type" es ${JSON.stringify(j.type)}; tiene que ser "excalidraw"`);
  if (j.version !== undefined && !esNum(j.version)) avisos.push('"version" debería ser un número (2)');
  if (j.appState !== undefined && (typeof j.appState !== "object" || j.appState === null || Array.isArray(j.appState))) avisos.push('"appState" debería ser un objeto');
  if (j.files !== undefined && j.files !== null && (typeof j.files !== "object" || Array.isArray(j.files))) errores.push('"files" tiene que ser un objeto');
  if (!Array.isArray(j.elements)) {
    errores.push('falta "elements" (un array): Mycelium abriría un dibujo vacío');
    return { errores, avisos, elementos: 0 };
  }

  const todos = j.elements;
  const porId = new Map();
  const faltantes = new Map(); // campo recomendado → cantidad de elementos sin él

  const nombre = (e) => {
    const t = NOMBRE_TIPO[e?.type] ?? e?.type ?? "elemento";
    let etiqueta = "";
    if (e?.type === "text" && typeof e.text === "string") etiqueta = e.text;
    else if (Array.isArray(e?.boundElements)) {
      const b = e.boundElements.find((x) => x?.type === "text");
      const tx = b && porId.get(b.id);
      if (tx && typeof tx.text === "string") etiqueta = tx.text;
    }
    etiqueta = etiqueta.replace(/\s+/g, " ").slice(0, 40);
    return `${t} ${e?.id ?? "(sin id)"}${etiqueta ? ` «${etiqueta}»` : ""}`;
  };

  // 1. Forma de cada elemento
  todos.forEach((e, i) => {
    if (!e || typeof e !== "object" || Array.isArray(e)) { errores.push(`elements[${i}] no es un objeto`); return; }
    if (typeof e.id !== "string" || !e.id) errores.push(`elements[${i}] (${e.type}) no tiene "id": sin id no se puede enlazar`);
    else if (porId.has(e.id)) errores.push(`id repetido «${e.id}»: Excalidraw le cambia el id al segundo y rompe sus enlaces`);
    else porId.set(e.id, e);
  });
  const vivos = todos.filter((e) => e && typeof e === "object" && !Array.isArray(e) && e.isDeleted !== true);
  const borrados = todos.length - vivos.length;
  if (borrados) avisos.push(`${borrados} elemento(s) con isDeleted: true — Mycelium los quita del archivo al guardar`);

  const validos = [];
  for (const e of vivos) {
    const n = nombre(e);
    if (!TIPOS.has(e.type)) { errores.push(`${n}: tipo desconocido ${JSON.stringify(e.type)} — Excalidraw lo descarta al cargar y Mycelium lo borra al guardar`); continue; }
    let ok = true;
    for (const k of ["x", "y"]) if (!esNum(e[k])) { errores.push(`${n}: "${k}" tiene que ser un número`); ok = false; }
    if (!LINEALES.has(e.type) && e.type !== "freedraw") {
      for (const k of ["width", "height"]) if (!esNum(e[k]) || e[k] < 0) { errores.push(`${n}: "${k}" tiene que ser un número ≥ 0`); ok = false; }
      if (ok && e.width === 0 && e.height === 0) { errores.push(`${n}: ancho y alto 0 — Excalidraw lo descarta por invisible`); ok = false; }
    }
    for (const k of RECOMENDADOS) if (!(k in e)) faltantes.set(k, (faltantes.get(k) ?? 0) + 1);
    if ("seed" in e && !esEntero(e.seed)) errores.push(`${n}: "seed" tiene que ser un entero`);
    if ("version" in e && (!esEntero(e.version) || e.version < 1)) errores.push(`${n}: "version" tiene que ser un entero ≥ 1`);
    if ("versionNonce" in e && !esEntero(e.versionNonce)) errores.push(`${n}: "versionNonce" tiene que ser un entero`);
    if ("isDeleted" in e && typeof e.isDeleted !== "boolean") errores.push(`${n}: "isDeleted" tiene que ser true o false`);
    if ("angle" in e && !esNum(e.angle)) errores.push(`${n}: "angle" tiene que ser un número (radianes)`);
    if ("groupIds" in e && (!Array.isArray(e.groupIds) || e.groupIds.some((g) => typeof g !== "string"))) errores.push(`${n}: "groupIds" tiene que ser un array de strings`);
    if ("boundElements" in e && e.boundElements !== null && (!Array.isArray(e.boundElements) || e.boundElements.some((b) => !b || typeof b.id !== "string" || !["arrow", "text"].includes(b.type)))) {
      errores.push(`${n}: "boundElements" tiene que ser null o un array de { id, type: "arrow" | "text" }`);
      e.__bindingsRotos = true;
    }
    if ("fillStyle" in e && !ESTILOS_RELLENO.has(e.fillStyle)) errores.push(`${n}: fillStyle ${JSON.stringify(e.fillStyle)} no existe (hachure, cross-hatch, solid, zigzag)`);
    if ("strokeStyle" in e && !ESTILOS_TRAZO.has(e.strokeStyle)) errores.push(`${n}: strokeStyle ${JSON.stringify(e.strokeStyle)} no existe (solid, dashed, dotted)`);
    if ("roughness" in e && (!esNum(e.roughness) || e.roughness < 0 || e.roughness > 2)) errores.push(`${n}: roughness va de 0 a 2`);
    if ("opacity" in e && (!esNum(e.opacity) || e.opacity < 0 || e.opacity > 100)) errores.push(`${n}: opacity va de 0 a 100`);
    if ("strokeWidth" in e && (!esNum(e.strokeWidth) || e.strokeWidth <= 0)) errores.push(`${n}: strokeWidth tiene que ser un número > 0`);
    for (const k of ["strokeColor", "backgroundColor"]) if (k in e && typeof e[k] !== "string") errores.push(`${n}: "${k}" tiene que ser un color en texto ("#1e1e1e", "transparent")`);
    if ("roundness" in e && e.roundness !== null && !(e.roundness && [1, 2, 3].includes(e.roundness.type))) errores.push(`${n}: roundness tiene que ser null o { type: 1 | 2 | 3 }`);

    if (e.type === "text") {
      if (typeof e.text !== "string" || !e.text) { errores.push(`${n}: "text" vacío o ausente — Excalidraw borra los textos vacíos`); ok = false; }
      if (!esNum(e.fontSize) || e.fontSize <= 0) { errores.push(`${n}: "fontSize" tiene que ser un número > 0`); ok = false; }
      if (!(e.fontFamily in FUENTES)) { errores.push(`${n}: fontFamily ${JSON.stringify(e.fontFamily)} no es una fuente de Excalidraw (5 Excalifont, 6 Nunito, 3 Cascadia, 2 Helvetica, 1 Virgil, 8 Comic Shanns)`); ok = false; }
      if (!("lineHeight" in e)) avisos.push(`${n}: sin "lineHeight" — Excalidraw lo deduce del alto; escribilo (1.25 para Excalifont)`);
      else if (!esNum(e.lineHeight) || e.lineHeight <= 0) errores.push(`${n}: "lineHeight" tiene que ser un número > 0 (1.25 para Excalifont)`);
      if (!("originalText" in e)) avisos.push(`${n}: sin "originalText" (se copia de "text")`);
      if ("textAlign" in e && !["left", "center", "right"].includes(e.textAlign)) errores.push(`${n}: textAlign tiene que ser left, center o right`);
      if ("verticalAlign" in e && !["top", "middle", "bottom"].includes(e.verticalAlign)) errores.push(`${n}: verticalAlign tiene que ser top, middle o bottom`);
      if (ok && esNum(e.lineHeight)) {
        const lineas = e.text.split("\n").length;
        const alto = lineas * e.fontSize * e.lineHeight;
        if (Math.abs(alto - e.height) > Math.max(3, alto * 0.15)) avisos.push(`${n}: alto ${e.height} no coincide con ${lineas} línea(s) × ${e.fontSize} × ${e.lineHeight} = ${Math.round(alto)}`);
      }
    }
    if (LINEALES.has(e.type)) {
      const pts = e.points;
      if (!Array.isArray(pts) || pts.length < 2 || pts.some((p) => !Array.isArray(p) || p.length < 2 || !esNum(p[0]) || !esNum(p[1]))) {
        errores.push(`${n}: "points" tiene que ser un array de al menos dos pares [x, y] — sin eso Excalidraw no carga NINGÚN elemento del dibujo`);
        ok = false;
      } else {
        if (pts[0][0] !== 0 || pts[0][1] !== 0) errores.push(`${n}: points[0] tiene que ser [0, 0] (los puntos son relativos a x, y del elemento)`);
        const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
        const w = Math.max(...xs) - Math.min(...xs), h = Math.max(...ys) - Math.min(...ys);
        if (Math.abs(w - (e.width ?? 0)) > 1 || Math.abs(h - (e.height ?? 0)) > 1) avisos.push(`${n}: width/height (${e.width}×${e.height}) no coinciden con la extensión de points (${Math.round(w)}×${Math.round(h)})`);
        if (pts.length === 2 && Math.hypot(pts[1][0], pts[1][1]) < 1) errores.push(`${n}: la flecha mide 0`);
      }
      for (const k of ["startArrowhead", "endArrowhead"]) if (k in e && !PUNTAS.has(e[k])) errores.push(`${n}: ${k} ${JSON.stringify(e[k])} no existe`);
    }
    if (ok) validos.push(e);
  }
  if (faltantes.size) {
    const lista = [...faltantes].map(([k, c]) => `${k} (${c})`).join(", ");
    avisos.push(`campos que faltan y restore completa con valores por defecto: ${lista}`);
  }

  const vivo = (id) => { const x = porId.get(id); return x && x.isDeleted !== true ? x : undefined; };
  const tieneRef = (e, id, tipo) => Array.isArray(e.boundElements) && e.boundElements.some((b) => b?.id === id && b?.type === tipo);

  // 2. Enlaces: flecha → forma y forma → flecha
  for (const a of validos.filter((e) => LINEALES.has(e.type))) {
    const n = nombre(a);
    for (const lado of ["startBinding", "endBinding"]) {
      const b = a[lado];
      if (b === null || b === undefined) continue;
      if (typeof b !== "object" || typeof b.elementId !== "string") { errores.push(`${n}: ${lado} tiene que ser null o { elementId, focus, gap }`); continue; }
      if (a.type === "line") { avisos.push(`${n}: una "line" no se enlaza (Excalidraw anula su ${lado}); usá "arrow"`); continue; }
      const f = porId.get(b.elementId);
      if (!f) { errores.push(`${n}: ${lado} apunta a «${b.elementId}», que no existe — Excalidraw suelta la flecha`); continue; }
      if (f.isDeleted === true) { errores.push(`${n}: ${lado} apunta a ${nombre(f)}, que está borrado`); continue; }
      if (!ENLAZABLES.has(f.type)) { errores.push(`${n}: ${lado} apunta a ${nombre(f)}, que no admite flechas`); continue; }
      if (!tieneRef(f, a.id, "arrow")) errores.push(`${n}: ${lado} apunta a ${nombre(f)}, pero esa forma no lista la flecha en boundElements ({ id: "${a.id}", type: "arrow" }) — al moverla, la flecha no la sigue`);
      if (!esNum(b.focus)) avisos.push(`${n}: ${lado} sin "focus" (se toma 0: apunta al centro)`);
      else if (b.focus < -1 || b.focus > 1) errores.push(`${n}: ${lado}.focus va de -1 a 1`);
      if (!esNum(b.gap)) avisos.push(`${n}: ${lado} sin "gap" (distancia al borde; usá 8)`);
      if (a.elbowed && !(Array.isArray(b.fixedPoint) && b.fixedPoint.length === 2)) errores.push(`${n}: flecha con codo (elbowed) necesita ${lado}.fixedPoint [fx, fy] (0–1 relativos a la forma)`);
      // Extremo sobre el borde
      if (validos.includes(f) && !a.elbowed) {
        const p = lado === "startBinding" ? a.points[0] : a.points[a.points.length - 1];
        const d = distAlContorno(f, a.x + p[0], a.y + p[1]);
        const gap = esNum(b.gap) ? b.gap : 5;
        if (d < -4) errores.push(`${n}: el ${lado === "startBinding" ? "inicio" : "final"} está ${Math.round(-d)} px DENTRO de ${nombre(f)}; tiene que quedar a ~${gap} px afuera del borde`);
        else if (d > gap + 12) errores.push(`${n}: el ${lado === "startBinding" ? "inicio" : "final"} queda a ${Math.round(d)} px del borde de ${nombre(f)} (gap ${gap}): la flecha no llega a la forma`);
      }
    }
    if (a.elbowed && Array.isArray(a.points)) {
      const orto = a.points.slice(1).every((p, i) => Math.abs(p[0] - a.points[i][0]) < 1 || Math.abs(p[1] - a.points[i][1]) < 1);
      if (!orto) errores.push(`${n}: flecha con codo con tramos diagonales — Excalidraw rehace su ruta`);
    }
    if (a.startBinding && a.endBinding && a.startBinding.elementId === a.endBinding.elementId) avisos.push(`${n}: empieza y termina en la misma forma`);
  }
  for (const f of validos) {
    if (!Array.isArray(f.boundElements) || f.__bindingsRotos) continue;
    const n = nombre(f);
    const vistos = new Set();
    for (const b of f.boundElements) {
      if (vistos.has(b.id)) { avisos.push(`${n}: boundElements repite «${b.id}»`); continue; }
      vistos.add(b.id);
      const x = porId.get(b.id);
      if (!x) { errores.push(`${n}: boundElements lista «${b.id}», que no existe`); continue; }
      if (x.isDeleted === true) { avisos.push(`${n}: boundElements lista ${nombre(x)}, que está borrado`); continue; }
      if (b.type === "arrow") {
        if (!LINEALES.has(x.type)) errores.push(`${n}: boundElements dice que ${nombre(x)} es una flecha`);
        else if (x.startBinding?.elementId !== f.id && x.endBinding?.elementId !== f.id) errores.push(`${n}: lista a ${nombre(x)} en boundElements, pero la flecha no la enlaza (ni startBinding ni endBinding apuntan acá)`);
      } else if (b.type === "text") {
        if (x.type !== "text") errores.push(`${n}: boundElements dice que ${nombre(x)} es un texto`);
        else if (x.containerId !== f.id) errores.push(`${n}: lista el texto ${nombre(x)}, pero su containerId es ${JSON.stringify(x.containerId ?? null)}`);
      }
    }
    if (f.boundElements.filter((b) => b.type === "text" && vivo(b.id)).length > 1) errores.push(`${n}: tiene más de un texto adentro; un contenedor admite uno solo`);
  }

  // 3. Texto ↔ contenedor, y que el texto entre
  for (const t of validos.filter((e) => e.type === "text" && e.containerId)) {
    const n = nombre(t);
    const c = porId.get(t.containerId);
    if (!c) { errores.push(`${n}: containerId «${t.containerId}» no existe`); continue; }
    if (c.isDeleted === true) { errores.push(`${n}: su contenedor ${nombre(c)} está borrado`); continue; }
    if (!CONTENEDORES.has(c.type)) { errores.push(`${n}: ${nombre(c)} no puede contener texto (solo rectángulo, elipse, rombo o flecha)`); continue; }
    if (!tieneRef(c, t.id, "text")) errores.push(`${n}: su contenedor ${nombre(c)} no lo lista en boundElements ({ id: "${t.id}", type: "text" })`);
    if (!validos.includes(c)) continue;
    const lineas = t.text.split("\n");
    const ancho = Math.max(...lineas.map((l) => [...l].length)) * t.fontSize * (ANCHO_REAL[t.fontFamily] ?? 0.55);
    const alto = lineas.length * t.fontSize * (esNum(t.lineHeight) ? t.lineHeight : 1.25);
    if (c.type === "arrow") {
      const m = medioDeFlecha(c);
      const dc = Math.hypot(t.x + t.width / 2 - m.x, t.y + t.height / 2 - m.y);
      if (dc > 20) avisos.push(`${n}: la etiqueta está a ${Math.round(dc)} px del medio de su flecha; Excalidraw la recoloca ahí al tocarla`);
      const max = Math.max(0.7 * c.width, t.fontSize * 11);
      if (ancho > max + 2) errores.push(`${n}: etiqueta de ~${Math.round(ancho)} px en una flecha que admite ${Math.round(max)} px: partila con \\n o alargá la flecha`);
      continue;
    }
    const util = areaUtil(c);
    if (ancho > util.w + 2) errores.push(`${n}: no entra a lo ancho — mide ~${Math.round(ancho)} px y ${nombre(c)} deja ${util.w} px útiles (${c.type === "rectangle" ? "ancho − 10" : c.type === "ellipse" ? "ancho × 0,707 − 10" : "ancho / 2 − 10"}): agrandá la forma o partí el texto con \\n`);
    if (alto > util.h + 2) errores.push(`${n}: no entra a lo alto — ${lineas.length} línea(s) miden ${Math.round(alto)} px y ${nombre(c)} deja ${util.h} px útiles`);
    const bc = caja(c), bt = caja(t);
    if (!contiene(bc, bt, 3)) errores.push(`${n}: está corrido fuera de su contenedor ${nombre(c)} (¿se movió la forma sin su texto?)`);
    else if (t.textAlign === "center" && t.verticalAlign === "middle") {
      const dx = t.x + t.width / 2 - (c.x + c.width / 2), dy = t.y + t.height / 2 - (c.y + c.height / 2);
      if (Math.hypot(dx, dy) > 6) avisos.push(`${n}: no está centrado en ${nombre(c)} (corrido ${Math.round(dx)}, ${Math.round(dy)} px)`);
    }
  }

  // 4. Marcos y grupos
  for (const e of validos) {
    if (e.frameId === undefined || e.frameId === null) continue;
    const m = porId.get(e.frameId);
    if (!m || m.isDeleted === true) { errores.push(`${nombre(e)}: frameId «${e.frameId}» no existe`); continue; }
    if (m.type !== "frame" && m.type !== "magicframe") { errores.push(`${nombre(e)}: frameId apunta a ${nombre(m)}, que no es un marco`); continue; }
    if (validos.includes(m) && !contiene(caja(m), caja(e), 1)) avisos.push(`${nombre(e)}: se sale de su marco ${nombre(m)} — lo que queda afuera no se ve (el marco recorta)`);
  }

  // 5. Disposición: formas encimadas, texto suelto encima de formas, flechas que atraviesan
  const formas = validos.filter((e) => FORMAS.has(e.type));
  const sueltos = validos.filter((e) => e.type === "text" && !e.containerId);
  for (let i = 0; i < formas.length; i++) {
    for (let k = i + 1; k < formas.length; k++) {
      const a = formas[i], b = formas[k], ca = caja(a), cb = caja(b);
      if (!solapa(ca, cb) || contiene(ca, cb, 0) || contiene(cb, ca, 0)) continue;
      errores.push(`${nombre(a)} y ${nombre(b)} se superponen: separalas (o que una contenga entera a la otra)`);
    }
  }
  for (let i = 0; i < formas.length; i++) {
    for (let k = i + 1; k < formas.length; k++) {
      const a = formas[i], b = formas[k], ca = caja(a), cb = caja(b);
      if (solapa(ca, cb) || contiene(ca, cb, 0) || contiene(cb, ca, 0)) continue;
      const h = Math.max(cb.x1 - ca.x2, ca.x1 - cb.x2), v = Math.max(cb.y1 - ca.y2, ca.y1 - cb.y2);
      if (h < SEP_H - 1 && v < SEP_V - 1) {
        const lado = v >= h ? `${Math.round(v)} px en vertical (mínimo ${SEP_V})` : `${Math.round(h)} px en horizontal (mínimo ${SEP_H})`;
        avisos.push(`${nombre(a)} y ${nombre(b)} están demasiado juntas: ${lado} entre bordes`);
      }
    }
  }
  for (const t of sueltos) {
    const ct = caja(t);
    for (const f of formas) {
      const cf = caja(f);
      if (solapa(ct, cf) && !contiene(cf, ct, 0)) avisos.push(`${nombre(t)} se monta sobre el borde de ${nombre(f)}`);
    }
    for (const u of sueltos) if (u !== t && u.id > t.id && solapa(ct, caja(u))) avisos.push(`${nombre(t)} y ${nombre(u)} se superponen`);
  }
  for (const a of validos.filter((e) => LINEALES.has(e.type))) {
    const b = Array.isArray(a.boundElements) && a.boundElements.find((x) => x?.type === "text");
    const t = b && vivo(b.id);
    if (t && validos.includes(t)) {
      const p = a.points, n = p.length;
      if (n % 2 === 0) {
        const [q1, q2] = [p[n / 2 - 1], p[n / 2]];
        const L = Math.hypot(q2[0] - q1[0], q2[1] - q1[1]);
        const along = (Math.abs(q2[0] - q1[0]) * t.width + Math.abs(q2[1] - q1[1]) * t.height) / (L || 1);
        const min = Math.max(along + AIRE_ETIQUETA, TRAMO_ETIQUETADO);
        if (L < min - 1) avisos.push(`${nombre(a)}: el tramo que lleva la etiqueta mide ${Math.round(L)} px y la etiqueta tapa casi todo; necesita ≥ ${Math.round(min)} px (separá más las formas)`);
      } else if (n >= 3 && !a.roundness) {
        // Con un número impar de puntos la etiqueta va sobre el punto del medio: si es un codo, lo tapa
        const [q0, q1, q2] = [p[(n - 3) / 2], p[(n - 1) / 2], p[(n + 1) / 2]];
        const cruz = (q1[0] - q0[0]) * (q2[1] - q1[1]) - (q1[1] - q0[1]) * (q2[0] - q1[0]);
        if (Math.abs(cruz) > Math.hypot(q1[0] - q0[0], q1[1] - q0[1]) * Math.hypot(q2[0] - q1[0], q2[1] - q1[1]) * 0.05) {
          avisos.push(`${nombre(a)}: la etiqueta cae justo en un codo y lo tapa; agregá un punto intermedio alineado sobre un tramo (cantidad par de puntos → va al medio del tramo central)`);
        }
      }
    }
    const extremos = [a.startBinding?.elementId, a.endBinding?.elementId].map((id) => id && porId.get(id)).filter(Boolean);
    const cajasExt = extremos.map(caja);
    for (const f of formas) {
      if (extremos.includes(f)) continue;
      const cf = caja(f);
      if (cajasExt.some((ce) => contiene(cf, ce, 0))) continue; // la forma envuelve a un extremo (zona, pantalla)
      const r = { x1: cf.x1 + 4, y1: cf.y1 + 4, x2: cf.x2 - 4, y2: cf.y2 - 4 };
      if (r.x1 >= r.x2 || r.y1 >= r.y2) continue;
      const pts = a.points.map((p) => [a.x + p[0], a.y + p[1]]);
      if (pts.slice(1).some((p, i) => segmentoCruza(pts[i][0], pts[i][1], p[0], p[1], r))) avisos.push(`${nombre(a)} atraviesa ${nombre(f)}: rodeala con puntos intermedios o mové las formas`);
    }
  }

  // 6. Área: Mycelium abre el dibujo encuadrado entero, y una nota lo embebe al ancho de la nota
  if (validos.length) {
    const cs = validos.map(caja);
    const x1 = Math.min(...cs.map((c) => c.x1)), y1 = Math.min(...cs.map((c) => c.y1));
    const x2 = Math.max(...cs.map((c) => c.x2)), y2 = Math.max(...cs.map((c) => c.y2));
    if (x1 < -20000 || y1 < -20000 || x2 > 20000 || y2 > 20000) avisos.push(`hay elementos muy lejos (${Math.round(x1)}, ${Math.round(y1)}) – (${Math.round(x2)}, ${Math.round(y2)}): al encuadrar el dibujo entero, todo se ve diminuto`);
    else if (x2 - x1 > 2400) avisos.push(`el dibujo mide ${Math.round(x2 - x1)} px de ancho: encuadrado al abrirlo o embebido en una nota, la letra queda ilegible. Compactalo (≤ 2400 px)`);
  }
  return { errores, avisos, elementos: validos.length };
}

// ── CLI ──────────────────────────────────────────────────────────────────────
function archivosDe(ruta) {
  if (statSync(ruta).isDirectory()) {
    return readdirSync(ruta, { withFileTypes: true }).flatMap((d) => {
      if (d.name.startsWith(".")) return [];
      const r = join(ruta, d.name);
      return d.isDirectory() ? archivosDe(r) : d.name.endsWith(".excalidraw") ? [r] : [];
    });
  }
  return [ruta];
}

function principal(argv) {
  const estricto = argv.includes("--estricto");
  const rutas = argv.filter((a) => !a.startsWith("--"));
  if (!rutas.length) {
    console.error("uso: node validar-excalidraw.mjs <archivo.excalidraw | carpeta>... [--estricto]");
    return 2;
  }
  let fallo = false;
  for (const r of rutas.flatMap((r) => { try { return archivosDe(r); } catch { return [r]; } })) {
    let texto;
    try { texto = readFileSync(r, "utf8"); } catch (e) { console.log(`✘ ${r}: no se pudo leer (${e.code ?? e.message})`); fallo = true; continue; }
    const { errores, avisos, elementos } = validar(texto);
    const malo = errores.length > 0 || (estricto && avisos.length > 0);
    fallo ||= malo;
    console.log(`${malo ? "✘" : "✔"} ${r} — ${elementos} elementos, ${errores.length} error(es), ${avisos.length} aviso(s)`);
    for (const e of errores) console.log(`  ERROR  ${e}`);
    for (const a of avisos) console.log(`  aviso  ${a}`);
  }
  return fallo ? 1 : 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) process.exitCode = principal(process.argv.slice(2));
