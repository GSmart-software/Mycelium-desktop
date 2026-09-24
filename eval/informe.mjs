// Informe de una o más tandas: la línea de base y la regla de la § 9 aplicada
// tal como está escrita —filtros de validez primero, después la tabla en orden—,
// diciendo qué fila decide o por qué no decide ninguna.
//
//   node eval/informe.mjs --tanda 2026-10-05-base
//   node eval/informe.mjs --tanda 2026-10-05-base,2026-10-12-fase1 --semilla 7

import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { CORRELACION_FUERTE, KAPPA_MINIMO, VERSION_JUEZ, acuerdo, correlacionLargo, juezPuedeDecidir } from "./lib/juez.mjs";
import { paresPatron } from "./lib/patron.mjs";
import { cargarPreguntas, indicePorId, leerJsonl, ultimaPorSesion } from "./lib/preguntas.mjs";
import { agrupar, aplicarRegla, contaminadas, media, mediana, UMBRALES } from "./lib/regla.mjs";

const EVAL = dirname(fileURLToPath(import.meta.url));
const CONFIG = JSON.parse(readFileSync(join(EVAL, "config.json"), "utf8"));

const pct = (x) => (Number.isFinite(x) ? `${(x * 100).toFixed(1)} %` : "—");
const num = (x, d = 2) => (Number.isFinite(x) ? x.toFixed(d) : "—");

/** Lo que tiene que ser constante en una comparación (§ 8, sesgos 3 y 6; § 10, regla 4). */
function mezclas(filas) {
  const out = [];
  for (const campo of ["modelo", "version_cc", "commit_vault", "hash_claude_md", "hash_skill_memoria", "pesos_costo", "effort"]) {
    const vals = [...new Set(filas.map((f) => f[campo]))];
    if (vals.length > 1) out.push(`${campo}: ${vals.join(" · ")}`);
  }
  return out;
}

export function lineaDeBase(filas, claves) {
  const g = agrupar(filas);
  const lineas = [];
  for (const [brazo, porQ] of Object.entries(g)) {
    const qs = Object.keys(porQ);
    const todas = qs.flatMap((q) => porQ[q]);
    const pq = qs.map((q) => media(porQ[q].map((f) => f.acierto_citado)));
    const clases = {};
    for (const q of qs) (clases[claves[q]?.clase ?? "?"] ??= []).push(media(porQ[q].map((f) => f.acierto_citado)));
    lineas.push(
      `- **${brazo}** · ${qs.length} preguntas, ${todas.length} corridas válidas · acierto ${pct(media(todas.map((f) => f.acierto)))} · ` +
        `acierto citado ${pct(media(pq))} (media por pregunta) · costo mediano US$ ${num(mediana(todas.map((f) => f.costo)), 4)} ` +
        `(factura: ${num(mediana(todas.map((f) => f.costo_usd)), 4)}) · contexto metido (mediana) ${num(mediana(todas.map((f) => f.tokens_recuperacion)), 0)} tokens · ` +
        `compactó ${pct(media(todas.map((f) => (f.compactado ? 1 : 0))))} · citas inventadas ${todas.reduce((a, f) => a + (f.citas_inventadas ?? 0), 0)} · ` +
        `por juzgar ${todas.filter((f) => f.puntuador === "requiere-juez").length}`,
    );
    lineas.push(`  - por clase: ${Object.keys(clases).sort().map((c) => `${c} ${pct(media(clases[c]))}`).join(" · ")}`);
  }
  return lineas;
}

/** Por sesión, la última fila puntuada por la regla de cadenas (antes del juez o del humano). */
export function ultimaMecanicaPorSesion(filas) {
  const m = new Map();
  for (const f of filas) if (f.puntuador === "mecanico" || f.puntuador === "requiere-juez") m.set(f.session_id, f);
  return m;
}

function aciertoCitadoPorBrazo(filas) {
  const g = agrupar(filas);
  return Object.fromEntries(Object.entries(g).map(([b, porQ]) => [b, media(Object.values(porQ).map((fs) => media(fs.map((f) => f.acierto_citado))))]));
}

/**
 * § 7 y § 8 (sesgo 5): qué puntuó el juez, cuánto movió el acierto citado, su
 * desacuerdo con el patrón humano, si puede decidir la comparación de este
 * informe y si sus veredictos siguen al largo de la respuesta.
 *
 * `comparacion`: `{nombre, diferenciaPts, brazos}` — la diferencia que el
 * informe está midiendo y los brazos que entran en ella.
 */
export function seccionJuez({ validas, crudas, patron, juicios, modeloJuez, comparacion }) {
  const out = ["", "## El juez (§ 7)", ""];
  const cuenta = (p) => validas.filter((f) => f.puntuador === p).length;
  const juzgadas = cuenta("juez");
  const dudas = new Set(juicios.filter((j) => !j.descartado && j.veredicto === "duda" && j.modelo_juez === modeloJuez && j.version_juez === VERSION_JUEZ).map((j) => j.session_id));
  const pendientes = validas.filter((f) => f.puntuador === "requiere-juez");
  out.push(
    `Juez: \`${modeloJuez}\`, prompt v${VERSION_JUEZ}. Filas puntuadas por el juez: ${juzgadas} · por el humano: ${cuenta("humano")} · ` +
      `pendientes: ${pendientes.length} (${pendientes.filter((f) => dudas.has(f.session_id)).length} en duda, esperando al humano; su puntaje sigue siendo el mecánico, provisional).`,
  );

  // Cuánto movió el juez: la misma tanda puntuada solo con la regla de cadenas.
  const mec = ultimaMecanicaPorSesion(crudas);
  const soloMecanico = validas.map((f) => mec.get(f.session_id) ?? f);
  const conJuez = aciertoCitadoPorBrazo(validas);
  const sinJuez = aciertoCitadoPorBrazo(soloMecanico);
  for (const b of Object.keys(conJuez)) {
    const mov = (conJuez[b] - sinJuez[b]) * 100;
    out.push(`- **${b}**: acierto citado ${pct(conJuez[b])} con el juez · ${pct(sinJuez[b])} solo mecánico → ${mov >= 0 ? "+" : ""}${num(mov, 1)} pts`);
  }
  const cambios = {};
  for (const f of validas) {
    const m = mec.get(f.session_id);
    if (f.puntuador !== "juez" || !m || m.acierto === f.acierto) continue;
    const k = `${f.pregunta} ${f.brazo} ${m.acierto}→${f.acierto}`;
    cambios[k] = (cambios[k] ?? 0) + 1;
  }
  const nCambios = Object.values(cambios).reduce((a, b) => a + b, 0);
  if (nCambios) out.push(`- El juez cambió el acierto de ${nCambios} filas: ${Object.entries(cambios).sort().map(([k, n]) => `${k} ×${n}`).join(" · ")}`);

  // Validación contra el patrón humano.
  out.push("", "### Contra el patrón humano", "");
  const primeras = new Map();
  for (const f of crudas) if (!primeras.has(f.session_id)) primeras.set(f.session_id, f);
  const pares = paresPatron(patron, juicios, primeras, { modelo: modeloJuez, version: VERSION_JUEZ }).filter((p) => p.brazo !== "ciego");
  const ac = acuerdo(pares);
  const puntuadas = patron.filter((p) => p.humano).length;
  if (!patron.length) out.push("No hay patrón (`node eval/patron.mjs generar`).");
  else if (!ac.n)
    out.push(
      `Patrón: ${patron.length} respuestas, ${puntuadas} puntuadas a mano, ${pares.filter((p) => p.juez).length} con veredicto de este juez. ` +
        "**Sin casos puntuados por los dos, el desacuerdo no se conoce.**",
    );
  else
    out.push(
      `Patrón (sin el brazo ciego): ${ac.n} casos puntuados por el humano y por el juez · **desacuerdo ${pct(ac.tasa)}** (${ac.desacuerdos}; IC 95 % ${pct(ac.ic[0])}–${pct(ac.ic[1])}) · ` +
        `κ = ${num(ac.kappa)} (mínimo ${KAPPA_MINIMO}) · juez más generoso que el humano ${ac.juezGeneroso}, más severo ${ac.juezSevero} · dudas: humano ${ac.dudasHumano}, juez ${ac.dudasJuez}.`,
    );
  const brazosPatron = new Set(pares.filter((p) => p.humano && p.juez).map((p) => p.brazo));
  const sinPatron = (comparacion.brazos ?? []).filter((b) => b !== "ciego" && !brazosPatron.has(b));
  const usaJuez = validas.some((f) => (comparacion.brazos ?? []).includes(f.brazo) && ["juez", "requiere-juez"].includes(f.puntuador));
  const d = juezPuedeDecidir(ac, comparacion.diferenciaPts);
  out.push(
    "",
    `**¿Puede el juez decidir ${comparacion.nombre}?** ` +
      (!usaJuez
        ? "No hace falta: ninguna fila de esos brazos pasa por el juez."
        : `${d.puede ? "**Sí**" : "**No**"} — ${d.motivo}.` +
          (d.advertencia ? ` Advertencia: ${d.advertencia}.` : "") +
          (!d.puede ? " Hasta que pueda: puntuar a mano las filas del juez o afinar la clave y revalidar (§ 7)." : "")),
  );
  if (usaJuez && ac.n && sinPatron.length) out.push(`> [!warning] El patrón no tiene respuestas del brazo ${sinPatron.join(", ")}: el desacuerdo se midió sobre otros brazos. La § 7 pide revalidar en cada tanda.`);
  const sesiones = new Set(validas.map((f) => f.session_id));
  const jueces = new Set(juicios.filter((j) => !j.descartado && sesiones.has(j.session_id)).map((j) => `${j.modelo_juez} v${j.version_juez}`));
  if (jueces.size > 1)
    out.push("> [!warning] Las filas de estas tandas las juzgaron jueces distintos (modelo o versión del prompt): el desacuerdo medido vale para uno solo.");

  // § 8, sesgo 5.
  const c = correlacionLargo(validas);
  out.push(
    "",
    "### ¿El juez puntúa el largo? (§ 8, sesgo 5)",
    "",
    c.n < 3
      ? "Muy pocas filas del juez para medirlo."
      : `Correlación veredicto–largo sobre ${c.n} filas del juez: dentro de cada pregunta y brazo **r = ${num(c.intra)}**; cruda ${num(c.global)} (confundida por la pregunta y el brazo: una respuesta que no contesta suele ser corta).` +
          (c.fuerte ? `**|r| ≥ ${CORRELACION_FUERTE}: el juez parece puntuar el estilo.** Revisar antes de creerle.` : `Por debajo de ${CORRELACION_FUERTE}: no hay señal de que puntúe el largo.`),
  );
  return out;
}

function principal() {
  const { values: v } = parseArgs({
    options: {
      resultados: { type: "string", default: join(EVAL, "resultados.jsonl") },
      tanda: { type: "string" },
      semilla: { type: "string", default: "20260924" },
      replicas: { type: "string", default: "10000" },
      "abrir-reserva": { type: "boolean", default: false },
      base: { type: "string", default: "base" },
      tratamiento: { type: "string", default: "mcp" },
      juicios: { type: "string", default: join(EVAL, "juicios.jsonl") },
      patron: { type: "string", default: join(EVAL, "patron-juez.jsonl") },
      "modelo-juez": { type: "string", default: CONFIG.modelo_juez },
    },
  });
  if (!existsSync(v.resultados)) throw new Error(`No existe ${v.resultados}`);
  const tandas = v.tanda ? new Set(v.tanda.split(",")) : null;
  const todas = ultimaPorSesion(leerJsonl(v.resultados)).filter((f) => !tandas || tandas.has(f.tanda));
  const juez = {
    crudas: leerJsonl(v.resultados),
    juicios: existsSync(v.juicios) ? leerJsonl(v.juicios) : [],
    patron: existsSync(v.patron) ? leerJsonl(v.patron) : [],
    modeloJuez: v["modelo-juez"],
  };
  const claves = indicePorId(cargarPreguntas(join(EVAL, "preguntas.jsonl"), { abrirReserva: v["abrir-reserva"] }));
  const validas = todas.filter((f) => !f.descartada);
  const out = [];

  out.push(`# Informe — ${v.tanda ?? "todas las tandas"}`, "");
  out.push(`${todas.length} corridas, ${todas.length - validas.length} descartadas (se conservan, no cuentan).`);
  for (const [m, n] of Object.entries(
    todas.filter((f) => f.descartada).reduce((a, f) => ((a[f.motivo_descarte] = (a[f.motivo_descarte] ?? 0) + 1), a), {}),
  ))
    out.push(`- descartadas por «${m}»: ${n}`);
  const mz = mezclas(validas);
  if (mz.length) out.push("", "> [!warning] Filas que no son comparables entre sí", ...mz.map((m) => `> - ${m}`));

  out.push("", "## Línea de base", "", ...lineaDeBase(validas, claves));
  const cont = contaminadas(agrupar(validas), claves);
  out.push("", `**Contaminadas** (el ciego acierta en ≥ ${UMBRALES.contaminacion}; las C5 no cuentan): ${cont.length ? cont.map((c) => `${c.pregunta} (${c.aciertos}/${c.corridas})`).join(", ") : "ninguna"}.`);

  const g = agrupar(validas);
  if (!g[v.tratamiento]) {
    const qs = Object.keys(g[v.base] ?? {}).filter((q) => !cont.some((c) => c.pregunta === q));
    const piso = media(qs.map((q) => media(g[v.base][q].map((f) => f.acierto_citado))));
    out.push(
      "",
      "## Regla de decisión (§ 9)",
      "",
      `No hay brazo \`${v.tratamiento}\` en estas tandas: la § 9.3 no se aplica. Lo único que la fase 0 decide es el **piso del modelo** (§ 9.2, primer filtro):`,
      `el brazo base llega a ${pct(piso)} de acierto citado sobre ${qs.length} preguntas no contaminadas → ${piso >= UMBRALES.pisoBase ? "**pasa**: el modelo chico alcanza" : "**no pasa**: subir al modelo siguiente y anotarlo"}.`,
    );
    out.push(
      ...seccionJuez({
        validas,
        ...juez,
        comparacion: { nombre: `el piso del modelo (${pct(piso)} contra el 50 %)`, diferenciaPts: (piso - UMBRALES.pisoBase) * 100, brazos: [v.base] },
      }),
    );
  } else {
    const r = aplicarRegla(validas, claves, {
      brazoBase: v.base,
      brazoTratamiento: v.tratamiento,
      bootstrap: { semilla: Number(v.semilla), replicas: Number(v.replicas) },
    });
    const f = r.filtros;
    out.push("", "## Regla de decisión (§ 9)", "", "### 9.2 Filtros de validez", "");
    out.push(`- Piso del brazo base: ${pct(f.piso.valor)} (umbral 50 %) → ${f.piso.pasa ? "pasa" : "**falla**"}`);
    out.push(`- Adopción del MCP: ${pct(f.adopcion.valor)} (umbral 50 %) → ${f.adopcion.pasa ? "pasa" : "**falla**"}`);
    for (const [b, c] of Object.entries(f.compactacion)) out.push(`- Compactación de ${b}: ${pct(c.valor)} (< 20 %) → ${c.pasa ? "pasa" : "**falla**: su costo queda fuera"}`);
    out.push("", "### 9.1 Magnitudes", "");
    out.push(`- Δ = ${num(r.delta, 1)} pts · IC 95 % [${r.icDelta ? r.icDelta.map((x) => num(x, 1)).join(", ") : "—"}] sobre ${r.preguntas.length} preguntas`);
    out.push(`- K = ${num(r.k)} · IC 95 % [${r.icK ? r.icK.map((x) => num(x)).join(", ") : "—"}]`);
    out.push(`- Δ por clase: ${Object.entries(r.porClase).sort().map(([c, d]) => `${c} ${num(d, 1)}`).join(" · ")}`);
    if (r.bloqueanteC7) out.push(`- Bloqueante C7: Δ(C7) ${num(r.bloqueanteC7.delta, 1)} pts, cayó a grep en ${pct(r.bloqueanteC7.tasaCaidaAGrep)} → **${r.bloqueanteC7.estado}**`);
    for (const [b, qs] of Object.entries(r.inestables)) if (qs.length) out.push(`- Inestables en ${b}: ${qs.join(", ")}`);
    out.push("", "### 9.3 Decisión", "", `**${r.fila ? `Fila ${r.fila}` : "Ninguna fila"}** — ${r.decision}`);
    if (r.defectos.length) out.push("", "> [!warning] La regla no se pudo aplicar mecánicamente en esto", ...r.defectos.map((d) => `> - ${d}`));
    out.push(...seccionJuez({ validas, ...juez, comparacion: { nombre: `el Δ de ${num(r.delta, 1)} pts (§ 9.3)`, diferenciaPts: r.delta, brazos: [v.base, v.tratamiento] } }));
  }
  console.log(out.join("\n"));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    principal();
  } catch (e) {
    console.error(`FALLO: ${e.message}`);
    process.exit(1);
  }
}
