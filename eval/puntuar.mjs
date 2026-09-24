// Puntuación mecánica (nivel 1, § 7) de filas ya corridas: vuelve a puntuar
// `respuesta`/`citas`/`no_esta` contra la clave vigente y muestra el detalle.
//
//   node eval/puntuar.mjs --tanda 2026-09-24-prueba
//   node eval/puntuar.mjs --tanda X --escribir      # agrega filas corregidas (append-only)
//
// Append-only: una fila nunca se reescribe. La corrección es una fila nueva con
// el MISMO `session_id`; el informe se queda con la última de cada sesión. (La
// § 10 pide además marcar la vieja con `descartada: true`, lo que sería
// reescribirla: ver el resumen de la fase 0.)
//
// Las filas con `puntuador: "requiere-juez"` las puntúa el juez LLM (nivel 2):
// `eval/juzgar.mjs`. Una fila ya juzgada conserva el acierto del juez al
// re-puntuarla (`conservarJuicio`).

import { appendFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { inventario, prepararCorpus } from "./lib/corpus.mjs";
import { cargarPreguntas, indicePorId, leerJsonl, ultimaPorSesion } from "./lib/preguntas.mjs";
import { puntuar } from "./lib/puntuacion.mjs";

const EVAL = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(EVAL, "..");

/**
 * Si la fila ya la puntuó el juez o el humano y la regla mecánica la sigue
 * mandando al juez, el acierto de ese veredicto se conserva: re-puntuar las citas
 * no puede deshacer un juicio (y una fila nueva con `requiere-juez` lo haría,
 * porque manda la última). Si la regla ya NO la manda al juez, vale la mecánica.
 */
export function conservarJuicio(fila, p) {
  if (!["juez", "humano"].includes(fila.puntuador) || p.puntuador !== "requiere-juez") return p;
  return {
    ...p,
    acierto: fila.acierto,
    acierto_citado: fila.acierto === 1 && p.citas_exhaustividad === 1 ? 1 : 0,
    puntuador: fila.puntuador,
  };
}

function principal() {
  const { values: v } = parseArgs({
    options: {
      resultados: { type: "string", default: join(EVAL, "resultados.jsonl") },
      tanda: { type: "string" },
      escribir: { type: "boolean", default: false },
      "abrir-reserva": { type: "boolean", default: false },
    },
  });
  if (!existsSync(v.resultados)) throw new Error(`No existe ${v.resultados}`);
  const claves = indicePorId(cargarPreguntas(join(EVAL, "preguntas.jsonl"), { abrirReserva: v["abrir-reserva"] }));
  const filas = ultimaPorSesion(leerJsonl(v.resultados)).filter((f) => !v.tanda || f.tanda === v.tanda);
  const corpora = new Map();
  let cambios = 0;
  for (const f of filas) {
    const clave = claves[f.pregunta];
    if (!clave || clave.sellada) {
      console.log(`${f.pregunta} ${f.brazo}: sin clave legible (¿sellada?), se omite`);
      continue;
    }
    if (!corpora.has(f.commit_vault)) {
      const c = prepararCorpus({ repo: REPO, commit: f.commit_vault });
      corpora.set(f.commit_vault, inventario(c.dir));
    }
    const inv = corpora.get(f.commit_vault);
    const p = conservarJuicio(f, puntuar(clave, { respuesta: f.respuesta, citas: f.citas, no_esta: f.no_esta }, { titulos: inv.titulos, archivos: inv.archivos }));
    const campos = ["acierto", "distractor", "citas_precision", "citas_exhaustividad", "citas_inventadas", "acierto_citado", "puntuador"];
    const distintos = campos.filter((k) => p[k] !== f[k]);
    const prec = p.citas_precision === null ? "—" : p.citas_precision.toFixed(2);
    console.log(
      `${f.pregunta} ${f.clase} ${f.brazo.padEnd(5)} r${f.rep}  acierto=${p.acierto} citado=${p.acierto_citado} prec=${prec} exh=${p.citas_exhaustividad.toFixed(2)} inv=${p.citas_inventadas} [${p.puntuador}]` +
        (p.motivo ? `  — ${p.motivo}` : "") +
        (f.descartada ? `  (descartada: ${f.motivo_descarte})` : "") +
        (distintos.length ? `  ≠ fila: ${distintos.join(", ")}` : ""),
    );
    if (distintos.length && v.escribir) {
      const { motivo, citas, ...campos2 } = p;
      appendFileSync(v.resultados, JSON.stringify({ ...f, ...campos2 }) + "\n");
      cambios++;
    }
  }
  if (v.escribir) console.log(`\n${cambios} filas corregidas agregadas.`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    principal();
  } catch (e) {
    console.error(`FALLO: ${e.message}`);
    process.exit(1);
  }
}
