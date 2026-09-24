// Carga de `eval/preguntas.jsonl`. Las de desarrollo están en claro; las de
// reserva, selladas (ver `lib/sello.mjs`) y solo se abren si se pide.

import { readFileSync } from "node:fs";
import { abrir, leerClave } from "./sello.mjs";

export function leerJsonl(ruta) {
  return readFileSync(ruta, "utf8")
    .split("\n")
    .filter((l) => l.trim())
    .map((l, i) => {
      try {
        return JSON.parse(l);
      } catch (e) {
        throw new Error(`${ruta}:${i + 1}: ${e.message}`);
      }
    });
}

/**
 * Devuelve las preguntas vigentes (no retiradas). Las selladas vienen como
 * `{id, clase, conjunto, sellada: true}` salvo que `abrirReserva` sea true, en
 * cuyo caso se descifran con la clave del sello.
 */
export function cargarPreguntas(ruta, { abrirReserva = false, incluirRetiradas = false } = {}) {
  const lineas = leerJsonl(ruta);
  let clave = null;
  return lineas
    .filter((p) => incluirRetiradas || !p.retirada)
    .map((p) => {
      if (!p.sellada || !abrirReserva) return p;
      clave ??= leerClave();
      return { ...abrir(p, clave), sellada: false, sha256: p.sha256 };
    });
}

/**
 * La última fila de cada sesión. `resultados.jsonl` es append-only: una fila
 * corregida (repuntuada, o descartada después) se agrega con el mismo
 * `session_id` y manda sobre las anteriores.
 */
export function ultimaPorSesion(filas) {
  const m = new Map();
  for (const f of filas) m.set(f.session_id ?? `${f.tanda}/${f.pregunta}/${f.brazo}/${f.rep}`, f);
  return [...m.values()];
}

/** id → clave, para la regla de decisión (solo necesita clase y veredicto). */
export function indicePorId(preguntas) {
  return Object.fromEntries(preguntas.map((p) => [p.id, p]));
}
