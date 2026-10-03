// Secciones de una nota por encabezado, con la cadena completa de ancestros
// (`Nota > H2 > H3`), que es como las indexa el MCP (plan § 4.4). Sirve para
// `secciones_clave` (clase C8).

import { normalizar } from "./texto.mjs";

function limpiarEncabezado(s) {
  return s
    .replace(/`/g, "")
    .replace(/\*\*|__/g, "")
    .replace(/\[\[([^\]|]+)(\|[^\]]+)?\]\]/g, "$1")
    .trim();
}

/** Lista de secciones `{ nivel, ruta: [..encabezados], texto }` de un markdown. */
export function secciones(markdown) {
  const lineas = String(markdown).split(/\r?\n/);
  const heads = [];
  let cerco = false;
  lineas.forEach((l, i) => {
    if (/^\s*(```|~~~)/.test(l)) cerco = !cerco;
    if (cerco) return;
    const m = /^(#{1,6})\s+(.*)$/.exec(l);
    if (m) heads.push({ nivel: m[1].length, titulo: limpiarEncabezado(m[2]), linea: i });
  });
  const out = [];
  const pila = [];
  heads.forEach((h, k) => {
    while (pila.length && pila.at(-1).nivel >= h.nivel) pila.pop();
    pila.push(h);
    let fin = lineas.length;
    for (let j = k + 1; j < heads.length; j++)
      if (heads[j].nivel <= h.nivel) {
        fin = heads[j].linea;
        break;
      }
    out.push({
      nivel: h.nivel,
      // El H1 es el título de la nota: la ruta empieza en el H2.
      ruta: pila.filter((p) => p.nivel > 1).map((p) => p.titulo),
      texto: lineas.slice(h.linea, fin).join("\n"),
    });
  });
  return out;
}

/** Busca la sección por su ruta (`["5. La instancia…", "En desarrollo…"]`). */
export function buscarSeccion(markdown, ruta) {
  const objetivo = ruta.map(normalizar).join(" > ");
  return secciones(markdown).find((s) => s.ruta.map(normalizar).join(" > ") === objetivo) ?? null;
}

/** `"Nota > H2 > H3"` → `{ nota, ruta }`. El título de nota puede tener « - ». */
export function partirSeccionClave(s) {
  const [nota, ...ruta] = s.split(" > ");
  return { nota: nota.trim(), ruta: ruta.map((r) => r.trim()) };
}
