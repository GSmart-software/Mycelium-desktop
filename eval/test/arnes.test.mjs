// Tests de las piezas puras del arnés: formato de fila (§ 10), costo
// recalculado (§ 9.1), lectura de la transcripción (§ 6), plan de la tanda (§ 7)
// y el sello de la reserva (§ 2).
//
//   node --test eval/test/
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { costoRecalculado, tokensPorCategoria } from "../lib/costo.mjs";
import { validarFila, CAMPOS } from "../lib/formato.mjs";
import { resumirTranscripcion } from "../lib/transcripcion.mjs";
import { abrir, sellar } from "../lib/sello.mjs";
import { buscarSeccion } from "../lib/secciones.mjs";
import { planificar } from "../correr.mjs";

const EVAL = join(dirname(fileURLToPath(import.meta.url)), "..");
const PESOS = JSON.parse(readFileSync(join(EVAL, "pesos-costo.json"), "utf8"));

test("§ 10: el ejemplo de la nota cumple el validador (salvo el nombre del hash, que es «…»)", () => {
  const ejemplo = {
    esquema: 1, tanda: "2026-10-05-piloto", pregunta: "P-01", clase: "C1", brazo: "mcp", rep: 2, fecha: "2026-10-05T14:03:11Z",
    commit_vault: "bd18151", hash_claude_md: "…", hash_skill_memoria: "…", modelo: "claude-sonnet-5", effort: "medium", version_cc: "2.1.278",
    version_mcp: "0.1.0", semilla_orden: 7, session_id: "e2ff207e-…", respuesta: "…", citas: ["Terminal integrada - PTY y xterm"], no_esta: false,
    acierto: 1, distractor: 0, citas_precision: 1.0, citas_exhaustividad: 1.0, citas_inventadas: 0, acierto_citado: 1, puntuador: "mecanico", juez_motivo: null,
    tokens: { entrada: 38, cache_escritura: 9120, cache_lectura: 61400, salida: 612 }, tokens_recuperacion: 14820, tokens_pensamiento: 210, compactado: false,
    costo: 0.0398, costo_usd: 0.0412, pesos_costo: "2026-09-24", num_turns: 6, llamadas: { mcp__mycelium__vault_buscar: 1, Read: 0 }, ms_total: 18422, ms_api: 9110,
    descartada: false, motivo_descarte: null,
  };
  assert.deepEqual(validarFila(ejemplo), []);
  assert.deepEqual(Object.keys(ejemplo), CAMPOS.map(([k]) => k));
  assert.deepEqual(validarFila({ ...ejemplo, extra: 1 }), ["campo de más: extra"]);
  assert.ok(validarFila({ ...ejemplo, acierto: 0 }).some((p) => /acierto_citado = 1/.test(p)));
});

test("§ 10: todas las filas de eval/resultados.jsonl cumplen el formato", () => {
  const ruta = join(EVAL, "resultados.jsonl");
  if (!existsSync(ruta)) return;
  const filas = readFileSync(ruta, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  for (const f of filas) assert.deepEqual(validarFila(f), [], `${f.session_id}`);
});

test("§ 9.1: el costo recalculado reproduce la factura de una corrida real (caché de 1 h)", () => {
  // Primera corrida de prueba (brazo ciego, D01, 2026-09-24): total_cost_usd = 0,025466.
  const modelUsage = { "claude-haiku-4-5-20251001": { inputTokens: 10, outputTokens: 394, cacheReadInputTokens: 0, cacheCreationInputTokens: 11743 } };
  assert.equal(Number(costoRecalculado(modelUsage, PESOS, { "5m": 0, "1h": 11743 }).toFixed(6)), 0.025466);
  // Con la escritura a 5 min el mismo uso cuesta menos: el TTL importa.
  assert.ok(costoRecalculado(modelUsage, PESOS, { "5m": 11743, "1h": 0 }) < 0.025466);
  assert.deepEqual(tokensPorCategoria(modelUsage), { entrada: 10, cache_escritura: 11743, cache_lectura: 0, salida: 394 });
});

test("§ 9.1: un modelo fuera de la tabla deja el costo en null, no a medias", () => {
  assert.equal(costoRecalculado({ "claude-desconocido-9": { inputTokens: 1 } }, PESOS), null);
});

test("§ 9.4: los cocientes congelados son los mismos en los dos modelos", () => {
  for (const [m, p] of Object.entries(PESOS.modelos))
    for (const k of ["cache_escritura_5m", "cache_escritura_1h", "cache_lectura", "salida"])
      assert.equal(Number((p[k] / p.entrada).toFixed(4)), PESOS.cocientes[k], `${m} ${k}`);
});

test("§ 6: la transcripción se deduplica por id de mensaje y cuenta herramientas y contexto", () => {
  const u = (i, cc, cr) => ({ input_tokens: i, cache_creation_input_tokens: cc, cache_read_input_tokens: cr, output_tokens: 5, cache_creation: { ephemeral_1h_input_tokens: cc, ephemeral_5m_input_tokens: 0 } });
  const lineas = [
    { type: "attachment", attachment: { type: "instructions", files: [{ path: "C:\\corpus\\CLAUDE.md" }] }, version: "2.1.281", cwd: "C:\\corpus" },
    { type: "assistant", message: { id: "m1", model: "claude-haiku-4-5-20251001", usage: u(3, 1000, 0), content: [{ type: "tool_use", id: "t1", name: "Grep" }] } },
    { type: "assistant", message: { id: "m1", model: "claude-haiku-4-5-20251001", usage: u(3, 1000, 0), content: [{ type: "tool_use", id: "t2", name: "Read" }] } },
    { type: "assistant", isSidechain: true, message: { id: "s1", usage: u(1, 1, 1), content: [{ type: "tool_use", id: "t9", name: "Bash" }] } },
    { type: "assistant", message: { id: "m2", model: "claude-haiku-4-5-20251001", usage: u(2, 500, 1000), content: [{ type: "tool_use", id: "t3", name: "StructuredOutput" }] } },
    { type: "system", subtype: "compact_boundary" },
  ];
  const t = resumirTranscripcion(lineas.map((l) => JSON.stringify(l)).join("\n"));
  assert.equal(t.mensajes, 2);
  assert.deepEqual(t.llamadas, { Grep: 1, Read: 1 });
  assert.equal(t.tokens_recuperacion, 2 + 500 + 1000 - (3 + 1000));
  assert.equal(t.compactado, true);
  assert.deepEqual(t.instrucciones, ["C:\\corpus\\CLAUDE.md"]);
  assert.deepEqual(t.cacheEscrituraPorTtl, { "5m": 0, "1h": 1500 });
});

test("§ 7: el plan intercala brazos, baraja con semilla y abre con un calentamiento", () => {
  const preguntas = ["a", "b", "c"].map((id) => ({ id }));
  const plan = planificar({ preguntas, brazos: ["ciego", "base"], reps: 2, semilla: 7 });
  assert.equal(plan.length, 1 + 3 * 2 * 2);
  assert.equal(plan[0].calentamiento, true);
  for (let i = 1; i < plan.length; i += 2) {
    assert.equal(plan[i].brazo, "ciego");
    assert.equal(plan[i + 1].brazo, "base");
    assert.equal(plan[i].pregunta, plan[i + 1].pregunta);
  }
  const otra = planificar({ preguntas, brazos: ["ciego", "base"], reps: 2, semilla: 7 });
  assert.deepEqual(otra.map((c) => c.pregunta.id), plan.map((c) => c.pregunta.id));
});

test("§ 2: una pregunta sellada abre con su clave y detecta que la cambiaron", () => {
  const clave = randomBytes(32);
  const p = { id: "R99", clase: "C1", conjunto: "reserva", pregunta: "¿secreto?" };
  const s = sellar(p, clave);
  assert.equal(s.pregunta, undefined);
  assert.deepEqual(abrir(s, clave), p);
  assert.throws(() => abrir({ ...s, sha256: "0".repeat(64) }, clave), /compromiso/);
  assert.throws(() => abrir(s, randomBytes(32)));
});

test("secciones: la ruta completa encuentra un H3 y no lo confunde con texto de un bloque de código", () => {
  const md = "# Nota\n\n## 5. La instancia\n\nintro\n\n### En desarrollo\n\ncuerpo\n\n```md\n## falso\n```\n\n## 6. Otra\n\nfin";
  assert.match(buscarSeccion(md, ["5. La instancia", "En desarrollo"]).texto, /cuerpo[\s\S]*falso/);
  assert.equal(buscarSeccion(md, ["falso"]), null);
  assert.doesNotMatch(buscarSeccion(md, ["5. La instancia"]).texto, /fin/);
});
