// Normalización de texto y de citas, compartida por la puntuación, el validador
// de claves y el arnés. Sin dependencias: corre con `node` a secas.
//
// Ver docs/arquitectura/"MCP de Mycelium - evaluacion.md" § 3.

/** Minúsculas, sin acentos, comillas y guiones unificados, espacios colapsados. */
export function normalizar(s) {
  return String(s ?? "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[‘’‚‛`´]/g, "'")
    .replace(/[“”„«»]/g, '"')
    .replace(/[‐-―−]/g, "-")
    .replace(/ /g, " ")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Una entrada de `aceptadas`/`requeridas`/`distractores` es una cadena (se busca
 * como subcadena, normalizada) o `/regex/flags` (se evalúa sobre el texto
 * normalizado). La forma regex existe para los datos numéricos, donde "40" como
 * subcadena aceptaría cualquier cosa.
 */
export function compilarPatron(p) {
  const m = /^\/(.+)\/([a-z]*)$/s.exec(p);
  if (m) {
    const re = new RegExp(m[1], m[2].includes("g") ? m[2] : m[2] + "g");
    return {
      fuente: p,
      buscar: (t) => [...t.matchAll(re)].map((x) => ({ i: x.index, largo: x[0].length })),
    };
  }
  const aguja = normalizar(p);
  return {
    fuente: p,
    buscar: (t) => {
      const out = [];
      if (!aguja) return out;
      let i = t.indexOf(aguja);
      while (i !== -1) {
        out.push({ i, largo: aguja.length });
        i = t.indexOf(aguja, i + 1);
      }
      return out;
    },
  };
}

export function contiene(textoNormalizado, patron) {
  return compilarPatron(patron).buscar(textoNormalizado).length > 0;
}

/**
 * Normaliza una cita al título de nota: `[[Título|alias]]` → `Título`, sin ruta,
 * sin `#sección`, sin extensión `.md`. Conserva acentos y caja (así están los
 * nombres de archivo): la comparación de conjuntos es exacta, como pide la § 3.
 *
 * Un archivo de código (`frontend/lib/canvas.ts`) conserva su extensión: si se la
 * quitáramos, `canvas.ts` chocaría con la nota `canvas`.
 */
export function normalizarCita(c) {
  let s = String(c ?? "").trim();
  s = s.replace(/^!?\[\[/, "").replace(/\]\]$/, "");
  s = s.split("|")[0];
  s = s.split("#")[0];
  s = s.replace(/\\/g, "/");
  s = s.split("/").pop() ?? s;
  s = s.trim();
  if (/\.md$/i.test(s)) s = s.slice(0, -3);
  return s.normalize("NFC");
}

/** Palabras vacías para la regla de vocabulario (§ 8, sesgo 1). */
export const VACIAS = new Set(
  (
    "a al algo alguna alguno algunos ante antes aun aunque cada como con contra cual cuales cuando cuanto de del desde donde dos el ella ellas ellos en entre era eran es esa ese eso esta estaba estan estas este esto estos fue fueron ha hace hacia han hasta hay la las le les lo los mas me mi mis muy nada ni no nos o otra otras otro otros para pero poco por porque que quien se sea segun ser si sin sobre solo son su sus tal tambien tan tanto te tenia tiene tienen todo todos tu tus un una uno unos y ya yo " +
    "sera seria puede pueden hoy ahora despues quedo queda paso pasaba hizo hubo cual cuales ese esos esas eso asi aca alla qué como cual"
  ).split(/\s+/),
);

/** Palabras de contenido (normalizadas) de un texto. */
export function palabrasDeContenido(s) {
  return new Set(
    normalizar(s)
      .split(/[^a-z0-9ñ_]+/)
      .filter((w) => w.length > 2 && !VACIAS.has(w)),
  );
}
