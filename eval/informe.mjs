// Informe de una o más tandas: la línea de base y la regla de la § 9 aplicada
// tal como está escrita —filtros de validez primero, después la tabla en orden—,
// diciendo qué fila decide o por qué no decide ninguna.
//
//   node eval/informe.mjs --tanda 2026-10-05-base
//   node eval/informe.mjs --tanda 2026-10-05-base,2026-10-12-fase1 --semilla 7

import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { cargarPreguntas, indicePorId, leerJsonl, ultimaPorSesion } from "./lib/preguntas.mjs";
import { agrupar, aplicarRegla, contaminadas, media, mediana, UMBRALES } from "./lib/regla.mjs";

const EVAL = dirname(fileURLToPath(import.meta.url));

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
    },
  });
  if (!existsSync(v.resultados)) throw new Error(`No existe ${v.resultados}`);
  const tandas = v.tanda ? new Set(v.tanda.split(",")) : null;
  const todas = ultimaPorSesion(leerJsonl(v.resultados)).filter((f) => !tandas || tandas.has(f.tanda));
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
