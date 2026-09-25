// El patrón humano del juez (§ 7, «Cómo se valida al juez, y cuándo no se lo
// puede usar»).
//
//   node eval/patron.mjs generar --tanda 2026-09-24-base    # elige las respuestas y escribe la planilla
//   (el usuario abre eval/patron-juez.md en Mycelium y marca una casilla por respuesta)
//   node eval/patron.mjs validar                             # lee la planilla y mide el desacuerdo
//   node eval/patron.mjs validar --juzgar --confirmo-costo   # y le pide al juez lo que falte
//
// Archivos:
//  - `eval/patron-juez.jsonl`: una línea por respuesta del patrón (id, sesión,
//    estrato y, una vez puntuada, el veredicto humano). Es el registro.
//  - `eval/patron-juez.md`: la planilla que completa el usuario. `validar` copia
//    sus marcas al `.jsonl`.
//
// El patrón se elige SIN mirar al juez —ni sus veredictos ni si ya corrió—, y la
// planilla no muestra el brazo, el veredicto del juez ni el puntaje mecánico.

import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { llamarJuez, registroJuicio } from "./juzgar.mjs";
import { VERSION_JUEZ, acuerdo, idOpaco, KAPPA_MINIMO } from "./lib/juez.mjs";
import { leerPlanilla, paresPatron, planillaMarkdown, seleccionarPatron } from "./lib/patron.mjs";
import { cargarPreguntas, indicePorId, leerJsonl, ultimaPorSesion } from "./lib/preguntas.mjs";

import { OPCION_VAULT, vaultDeArgs } from "./lib/vault.mjs";

const VAULT = vaultDeArgs();
const CONFIG = VAULT.config;
const RUTA_PATRON = VAULT.patron;
const RUTA_PLANILLA = VAULT.planilla;

const pct = (x) => (Number.isFinite(x) ? `${(x * 100).toFixed(1)} %` : "—");

export function primeraPorSesion(filas) {
  const m = new Map();
  for (const f of filas) if (!m.has(f.session_id)) m.set(f.session_id, f);
  return m;
}

function generar(v, claves) {
  if (!v.tanda) throw new Error("Falta --tanda.");
  if (existsSync(RUTA_PATRON) && leerJsonl(RUTA_PATRON).some((p) => p.humano)) throw new Error(`${RUTA_PATRON} ya tiene puntajes humanos: no se pisa. Moverlo a mano si de verdad hay que rehacerlo.`);
  const filas = ultimaPorSesion(leerJsonl(v.resultados)).filter((f) => f.tanda === v.tanda);
  const items = seleccionarPatron(filas, claves, { semilla: Number(v.semilla) });
  const porSesion = new Map(filas.map((f) => [f.session_id, f]));
  writeFileSync(RUTA_PATRON, items.map((i) => JSON.stringify(i)).join("\n") + "\n");
  writeFileSync(RUTA_PLANILLA, planillaMarkdown(items, claves, porSesion));
  const por = items.reduce((a, i) => ((a[i.estrato] = (a[i.estrato] ?? 0) + 1), a), {});
  console.log(`Patrón: ${items.length} respuestas de ${new Set(items.map((i) => i.pregunta)).size} preguntas (${Object.entries(por).map(([k, n]) => `${k} ${n}`).join(", ")}).`);
  console.log(`Planilla: ${RUTA_PLANILLA}`);
}

function lineaAcuerdo(nombre, ac) {
  return (
    `- ${nombre}: ${ac.n} casos decididos por los dos · desacuerdo ${pct(ac.tasa)} (${ac.desacuerdos}; IC 95 % ${pct(ac.ic[0])}–${pct(ac.ic[1])}) · κ = ${Number.isFinite(ac.kappa) ? ac.kappa.toFixed(2) : "—"}` +
    ` · el juez más generoso ${ac.juezGeneroso}, más severo ${ac.juezSevero} · dudas: humano ${ac.dudasHumano}, juez ${ac.dudasJuez}`
  );
}

function validar(v, claves) {
  if (!existsSync(RUTA_PATRON) || !existsSync(RUTA_PLANILLA)) throw new Error("No hay patrón: correr primero `node eval/patron.mjs generar --tanda …`.");
  const patron = leerJsonl(RUTA_PATRON);
  const { veredictos, problemas } = leerPlanilla(readFileSync(RUTA_PLANILLA, "utf8"));
  for (const p of problemas) console.log(`PROBLEMA en la planilla: ${p}`);
  for (const it of patron) {
    const h = veredictos.get(it.id);
    it.humano = h?.humano ?? null;
    it.humano_comentario = h?.comentario ?? null;
  }
  writeFileSync(RUTA_PATRON, patron.map((i) => JSON.stringify(i)).join("\n") + "\n");
  const puntuadas = patron.filter((i) => i.humano).length;
  console.log(`Planilla: ${puntuadas} de ${patron.length} respuestas puntuadas a mano.`);

  const todas = leerJsonl(v.resultados);
  const primeras = primeraPorSesion(todas);
  const ultimas = new Map(ultimaPorSesion(todas).map((f) => [f.session_id, f]));
  const juicios = existsSync(v.juicios) ? leerJsonl(v.juicios) : [];
  let pares = paresPatron(patron, juicios, primeras, { modelo: v.modelo, version: VERSION_JUEZ });
  const faltan = pares.filter((p) => p.juez == null);
  if (faltan.length && v.juzgar) {
    if (!v["confirmo-costo"]) throw new Error(`El juez tiene que ver ${faltan.length} respuestas del patrón: agregar --confirmo-costo.`);
    for (const p of faltan) {
      const f = ultimas.get(patron.find((i) => i.id === p.id).session_id);
      const r = llamarJuez({ clave: claves[f.pregunta], salida: { respuesta: f.respuesta, no_esta: f.no_esta }, id: idOpaco(f.session_id), modelo: v.modelo });
      appendFileSync(v.juicios, JSON.stringify(registroJuicio(f, v.modelo, r)) + "\n");
      console.log(`juez ${p.id}: ${r.descarte ? `DESCARTADO (${r.descarte})` : r.veredicto} · US$ ${(r.costo_usd ?? 0).toFixed(4)}`);
    }
    pares = paresPatron(patron, leerJsonl(v.juicios), primeras, { modelo: v.modelo, version: VERSION_JUEZ });
  } else if (faltan.length) {
    console.log(`${faltan.length} respuestas del patrón no tienen veredicto de ${v.modelo} (prompt v${VERSION_JUEZ}): agregar --juzgar --confirmo-costo.`);
  }

  const noCiegas = pares.filter((p) => p.brazo !== "ciego");
  const ac = acuerdo(noCiegas);
  console.log("", `## Juez ${v.modelo} (prompt v${VERSION_JUEZ}) contra el humano`, "");
  console.log(lineaAcuerdo("sin el brazo ciego (lo que decide)", ac));
  console.log(lineaAcuerdo("todo el patrón", acuerdo(pares)));
  for (const e of ["juez", "dudoso", "control", "facil"]) {
    const sub = pares.filter((p) => p.estrato === e);
    if (sub.length) console.log(lineaAcuerdo(`estrato ${e}`, acuerdo(sub)));
  }
  console.log(lineaAcuerdo("la regla MECÁNICA contra el humano, sin el ciego (referencia)", acuerdo(noCiegas.map((p) => ({ ...p, juez: p.mecanico })))));
  if (ac.n) {
    console.log(
      "",
      ac.kappa >= KAPPA_MINIMO
        ? `El juez puede decidir comparaciones cuya diferencia sea de al menos ${(ac.tasa * 100).toFixed(1)} pts (§ 7). El informe lo aplica a cada una.`
        : `κ = ${ac.kappa.toFixed(2)} < ${KAPPA_MINIMO}: el juez NO se puede usar sin supervisión (§ 7). Mirar los desacuerdos: casi siempre es una clave floja.`,
    );
    const des = pares.filter((p) => p.humano && p.juez && p.humano !== "duda" && p.juez !== "duda" && p.humano !== p.juez);
    if (des.length) console.log(`Desacuerdos: ${des.map((p) => `${p.id} (${p.pregunta}: humano ${p.humano}, juez ${p.juez})`).join(", ")}`);
  }
}

function principal() {
  const [accion] = process.argv.slice(2);
  const { values: v } = parseArgs({
    args: process.argv.slice(3),
    options: {
      ...OPCION_VAULT,
      resultados: { type: "string", default: VAULT.resultados },
      juicios: { type: "string", default: VAULT.juicios },
      tanda: { type: "string" },
      semilla: { type: "string", default: "20260924" },
      modelo: { type: "string", default: CONFIG.modelo_juez },
      juzgar: { type: "boolean", default: false },
      "confirmo-costo": { type: "boolean", default: false },
    },
  });
  const claves = indicePorId(cargarPreguntas(VAULT.preguntas));
  if (accion === "generar") generar(v, claves);
  else if (accion === "validar") validar(v, claves);
  else throw new Error("Uso: node eval/patron.mjs generar --tanda X | validar [--juzgar --confirmo-costo]");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    principal();
  } catch (e) {
    console.error(`FALLO: ${e.message}`);
    process.exit(1);
  }
}
