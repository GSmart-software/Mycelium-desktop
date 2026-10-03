// La revisión de citas (ver `lib/citas.mjs`): para cada fila que acierta pero
// cita una nota fuera de la clave, un juez decide si esa nota sostiene el dato.
//
//   node eval/revisar-citas.mjs --vault <json> --tanda X                     # cuántas y cuánto costaría
//   node eval/revisar-citas.mjs --vault <json> --tanda X --probar 1          # una sola, para medir el costo
//   node eval/revisar-citas.mjs --vault <json> --tanda X --ejecutar --confirmo-costo
//
// Mismas condiciones de aislamiento que `juzgar.mjs` (sin herramientas, sin
// servidores MCP, prompt de sistema propio, cwd vacío fuera del home). El juez
// ve la pregunta, el dato y el texto de la nota: NO la respuesta ni el brazo.
//
// Lo que produce, append-only:
//  - `citas.jsonl` (junto a los resultados): una línea por llamada, con la
//    pregunta, la nota, el veredicto y el costo. Un veredicto sobre el par
//    (pregunta, nota) no se vuelve a pagar.
//  - `resultados`: por cada fila rescatada, una fila nueva con el mismo
//    `session_id`, `acierto_citado: 1` y `citas_revisadas`.

import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { entornoLimpio } from "./correr.mjs";
import { carpetaJuez } from "./juzgar.mjs";
import { ESQUEMA_CITAS, SISTEMA_CITAS, VERSION_CITAS, extracto, filaConCitaRevisada, notasARevisar, pendientesDeCitas, promptCitas } from "./lib/citas.mjs";
import { inventario, rutaTranscripcion } from "./lib/corpus.mjs";
import { cargarPreguntas, indicePorId, leerJsonl, ultimaPorSesion } from "./lib/preguntas.mjs";
import { mediana } from "./lib/regla.mjs";
import { resumirTranscripcion } from "./lib/transcripcion.mjs";
import { OPCION_VAULT, prepararCorpusDe, vaultDeArgs } from "./lib/vault.mjs";

const VAULT = vaultDeArgs();
const CONFIG = VAULT.config;

function llamarRevisor({ prompt, modelo }) {
  const sessionId = randomUUID();
  const p = spawnSync(
    "claude",
    [
      "-p",
      "--session-id", sessionId,
      "--model", modelo,
      "--output-format", "json",
      "--json-schema", JSON.stringify(ESQUEMA_CITAS),
      "--system-prompt", SISTEMA_CITAS,
      "--tools", "",
      "--strict-mcp-config",
      "--setting-sources", CONFIG.setting_sources,
    ],
    { cwd: carpetaJuez(), input: prompt, encoding: "utf8", env: entornoLimpio(), timeout: 300000, maxBuffer: 16 * 1024 * 1024, windowsHide: true },
  );
  let r = null;
  try {
    r = JSON.parse(p.stdout);
  } catch {
    r = null;
  }
  const rutaT = rutaTranscripcion(sessionId);
  const t = rutaT ? resumirTranscripcion(readFileSync(rutaT, "utf8")) : null;
  const so = r?.structured_output ?? null;
  let descarte = null;
  if (!r) descarte = `la salida no es JSON${p.stderr ? `: ${p.stderr.slice(0, 200)}` : ""}`;
  else if (r.is_error) descarte = `is_error (${r.subtype ?? "?"})`;
  else if (!so || !["sostiene", "no_sostiene", "duda"].includes(so.veredicto)) descarte = "sin structured_output";
  else if (!t) descarte = "sin transcripción: no se puede auditar que corrió aislado";
  else if (t.instrucciones.length) descarte = `cargó instrucciones: ${t.instrucciones.join(", ")}`;
  else if (Object.keys(t.llamadas).length) descarte = `usó herramientas: ${Object.keys(t.llamadas).join(", ")}`;
  return { veredicto: so?.veredicto ?? null, motivo: so?.motivo ?? null, costo_usd: r?.total_cost_usd ?? null, session_id: sessionId, descarte };
}

function principal() {
  const { values: v } = parseArgs({
    options: {
      ...OPCION_VAULT,
      resultados: { type: "string", default: VAULT.resultados },
      registro: { type: "string" },
      tanda: { type: "string" },
      modelo: { type: "string", default: CONFIG.modelo_juez },
      probar: { type: "string" },
      ejecutar: { type: "boolean", default: false },
      "confirmo-costo": { type: "boolean", default: false },
      "abrir-reserva": { type: "boolean", default: false },
    },
  });
  if (!v.tanda) throw new Error("Falta --tanda.");
  const registro = v.registro ?? join(dirname(v.resultados), "citas.jsonl");
  const claves = indicePorId(cargarPreguntas(VAULT.preguntas, { abrirReserva: v["abrir-reserva"], rutaClave: VAULT.sello }));
  const filas = ultimaPorSesion(leerJsonl(v.resultados)).filter((f) => f.tanda === v.tanda);
  const pendientes = pendientesDeCitas(filas, claves);

  const previos = new Map();
  const costos = [];
  for (const j of existsSync(registro) ? leerJsonl(registro) : []) {
    if (j.costo_usd != null) costos.push(j.costo_usd);
    if (!j.descartado && j.modelo === v.modelo && j.version === VERSION_CITAS) previos.set(`${j.pregunta}\u0000${j.nota}`, j);
  }

  const corpora = new Map();
  const inv = (commit) => {
    if (!corpora.has(commit)) corpora.set(commit, inventario(prepararCorpusDe(VAULT, { commit }).dir));
    return corpora.get(commit);
  };
  // Los pares (pregunta, nota) a decidir, sin repetir: un veredicto vale para
  // toda fila que citó esa nota en esa pregunta, de cualquier brazo.
  const pares = new Map();
  for (const f of pendientes) {
    const i = inv(f.commit_vault);
    for (const nota of notasARevisar(f, claves[f.pregunta], i.titulos)) {
      const k = `${f.pregunta}\u0000${nota}`;
      if (!pares.has(k)) pares.set(k, { pregunta: f.pregunta, nota, ruta: i.notas.get(nota) });
    }
  }
  const porDecidir = [...pares.entries()].filter(([k]) => !previos.has(k));
  const med = costos.length ? mediana(costos) : null;
  console.log(
    `Tanda ${v.tanda}: ${pendientes.length} filas aciertan con citas fuera de la clave; ${pares.size} pares (pregunta, nota) a revisar, ` +
      `${porDecidir.length} sin veredicto.` +
      (med == null ? " Costo: sin datos — correr con --probar 1." : ` Costo estimado: US$ ${(med * porDecidir.length).toFixed(2)}.`),
  );

  const n = v.probar ? Math.min(Number(v.probar), porDecidir.length) : v.ejecutar ? porDecidir.length : 0;
  if (n && !v.probar && !v["confirmo-costo"]) throw new Error("El revisor consume cuota del usuario: agregar --confirmo-costo.");
  let gastado = 0;
  for (const [i, [k, par]] of porDecidir.slice(0, n).entries()) {
    const clave = claves[par.pregunta];
    const nota = extracto(readFileSync(par.ruta, "utf8"), clave);
    const r = llamarRevisor({ prompt: promptCitas(clave, par.nota, nota), modelo: v.modelo });
    gastado += r.costo_usd ?? 0;
    const linea = {
      fecha: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
      tanda: v.tanda,
      pregunta: par.pregunta,
      nota: par.nota,
      extractos: nota.extractos,
      modelo: v.modelo,
      version: VERSION_CITAS,
      veredicto: r.veredicto,
      motivo: r.motivo,
      costo_usd: r.costo_usd,
      revisor_session_id: r.session_id,
      descartado: r.descarte !== null,
      motivo_descarte: r.descarte,
    };
    appendFileSync(registro, JSON.stringify(linea) + "\n");
    if (!r.descarte) previos.set(k, linea);
    console.log(`[${i + 1}/${n}] ${par.pregunta} · ${par.nota}: ${r.descarte ? `DESCARTADO (${r.descarte})` : r.veredicto} · US$ ${(r.costo_usd ?? 0).toFixed(4)}${r.motivo ? ` — ${r.motivo.slice(0, 200)}` : ""}`);
  }
  if (n) console.log(`Gastado: US$ ${gastado.toFixed(4)}.`);

  // Aplicar: una fila se rescata con la primera nota citada que la sostiene.
  if (!v.ejecutar) return;
  let rescatadas = 0;
  for (const f of pendientes) {
    const i = inv(f.commit_vault);
    for (const nota of notasARevisar(f, claves[f.pregunta], i.titulos)) {
      const j = previos.get(`${f.pregunta}\u0000${nota}`);
      if (j?.veredicto === "sostiene") {
        appendFileSync(v.resultados, JSON.stringify(filaConCitaRevisada(f, nota, j.motivo)) + "\n");
        rescatadas++;
        break;
      }
    }
  }
  console.log(`${rescatadas} filas recuperan el acierto citado.`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    principal();
  } catch (e) {
    console.error(`FALLO: ${e.message}`);
    process.exit(1);
  }
}
