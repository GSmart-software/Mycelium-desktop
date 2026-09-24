// Arnés de evaluación del MCP de Mycelium (`FUN-L-09`, fase 0).
//
// Una corrida = una pregunta, un brazo, una sesión nueva (§ 7). Corre
// `claude -p --output-format json --json-schema` en una copia del vault fijada
// en un commit, lee la transcripción para las llamadas a herramientas y el
// crecimiento del contexto, puntúa mecánicamente y agrega UNA fila con el
// formato de la § 10 a `eval/resultados.jsonl`.
//
//   node eval/correr.mjs --pregunta D01 --brazo base --tanda 2026-09-24-prueba
//   node eval/correr.mjs --plan --tanda 2026-10-01-base --brazos ciego,base --semilla 7
//   node eval/correr.mjs --plan ... --ejecutar --confirmo-costo
//
// Brazos: `ciego` (sin herramientas), `base` (Bash/Glob/Grep/Read/Skill +
// CLAUDE.md + skill), `mcp` (lo de base más `--mcp-config`). Ver
// docs/arquitectura/"MCP de Mycelium - evaluacion.md".
//
// Sin dependencias: `node` a secas, como `frontend/scripts/test-*.mjs`.

import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { appendFileSync, copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { costoRecalculado, tokensPorCategoria } from "./lib/costo.mjs";
import { huella, inventario, invalidarCorpus, prepararCorpus, rutaTranscripcion } from "./lib/corpus.mjs";
import { cargarPreguntas, leerJsonl, ultimaPorSesion } from "./lib/preguntas.mjs";
import { puntuar } from "./lib/puntuacion.mjs";
import { prng, mediana } from "./lib/regla.mjs";
import { resumirTranscripcion } from "./lib/transcripcion.mjs";

const EVAL = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(EVAL, "..");
const CONFIG = JSON.parse(readFileSync(join(EVAL, "config.json"), "utf8"));
const PESOS = JSON.parse(readFileSync(join(EVAL, "pesos-costo.json"), "utf8"));

/**
 * El esquema de salida (§ 6: «es parte del protocolo, no una comodidad»). Las
 * descripciones son la única instrucción sobre el formato: la pregunta va sola,
 * sin pistas (§ 7, regla 1), y el esquema es idéntico en los tres brazos.
 */
export const ESQUEMA = {
  type: "object",
  properties: {
    respuesta: { type: "string", description: "La respuesta a la pregunta, en prosa." },
    citas: {
      type: "array",
      items: { type: "string" },
      description:
        "Títulos de las notas del vault que sostienen la respuesta: el nombre del archivo, sin ruta ni extensión .md. Lista vacía si no hay ninguna.",
    },
    no_esta: {
      type: "boolean",
      description: "true si el vault no contiene la respuesta a la pregunta.",
    },
  },
  required: ["respuesta", "citas", "no_esta"],
  additionalProperties: false,
};

const BRAZOS = ["ciego", "base", "mcp"];

/** Variables del Claude Code que lanza el arnés: ninguna de la sesión que lo lanzó. */
function entornoLimpio() {
  const env = {};
  for (const [k, v] of Object.entries(process.env)) if (!/^CLAUDE/i.test(k)) env[k] = v;
  // Sin memoria automática: sería contexto que no es ni el vault ni el control.
  env.CLAUDE_CODE_DISABLE_AUTO_MEMORY = "1";
  return env;
}

export function argumentosClaude({ brazo, modelo, effort, sessionId, mcpConfig }) {
  const a = [
    "-p",
    "--session-id", sessionId,
    "--model", modelo,
    "--output-format", "json",
    "--json-schema", JSON.stringify(ESQUEMA),
    "--permission-mode", "bypassPermissions",
    "--setting-sources", CONFIG.setting_sources,
    "--strict-mcp-config",
  ];
  if (effort) a.push("--effort", effort);
  if (brazo === "ciego") a.push("--tools", "");
  else a.push("--tools", CONFIG.herramientas_base.join(","));
  if (brazo === "mcp") {
    if (!mcpConfig || !existsSync(mcpConfig)) throw new Error(`El brazo mcp necesita --mcp-config (no existe: ${mcpConfig})`);
    a.push("--mcp-config", mcpConfig);
  }
  return a;
}

/** Una corrida con descarte explícito (§ 7, regla 5): nunca se borra, se anota. */
function motivoDescarte(r, t, esperado, dirCorpus) {
  if (!r) return "la salida no es JSON";
  const ajenas = (t?.instrucciones ?? []).filter((p) => !p.toLowerCase().startsWith(dirCorpus.toLowerCase()));
  if (ajenas.length) return `instrucciones de fuera del corpus: ${ajenas.join(", ")}`;
  if (r.is_error) return `is_error (${r.subtype ?? "?"})`;
  if (Array.isArray(r.permission_denials) && r.permission_denials.length) return "permission_denials";
  if (r.subtype && r.subtype !== "success") return `subtype ${r.subtype}`;
  if (r.terminal_reason && r.terminal_reason !== "completed") return `terminal_reason ${r.terminal_reason}`;
  // Con --json-schema la corrida termina en la llamada a StructuredOutput: `tool_use` es lo normal.
  if (r.stop_reason && !["end_turn", "tool_use"].includes(r.stop_reason)) return `stop_reason ${r.stop_reason}`;
  if (!r.structured_output) return "sin structured_output";
  if (t?.hooks) return `corrieron hooks (${t.hooks} stop_hook_summary)`;
  if (t && t.modelos.length && !t.modelos.every((m) => m.startsWith(esperado.split("-2")[0])))
    return `modelo inesperado en la transcripción: ${t.modelos.join(", ")}`;
  return null;
}

/**
 * Reparto de la escritura de caché por TTL. Claude Code escribe con TTL de 1 h
 * (verificado: `ephemeral_1h_input_tokens` en la primera corrida de prueba), que
 * cuesta 2× la entrada y no 1,25×. Se toma del `usage` del resultado y, si falta,
 * de la transcripción.
 */
function ttlDe(r, t) {
  const c = r?.usage?.cache_creation;
  if (c) return { "5m": c.ephemeral_5m_input_tokens ?? 0, "1h": c.ephemeral_1h_input_tokens ?? 0 };
  return t?.cacheEscrituraPorTtl ?? null;
}

export function correrUna({ pregunta, brazo, tanda, rep = 1, modelo, effort, semilla = null, salida, mcpConfig, versionMcp = null, forzarDescarte = null, depurar = null }) {
  if (!BRAZOS.includes(brazo)) throw new Error(`brazo desconocido: ${brazo}`);
  const corpus = prepararCorpus({ repo: REPO, commit: CONFIG.commit_vault });
  const sessionId = randomUUID();
  const args = argumentosClaude({ brazo, modelo, effort, sessionId, mcpConfig });
  // Solo para auditar el entorno (qué CLAUDE.md, skills y hooks cargó): no en tandas.
  if (depurar) args.push("--debug-file", resolve(depurar));
  const huellaAntes = huella(corpus.dir);
  const inicio = new Date();
  const p = spawnSync("claude", args, {
    cwd: corpus.dir,
    input: pregunta.pregunta,
    encoding: "utf8",
    env: entornoLimpio(),
    timeout: CONFIG.timeout_ms,
    maxBuffer: 64 * 1024 * 1024,
    windowsHide: true,
  });
  let r = null;
  try {
    r = JSON.parse(p.stdout);
  } catch {
    r = null;
  }

  const carpeta = join(EVAL, "corridas", tanda);
  mkdirSync(carpeta, { recursive: true });
  const base = `${pregunta.id}-${brazo}-r${rep}-${sessionId.slice(0, 8)}`;
  writeFileSync(join(carpeta, `${base}.salida.json`), p.stdout || "");
  if (p.stderr) writeFileSync(join(carpeta, `${base}.stderr.txt`), p.stderr);

  const rutaT = rutaTranscripcion(sessionId);
  let t = null;
  if (rutaT) {
    copyFileSync(rutaT, join(carpeta, `${base}.transcripcion.jsonl`));
    t = resumirTranscripcion(readFileSync(rutaT, "utf8"));
  }

  const so = r?.structured_output ?? {};
  const inv = inventario(corpus.dir);
  const pts = puntuar(pregunta, so, { titulos: inv.titulos, archivos: inv.archivos });
  const tokens = tokensPorCategoria(r?.modelUsage);
  let descarte = forzarDescarte ?? motivoDescarte(r, t, modelo, corpus.dir) ?? (p.error ? String(p.error) : null);
  if (huella(corpus.dir) !== huellaAntes) {
    // La corrida escribió en el vault: se descarta y el corpus se rehace de git.
    descarte = forzarDescarte ?? "el brazo modificó el corpus";
    invalidarCorpus(corpus);
  }

  const fila = {
    esquema: 1,
    tanda,
    pregunta: pregunta.id,
    clase: pregunta.clase,
    brazo,
    rep,
    fecha: inicio.toISOString().replace(/\.\d{3}Z$/, "Z"),

    commit_vault: corpus.commit.slice(0, 7),
    hash_claude_md: corpus.hash_claude_md,
    hash_skill_memoria: corpus.hash_skill_memoria,
    modelo,
    effort: effort ?? null,
    version_cc: t?.version ?? null,
    version_mcp: brazo === "mcp" ? versionMcp : null,
    semilla_orden: semilla,

    session_id: sessionId,
    respuesta: so.respuesta ?? null,
    citas: so.citas ?? [],
    no_esta: so.no_esta ?? null,

    acierto: pts.acierto,
    distractor: pts.distractor,
    citas_precision: pts.citas_precision,
    citas_exhaustividad: pts.citas_exhaustividad,
    citas_inventadas: pts.citas_inventadas,
    acierto_citado: pts.acierto_citado,
    puntuador: pts.puntuador,
    juez_motivo: null,

    tokens,
    tokens_recuperacion: t?.tokens_recuperacion ?? null,
    tokens_pensamiento: r?.usage?.output_tokens_details?.thinking_tokens ?? 0,
    compactado: t?.compactado ?? false,
    costo: r?.modelUsage ? costoRecalculado(r.modelUsage, PESOS, ttlDe(r, t)) : null,
    costo_usd: r?.total_cost_usd ?? null,
    pesos_costo: PESOS.id,
    num_turns: r?.num_turns ?? null,
    llamadas: t?.llamadas ?? {},
    ms_total: r?.duration_ms ?? null,
    ms_api: r?.duration_api_ms ?? null,

    descartada: descarte !== null,
    motivo_descarte: descarte,
  };
  appendFileSync(salida, JSON.stringify(fila) + "\n");
  return { fila, motivoPuntaje: pts.motivo, ttl: t?.cacheEscrituraPorTtl, cwd: t?.cwd, stderr: p.stderr };
}

/**
 * El plan de una tanda (§ 7, regla 3): orden de preguntas barajado con una
 * semilla que se registra, brazos intercalados dentro de cada pregunta y una
 * corrida de calentamiento al principio, que se descarta.
 */
export function planificar({ preguntas, brazos, reps, semilla }) {
  const r = prng(semilla);
  const plan = [{ calentamiento: true, pregunta: preguntas[0], brazo: brazos[0], rep: 0 }];
  for (let rep = 1; rep <= reps; rep++) {
    const orden = [...preguntas];
    for (let i = orden.length - 1; i > 0; i--) {
      const j = Math.floor(r() * (i + 1));
      [orden[i], orden[j]] = [orden[j], orden[i]];
    }
    for (const q of orden) for (const b of brazos) plan.push({ pregunta: q, brazo: b, rep });
  }
  return plan;
}

/**
 * Estimación con las corridas ya hechas: por brazo y modelo, mediana de
 * `costo_usd` de cada sesión (también las descartadas: se pagaron igual)
 * multiplicada por las corridas del plan, más las repeticiones que la tasa de
 * descarte hace esperar (§ 7, regla 5). Los descartes por un defecto del arnés ya
 * corregido (`instrucciones de fuera del corpus`) no cuentan para la tasa.
 */
export function estimar(plan, filas, modelo) {
  const porBrazo = {};
  for (const f of ultimaPorSesion(filas)) {
    if (f.modelo !== modelo || f.costo_usd == null || f.motivo_descarte === "calentamiento") continue;
    const b = (porBrazo[f.brazo] ??= { costos: [], n: 0, descartes: 0 });
    b.costos.push(f.costo_usd);
    if (/instrucciones de fuera del corpus/.test(f.motivo_descarte ?? "")) continue;
    b.n++;
    if (f.descartada) b.descartes++;
  }
  let total = 0;
  const faltan = new Set();
  for (const c of plan) {
    const b = porBrazo[c.brazo];
    if (!b?.costos.length) {
      faltan.add(c.brazo);
      continue;
    }
    const tasa = b.n ? b.descartes / b.n : 0;
    total += mediana(b.costos) * (c.calentamiento ? 1 : 1 / Math.max(0.05, 1 - tasa));
  }
  return { total, faltan: [...faltan], porBrazo };
}

/**
 * Lo que ya se hizo de esta tanda, para REANUDAR sin volver a pagarlo.
 *
 * Una tanda son cientos de corridas y horas de reloj; en esta máquina un
 * proceso largo ya fue terminado por falta de memoria. Sin esto, relanzar la
 * tanda repetía todo lo hecho. Cuenta como hecha la corrida cuya ÚLTIMA fila
 * (append-only: manda la última) no está descartada; el calentamiento, con que
 * exista uno de esta tanda.
 */
export function yaHechas(filas, tanda) {
  const hechas = new Set();
  let calentamiento = false;
  for (const f of ultimaPorSesion(filas.filter((x) => x.tanda === tanda))) {
    if (f.motivo_descarte === "calentamiento") calentamiento = true;
    else if (!f.descartada) hechas.add(`${f.pregunta}|${f.brazo}|${f.rep}`);
  }
  return { hechas, calentamiento };
}

function principal() {
  const { values: v } = parseArgs({
    options: {
      pregunta: { type: "string" },
      brazo: { type: "string" },
      brazos: { type: "string", default: "ciego,base" },
      conjunto: { type: "string", default: "desarrollo" },
      tanda: { type: "string" },
      rep: { type: "string", default: "1" },
      reps: { type: "string" },
      modelo: { type: "string", default: CONFIG.modelo_principal },
      effort: { type: "string" },
      semilla: { type: "string" },
      salida: { type: "string", default: join(EVAL, "resultados.jsonl") },
      "mcp-config": { type: "string", default: join(EVAL, "mcp.json") },
      "version-mcp": { type: "string" },
      plan: { type: "boolean", default: false },
      ejecutar: { type: "boolean", default: false },
      "confirmo-costo": { type: "boolean", default: false },
      "abrir-reserva": { type: "boolean", default: false },
      depurar: { type: "string" },
      reintentos: { type: "string", default: "2" },
    },
  });
  if (!v.tanda) throw new Error("Falta --tanda (p. ej. 2026-10-05-piloto).");
  const preguntas = cargarPreguntas(join(EVAL, "preguntas.jsonl"), { abrirReserva: v["abrir-reserva"] });
  const comun = {
    tanda: v.tanda,
    modelo: v.modelo,
    effort: v.effort,
    salida: resolve(v.salida),
    mcpConfig: resolve(v["mcp-config"]),
    versionMcp: v["version-mcp"] ?? null,
  };

  if (!v.plan) {
    const q = preguntas.find((p) => p.id === v.pregunta);
    if (!q) throw new Error(`No existe la pregunta ${v.pregunta}.`);
    if (q.sellada) throw new Error(`${q.id} es de reserva y está sellada. Se abre solo en la tanda de decisión (--abrir-reserva).`);
    if (!v.brazo) throw new Error("Falta --brazo (ciego | base | mcp).");
    const res = correrUna({ ...comun, pregunta: q, brazo: v.brazo, rep: Number(v.rep), semilla: v.semilla ? Number(v.semilla) : null, depurar: v.depurar });
    console.log(JSON.stringify(res.fila, null, 2));
    if (res.motivoPuntaje) console.log(`\npuntuación: ${res.motivoPuntaje}`);
    console.log(`ttl de la caché: ${JSON.stringify(res.ttl)} · cwd: ${res.cwd}`);
    return;
  }

  const semilla = v.semilla ? Number(v.semilla) : Math.floor(Math.random() * 1e6);
  const conjunto = preguntas.filter((p) => p.conjunto === v.conjunto && !p.quemada);
  if (conjunto.some((p) => p.sellada)) throw new Error("El conjunto tiene preguntas selladas: hace falta --abrir-reserva.");
  const brazos = v.brazos.split(",");
  const plan = planificar({ preguntas: conjunto, brazos, reps: Number(v.reps ?? CONFIG.repeticiones), semilla });
  const est = estimar(plan, existsSync(comun.salida) ? leerJsonl(comun.salida) : [], v.modelo);
  console.log(`Tanda ${v.tanda}: ${plan.length} corridas (${conjunto.length} preguntas × ${brazos.length} brazos × ${v.reps ?? CONFIG.repeticiones} + 1 de calentamiento), semilla ${semilla}.`);
  for (const [b, x] of Object.entries(est.porBrazo))
    console.log(`  ${b}: ${x.costos.length} sesiones previas, mediana US$ ${mediana(x.costos).toFixed(4)}, descartadas ${x.descartes}/${x.n}`);
  console.log(`Costo estimado (con las repeticiones por descarte): US$ ${est.total.toFixed(2)}${est.faltan.length ? ` — sin datos para: ${est.faltan.join(", ")}` : ""}.`);
  if (!v.ejecutar) return;
  if (!v["confirmo-costo"]) throw new Error("Una tanda consume cuota del usuario: agregar --confirmo-costo para ejecutarla.");
  // § 7, regla 5: una corrida descartada se anota y se REPITE. Con un tope, para
  // que una pregunta que siempre rompe la salida no se coma la tanda.
  const reintentos = Number(v.reintentos);
  const previas = yaHechas(existsSync(comun.salida) ? leerJsonl(comun.salida) : [], v.tanda);
  if (previas.hechas.size || previas.calentamiento)
    console.log(`Reanudando la tanda ${v.tanda}: ${previas.hechas.size} corridas válidas ya hechas se saltean${previas.calentamiento ? ", y el calentamiento" : ""}.`);
  for (const [i, c] of plan.entries()) {
    if (c.calentamiento ? previas.calentamiento : previas.hechas.has(`${c.pregunta.id}|${c.brazo}|${c.rep}`)) continue;
    for (let intento = 0; intento <= (c.calentamiento ? 0 : reintentos); intento++) {
      const res = correrUna({
        ...comun,
        pregunta: c.pregunta,
        brazo: c.brazo,
        rep: c.rep,
        semilla,
        forzarDescarte: c.calentamiento ? "calentamiento" : null,
      });
      const f = res.fila;
      console.log(`[${i + 1}/${plan.length}] ${c.pregunta.id} ${c.brazo} r${c.rep}${intento ? ` (reintento ${intento})` : ""}: acierto_citado=${f.acierto_citado} costo=${f.costo_usd}${f.descartada ? ` (descartada: ${f.motivo_descarte})` : ""}`);
      if (!f.descartada || c.calentamiento) break;
    }
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
