// El juez LLM (nivel 2 de la § 7): puntúa el acierto de las filas que la
// puntuación mecánica dejó como `requiere-juez` (clases C2 y C3, y los
// distractores negados del § 4).
//
//   node eval/juzgar.mjs --tanda 2026-09-24-base                  # cuántas y cuánto costaría
//   node eval/juzgar.mjs --tanda 2026-09-24-base --probar 1       # una sola, para medir el costo
//   node eval/juzgar.mjs --tanda 2026-09-24-base --ejecutar --confirmo-costo
//
// Condiciones de la § 7, todas por construcción:
//  - CIEGO AL BRAZO: el juez recibe la pregunta, la clave, el texto de la
//    respuesta y su `no_esta`, con un identificador opaco (`lib/juez.mjs`,
//    `promptJuez`). Las filas se juzgan en orden barajado.
//  - SIN ACCESO AL VAULT: `--tools ""`, `--strict-mcp-config` sin servidores, el
//    prompt de sistema del agente REEMPLAZADO por el del juez, y una carpeta
//    temporal vacía, fuera del repo, como cwd (desde el repo cargaría el
//    CLAUDE.md, que es parte del vault). Si la transcripción muestra que cargó
//    algún archivo de instrucciones, el veredicto se descarta.
//  - SALIDA FORZADA con `--json-schema`: `{veredicto, motivo}`.
//
// Lo que produce, append-only:
//  - `eval/juicios.jsonl`: una línea por llamada al juez (modelo, versión del
//    prompt, veredicto, motivo, costo). Es el registro del juez; `resultados`
//    no tiene columnas para eso y su formato (§ 10) no se toca.
//  - `eval/resultados.jsonl`: por cada veredicto `correcto`/`incorrecto`, una
//    fila nueva con el mismo `session_id`, `puntuador: "juez"` y `juez_motivo`.
//    Un `duda` no agrega fila: la corrida sigue provisional y va al humano.

import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { entornoLimpio } from "./correr.mjs";
import { RAIZ_EVAL, rutaTranscripcion } from "./lib/corpus.mjs";
import { ESQUEMA_JUEZ, SISTEMA_JUEZ, VERSION_JUEZ, filaConVeredicto, idOpaco, pendientesDeJuez, promptJuez } from "./lib/juez.mjs";
import { cargarPreguntas, indicePorId, leerJsonl, ultimaPorSesion } from "./lib/preguntas.mjs";
import { mediana, prng } from "./lib/regla.mjs";
import { resumirTranscripcion } from "./lib/transcripcion.mjs";

const EVAL = dirname(fileURLToPath(import.meta.url));
const CONFIG = JSON.parse(readFileSync(join(EVAL, "config.json"), "utf8"));

export function argumentosJuez({ modelo, sessionId }) {
  return [
    "-p",
    "--session-id", sessionId,
    "--model", modelo,
    "--output-format", "json",
    "--json-schema", JSON.stringify(ESQUEMA_JUEZ),
    "--system-prompt", SISTEMA_JUEZ,
    "--tools", "",
    "--strict-mcp-config",
    "--setting-sources", CONFIG.setting_sources,
  ];
}

/**
 * La carpeta desde donde corre el juez: vacía y FUERA del home. Claude Code sube
 * desde el cwd buscando instrucciones y, bajo el home, encuentra el
 * `~/.claude/CLAUDE.md` del usuario (verificado en la primera prueba del juez:
 * lo cargó desde el directorio temporal). Es la misma razón por la que los
 * corpus viven en `RAIZ_EVAL` (ver `lib/corpus.mjs`).
 */
export function carpetaJuez() {
  const dir = join(RAIZ_EVAL, "juez");
  mkdirSync(dir, { recursive: true });
  if (readdirSync(dir).length) throw new Error(`${dir} tiene que estar vacía: es el cwd del juez`);
  return dir;
}

/**
 * Una llamada al juez. Devuelve `{veredicto, motivo, costo_usd, session_id,
 * descarte}`; `descarte` no nulo quiere decir que el veredicto no vale.
 */
export function llamarJuez({ clave, salida, id, modelo }) {
  const dir = carpetaJuez();
  const sessionId = randomUUID();
  const p = spawnSync("claude", argumentosJuez({ modelo, sessionId }), {
    cwd: dir,
    input: promptJuez(clave, salida, id),
    encoding: "utf8",
    env: entornoLimpio(),
    timeout: 300000,
    maxBuffer: 16 * 1024 * 1024,
    windowsHide: true,
  });
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
  else if (!so || !["correcto", "incorrecto", "duda"].includes(so.veredicto)) descarte = "sin structured_output";
  else if (!t) descarte = "sin transcripción: no se puede auditar que corrió aislado";
  else if (t.instrucciones.length) descarte = `cargó instrucciones: ${t.instrucciones.join(", ")}`;
  else if (Object.keys(t.llamadas).length) descarte = `usó herramientas: ${Object.keys(t.llamadas).join(", ")}`;
  return {
    veredicto: so?.veredicto ?? null,
    motivo: so?.motivo ?? null,
    costo_usd: r?.total_cost_usd ?? null,
    session_id: sessionId,
    version_cc: t?.version ?? null,
    descarte,
  };
}

/** La línea de `juicios.jsonl` de una llamada al juez sobre la fila `f`. */
export function registroJuicio(f, modelo, r) {
  return {
    fecha: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
    tanda: f.tanda,
    session_id: f.session_id,
    id_opaco: idOpaco(f.session_id),
    modelo_juez: modelo,
    version_juez: VERSION_JUEZ,
    version_cc: r.version_cc,
    juez_session_id: r.session_id,
    veredicto: r.veredicto,
    motivo: r.motivo,
    costo_usd: r.costo_usd,
    descartado: r.descarte !== null,
    motivo_descarte: r.descarte,
  };
}

/** Veredictos ya pagados, por sesión juzgada, de este juez (modelo + versión del prompt). */
export function juiciosPrevios(juicios, modelo) {
  const m = new Map();
  for (const j of juicios) if (!j.descartado && j.modelo_juez === modelo && j.version_juez === VERSION_JUEZ) m.set(j.session_id, j);
  return m;
}

function barajar(xs, semilla) {
  const r = prng(semilla);
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const k = Math.floor(r() * (i + 1));
    [a[i], a[k]] = [a[k], a[i]];
  }
  return a;
}

function principal() {
  const { values: v } = parseArgs({
    options: {
      resultados: { type: "string", default: join(EVAL, "resultados.jsonl") },
      juicios: { type: "string", default: join(EVAL, "juicios.jsonl") },
      tanda: { type: "string" },
      modelo: { type: "string", default: CONFIG.modelo_juez },
      semilla: { type: "string", default: "20260924" },
      probar: { type: "string" },
      ejecutar: { type: "boolean", default: false },
      "confirmo-costo": { type: "boolean", default: false },
      "abrir-reserva": { type: "boolean", default: false },
    },
  });
  if (!v.tanda) throw new Error("Falta --tanda.");
  const claves = indicePorId(cargarPreguntas(join(EVAL, "preguntas.jsonl"), { abrirReserva: v["abrir-reserva"] }));
  const juicios = existsSync(v.juicios) ? leerJsonl(v.juicios) : [];
  const previos = juiciosPrevios(juicios, v.modelo);
  const pendientes = pendientesDeJuez(ultimaPorSesion(leerJsonl(v.resultados)).filter((f) => f.tanda === v.tanda)).filter((f) => {
    const c = claves[f.pregunta];
    return c && !c.sellada;
  });

  // Veredictos ya pagados que no llegaron a `resultados` (p. ej. una corrida
  // cortada entre las dos escrituras): se aplican sin volver a pagar.
  let reaplicadas = 0;
  const porJuzgar = [];
  const enDuda = [];
  for (const f of pendientes) {
    const j = previos.get(f.session_id);
    if (!j) porJuzgar.push(f);
    else if (j.veredicto === "duda") enDuda.push(f);
    else if (v.ejecutar) {
      appendFileSync(v.resultados, JSON.stringify(filaConVeredicto(f, j.veredicto, j.motivo)) + "\n");
      reaplicadas++;
    }
  }
  const costos = juicios.filter((j) => j.modelo_juez === v.modelo && j.costo_usd != null).map((j) => j.costo_usd);
  const est = costos.length ? mediana(costos) * porJuzgar.length : null;
  console.log(`Tanda ${v.tanda}: ${pendientes.length} filas requieren juez; ${porJuzgar.length} sin veredicto de ${v.modelo} (prompt v${VERSION_JUEZ}), ${enDuda.length} en duda esperando al humano.`);
  console.log(
    est == null
      ? "Costo estimado: sin datos de este modelo — correr con --probar 1 para medirlo."
      : `Costo estimado: ${porJuzgar.length} × US$ ${mediana(costos).toFixed(4)} (mediana de ${costos.length} llamadas previas) = US$ ${est.toFixed(2)}.`,
  );

  const lote = barajar(porJuzgar, Number(v.semilla));
  const n = v.probar ? Math.min(Number(v.probar), lote.length) : v.ejecutar ? lote.length : 0;
  if (!n) return;
  if (!v.probar && !v["confirmo-costo"]) throw new Error("El juez consume cuota del usuario: agregar --confirmo-costo.");
  let gastado = 0;
  const cuenta = { correcto: 0, incorrecto: 0, duda: 0, descartado: 0 };
  for (const [i, f] of lote.slice(0, n).entries()) {
    const clave = claves[f.pregunta];
    const id = idOpaco(f.session_id);
    const r = llamarJuez({ clave, salida: { respuesta: f.respuesta, no_esta: f.no_esta }, id, modelo: v.modelo });
    gastado += r.costo_usd ?? 0;
    appendFileSync(v.juicios, JSON.stringify(registroJuicio(f, v.modelo, r)) + "\n");
    if (r.descarte) cuenta.descartado++;
    else {
      cuenta[r.veredicto]++;
      const nueva = filaConVeredicto(f, r.veredicto, r.motivo);
      if (nueva) appendFileSync(v.resultados, JSON.stringify(nueva) + "\n");
    }
    const antes = f.acierto;
    const ahora = r.veredicto === "correcto" ? 1 : r.veredicto === "incorrecto" ? 0 : null;
    console.log(
      `[${i + 1}/${n}] ${id} ${f.pregunta}: ${r.descarte ? `DESCARTADO (${r.descarte})` : r.veredicto}` +
        (ahora !== null && ahora !== antes ? ` (mecánico decía ${antes})` : "") +
        ` · US$ ${(r.costo_usd ?? 0).toFixed(4)}${r.motivo ? ` — ${r.motivo}` : ""}`,
    );
  }
  console.log(`\n${n} juicios: ${cuenta.correcto} correctos, ${cuenta.incorrecto} incorrectos, ${cuenta.duda} en duda, ${cuenta.descartado} descartados. Gastado: US$ ${gastado.toFixed(4)}.`);
  if (reaplicadas) console.log(`${reaplicadas} veredictos previos reaplicados sin costo.`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    principal();
  } catch (e) {
    console.error(`FALLO: ${e.message}`);
    process.exit(1);
  }
}
