// Tests del tiempo como métrica: `R` con la construcción de `K`, el tiempo en
// herramientas sacado de la transcripción, la lectura de PDFs (repliegue de C9)
// y la latencia interna del MCP desde su registro de búsquedas.
//
//   node --test eval/test/
import assert from "node:assert/strict";
import { test } from "node:test";
import { emparejar, llamadasMcp } from "../lib/bitacora.mjs";
import { aplicarRegla } from "../lib/regla.mjs";
import { latenciaMcp, razonTiempo, tiemposPorBrazo } from "../lib/tiempo.mjs";
import { leyoPdf, tiemposDeHerramientas } from "../lib/transcripcion.mjs";

const IDS = ["Q1", "Q2", "Q3", "Q4", "Q5", "Q6"];
const claves = Object.fromEntries(IDS.map((q) => [q, { clase: "C1", veredicto: "dato" }]));
const fila = (brazo, q, rep, ms, costo = 0.1) => ({
  session_id: `${brazo}-${q}-${rep}`,
  pregunta: q,
  brazo,
  rep,
  acierto: 1,
  acierto_citado: rep <= 3 ? 1 : 0,
  costo,
  ms_total: ms,
  num_turns: brazo === "mcp" ? 5 : 8,
  llamadas: brazo === "mcp" ? { mcp__mycelium__vault_buscar: 1 } : { Grep: 1 },
  descartada: false,
});

test("R: mediana por pregunta de sus repeticiones, y mediana de las razones", () => {
  const filas = [];
  for (const [i, q] of IDS.entries())
    for (let rep = 1; rep <= 5; rep++) {
      filas.push(fila("base", q, rep, 20000 + rep * 100));
      // Una repetición atípica no mueve la mediana de la pregunta.
      filas.push(fila("mcp", q, rep, rep === 5 ? 90000 : 10000 + i * 1000 + rep * 50));
    }
  const r = razonTiempo(filas, claves, { bootstrap: { replicas: 2000, semilla: 5 } });
  assert.equal(r.porPregunta.length, 6);
  // Q1: mediana mcp 10150 / mediana base 20300.
  assert.equal(Number(r.porPregunta[0].razon.toFixed(4)), Number((10150 / 20300).toFixed(4)));
  assert.equal(r.masRapido, 6);
  assert.ok(r.icR[0] <= r.r && r.r <= r.icR[1]);
});

test("R usa las mismas réplicas del bootstrap que K: con razones iguales, el mismo IC", () => {
  // Costo y tiempo con exactamente la misma razón por pregunta → IC de K = IC de R.
  const filas = [];
  for (const [i, q] of IDS.entries())
    for (let rep = 1; rep <= 5; rep++) {
      filas.push(fila("base", q, rep, 20000, 0.2));
      filas.push(fila("mcp", q, rep, 20000 * (0.4 + i * 0.1), 0.2 * (0.4 + i * 0.1)));
    }
  const bs = { bootstrap: { replicas: 3000, semilla: 20260924 } };
  const k = aplicarRegla(filas, claves, bs);
  const r = razonTiempo(filas, claves, bs);
  assert.equal(r.r, k.k);
  assert.deepEqual(r.icR, k.icK);
});

test("R deja fuera las preguntas contaminadas, como la regla", () => {
  const filas = [];
  for (const q of IDS)
    for (let rep = 1; rep <= 5; rep++) {
      filas.push(fila("base", q, rep, 20000));
      filas.push(fila("mcp", q, rep, 10000));
    }
  for (let rep = 1; rep <= 5; rep++) filas.push({ ...fila("ciego", "Q1", rep, 5000), acierto: 1 });
  assert.equal(razonTiempo(filas, claves).porPregunta.length, 5);
});

const e = (o) => JSON.stringify(o);
const usar = (ts, id, name, input = {}) => e({ type: "assistant", timestamp: ts, message: { id: `m-${id}`, content: [{ type: "tool_use", id, name, input }] } });
const resultado = (ts, id) => e({ type: "user", timestamp: ts, message: { content: [{ type: "tool_result", tool_use_id: id }] } });

test("tiempo en herramientas: de cada tool_use a su tool_result, sin contar dos veces lo paralelo", () => {
  const t = [
    usar("2026-09-24T10:00:00.000Z", "a", "Grep"),
    usar("2026-09-24T10:00:00.500Z", "b", "Read"), // en paralelo con a
    resultado("2026-09-24T10:00:02.000Z", "a"),
    resultado("2026-09-24T10:00:03.000Z", "b"),
    usar("2026-09-24T10:00:10.000Z", "c", "Bash"),
    resultado("2026-09-24T10:00:11.000Z", "c"),
    usar("2026-09-24T10:00:12.000Z", "s", "StructuredOutput"),
    resultado("2026-09-24T10:00:12.010Z", "s"),
    e({ type: "assistant", isSidechain: true, timestamp: "2026-09-24T10:00:04.000Z", message: { content: [{ type: "tool_use", id: "x", name: "Grep" }] } }),
    usar("2026-09-24T10:00:20.000Z", "z", "Read"), // sin resultado: la corrida se cortó
  ].join("\n");
  const r = tiemposDeHerramientas(t);
  assert.equal(r.ms_herramientas, 3000 + 1000); // [0, 3 s] unidos, más [10, 11]
  assert.deepEqual(r.por_herramienta, { Grep: 2000, Read: 2500, Bash: 1000 });
  assert.equal(r.llamadas, 3);
  assert.equal(r.sin_resultado, 1);
});

test("tiempos por brazo: total, herramientas y el resto, en medianas", () => {
  const filas = [fila("base", "Q1", 1, 30000), fila("base", "Q2", 1, 20000), fila("mcp", "Q1", 1, 10000)];
  const herr = new Map([
    ["base-Q1-1", { ms_herramientas: 4000 }],
    ["mcp-Q1-1", { ms_herramientas: 200 }],
  ]);
  const t = tiemposPorBrazo(filas, herr);
  assert.equal(t.base.ms_total, 25000);
  assert.equal(t.base.ms_herramientas, 4000);
  assert.equal(t.base.ms_resto, 26000);
  assert.equal(t.base.sin_transcripcion, 1);
  assert.equal(t.mcp.ms_resto, 9800);
  assert.equal(t.mcp.turnos, 5);
});

test("leer un PDF: Read de un .pdf o un comando que lo nombra; buscar con Grep no cuenta", () => {
  assert.equal(leyoPdf(usar("2026-09-24T10:00:00Z", "a", "Read", { file_path: "C:\\c\\Docs\\x y z.pdf" })), true);
  assert.equal(leyoPdf(usar("2026-09-24T10:00:00Z", "a", "Bash", { command: 'pdftotext "Docs/a.pdf" -' })), true);
  assert.equal(leyoPdf(usar("2026-09-24T10:00:00Z", "a", "Grep", { pattern: "qubit", glob: "*.pdf" })), false);
  assert.equal(leyoPdf(usar("2026-09-24T10:00:00Z", "a", "Read", { file_path: "Docs/nota.md" })), false);
});

test("latencia del MCP: el `ms` del registro de búsquedas, emparejado con las llamadas de la transcripción", () => {
  const t = [
    usar("2026-09-24T10:00:00.000Z", "a", "mcp__mycelium__vault_buscar", { consulta: "uno" }),
    usar("2026-09-24T10:00:05.000Z", "b", "mcp__mycelium__vault_buscar", { consulta: "dos" }),
    usar("2026-09-24T10:00:06.000Z", "c", "mcp__mycelium__vault_leer", { ref: "x" }),
    usar("2026-09-24T10:00:07.000Z", "d", "mcp__mycelium__vault_buscar", { consulta: "sin registro" }),
  ].join("\n");
  const base = Date.parse("2026-09-24T10:00:00.000Z");
  const registro = [
    { consulta: "uno", ts: base + 30, ms: 12 },
    { consulta: "dos", ts: base + 5020, ms: 40 },
    { consulta: "uno", ts: base + 999999, ms: 999 }, // otra sesión, lejos en el tiempo
  ];
  const llamadas = llamadasMcp(t).filter((c) => c.herramienta === "vault_buscar");
  const l = latenciaMcp(emparejar(llamadas, registro));
  assert.equal(l.llamadas_buscar, 3);
  assert.equal(l.emparejadas, 2);
  assert.equal(l.ms_mediana, 26);
  assert.equal(l.ms_max, 40);
});
