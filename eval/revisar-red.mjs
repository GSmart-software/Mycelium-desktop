// Revisa las corridas YA hechas buscando accesos a la red (diagnóstico de la
// fase 1, § 3.6) y, con --escribir, descarta las que salieron del corpus.
//
//   node eval/revisar-red.mjs                          # todas las tandas, solo muestra
//   node eval/revisar-red.mjs --tanda 2026-09-24-base  # una tanda
//   node eval/revisar-red.mjs --escribir               # agrega las filas de descarte
//
// Append-only (§ 10): el descarte es una fila NUEVA con el mismo `session_id`,
// igual a la última de esa sesión salvo `descartada` y `motivo_descarte`; manda
// la última. Una corrida ya descartada por otro motivo no se toca: ya no cuenta.
// No llama a la API: lee las transcripciones de `~/.claude/projects/`.

import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { rutaTranscripcion } from "./lib/corpus.mjs";
import { leerJsonl, ultimaPorSesion } from "./lib/preguntas.mjs";
import { motivoRed } from "./lib/red.mjs";
import { resumirTranscripcion } from "./lib/transcripcion.mjs";

const EVAL = dirname(fileURLToPath(import.meta.url));

/**
 * Las filas de descarte que corresponden a `filas` (las últimas por sesión),
 * dado un lector de transcripciones `leer(session_id) → texto | null`.
 * Devuelve también lo que no se pudo revisar, para decirlo.
 */
export function descartesPorRed(filas, leer) {
  const nuevas = [];
  const hallazgos = [];
  const sinTranscripcion = [];
  for (const f of filas) {
    const texto = leer(f.session_id);
    if (texto == null) {
      sinTranscripcion.push(f);
      continue;
    }
    const red = resumirTranscripcion(texto).red;
    if (!red.length) continue;
    hallazgos.push({ fila: f, red });
    if (!f.descartada) nuevas.push({ ...f, descartada: true, motivo_descarte: motivoRed(red) });
  }
  return { nuevas, hallazgos, sinTranscripcion };
}

function principal() {
  const { values: v } = parseArgs({
    options: {
      resultados: { type: "string", default: join(EVAL, "resultados.jsonl") },
      tanda: { type: "string" },
      escribir: { type: "boolean", default: false },
    },
  });
  const filas = ultimaPorSesion(leerJsonl(v.resultados)).filter((f) => !v.tanda || f.tanda === v.tanda);
  const leer = (id) => {
    const p = rutaTranscripcion(id);
    return p && existsSync(p) ? readFileSync(p, "utf8") : null;
  };
  const { nuevas, hallazgos, sinTranscripcion } = descartesPorRed(filas, leer);
  console.log(`${filas.length} corridas revisadas (última fila de cada sesión), ${sinTranscripcion.length} sin transcripción.`);
  for (const { fila: f, red } of hallazgos) {
    console.log(
      `\n${f.tanda} ${f.pregunta} ${f.brazo} r${f.rep} ${f.session_id.slice(0, 8)} · acierto_citado=${f.acierto_citado}` +
        (f.descartada ? ` · ya descartada (${f.motivo_descarte})` : ""),
    );
    for (const a of red) console.log(`  ${a.herramienta} [${a.motivo}] ${a.fragmento}`);
  }
  console.log(`\n${hallazgos.length} corridas con acceso a la red; ${nuevas.length} sin descartar todavía.`);
  if (sinTranscripcion.length) console.log(`Sin transcripción: ${sinTranscripcion.map((f) => `${f.tanda}/${f.pregunta}/${f.brazo}/r${f.rep}`).join(", ")}`);
  if (v.escribir) {
    for (const f of nuevas) appendFileSync(v.resultados, JSON.stringify(f) + "\n");
    console.log(`${nuevas.length} filas de descarte agregadas.`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    principal();
  } catch (e) {
    console.error(`FALLO: ${e.message}`);
    process.exit(1);
  }
}
