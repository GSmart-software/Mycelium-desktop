// Tests de la regla de la tesina («MCP de Mycelium - tesina, regla de decision»):
// cada fila de su tabla, los bloqueantes de C7 y C9, y que la § 9 del vault de
// Mycelium no cambió al agregarla.
//
//   node --test eval/test/
import assert from "node:assert/strict";
import { test } from "node:test";
import { aplicarRegla } from "../lib/regla.mjs";
import { aplicarReglaTiempo } from "../lib/regla-tiempo.mjs";

const N = 10;
const IDS = Array.from({ length: N }, (_, i) => `Q${String(i + 1).padStart(2, "0")}`);
const clavesDe = (clase = () => "C1") => Object.fromEntries(IDS.map((q, i) => [q, { clase: clase(q, i), veredicto: "dato" }]));
const BS = { bootstrap: { replicas: 4000, semilla: 11 } };

/** Filas sintéticas: `p` aciertos citados de 5, `costo` y `ms` por repetición. */
function brazo(nombre, { p, costo = () => 0.1, ms = () => 20000, mcp = true, compactadas = 0, llamadas = null }) {
  const filas = [];
  for (const [i, q] of IDS.entries())
    for (let rep = 1; rep <= 5; rep++)
      filas.push({
        session_id: `${nombre}-${q}-${rep}`,
        pregunta: q,
        brazo: nombre,
        rep,
        acierto: rep <= p(q, i) ? 1 : 0,
        acierto_citado: rep <= p(q, i) ? 1 : 0,
        costo: costo(q, i),
        ms_total: ms(q, i),
        llamadas: llamadas ?? (nombre === "mcp" && mcp ? { mcp__mycelium__vault_buscar: 1 } : { Grep: 2, Read: 1 }),
        compactado: i * 5 + rep <= compactadas,
        descartada: false,
      });
  return filas;
}

const decidir = (base, mcp, opciones = {}, claves = clavesDe()) => aplicarReglaTiempo([...base, ...mcp], claves, { ...BS, ...opciones });
const BASE = brazo("base", { p: () => 3 });

test("tesina · fila 1: Δ ≤ −5 no entra, aunque sea más barato y más rápido", () => {
  const r = decidir(BASE, brazo("mcp", { p: (q, i) => (i < 5 ? 2 : 3), costo: () => 0.02, ms: () => 5000 }));
  assert.equal(r.fila, 1);
  assert.match(r.decision, /empeora/);
});

test("tesina · fila 2: Δ ≥ +10 con IC sin el 0 entra; con R > 2, solo con decisión explícita", () => {
  const mejor = (extra) => brazo("mcp", { p: () => 4, ...extra });
  assert.equal(decidir(BASE, mejor({})).fila, 2);
  assert.match(decidir(BASE, mejor({})).decision, /entra\./);
  const lento = decidir(BASE, mejor({ ms: () => 50000 }));
  assert.equal(lento.fila, 2);
  assert.ok(lento.r > 2);
  assert.match(lento.decision, /decisión explícita/);
  const caro = decidir(BASE, mejor({ costo: () => 0.25 }));
  assert.match(caro.decision, /decisión explícita/);
});

test("tesina · fila 3: más exacto (< +10) entra solo si K ≤ 1 y R ≤ 1", () => {
  // Δ = +8 pts con IC sin el 0.
  const p = (q, i) => (i < 4 ? 4 : 3);
  const r = decidir(BASE, brazo("mcp", { p, costo: () => 0.09, ms: () => 19000 }));
  assert.equal(r.fila, 3);
  assert.ok(r.delta > 0 && r.delta < 10 && r.icDelta[0] > 0);
  // Tarda más: la fila 3 no se cumple y sigue la tabla hasta la 5.
  const lento = decidir(BASE, brazo("mcp", { p, costo: () => 0.09, ms: () => 26000 }));
  assert.equal(lento.fila, 5);
  assert.ok(lento.r > 1);
});

test("tesina · fila 4: empate, K ≤ 0,6 Y R ≤ 0,75, los dos con IC sin el 1 → entra", () => {
  const r = decidir(BASE, brazo("mcp", { p: () => 3, costo: () => 0.05, ms: () => 12000 }));
  assert.equal(r.fila, 4);
  assert.ok(r.k <= 0.6 && r.icK[1] < 1);
  assert.ok(r.r <= 0.75 && r.icR[1] < 1);
});

test("tesina · fila 4 exige las dos: barato pero no lo bastante rápido → fila 6", () => {
  // K = 0,5 claramente, R = 0,85: más rápido, pero no un cuarto.
  const r = decidir(BASE, brazo("mcp", { p: () => 3, costo: () => 0.05, ms: () => 17000 }));
  assert.equal(r.fila, 6);
  assert.match(r.decision, /no está demostrada en las dos/);
  // Y al revés: rápido pero caro de más para la fila 4.
  const r2 = decidir(BASE, brazo("mcp", { p: () => 3, costo: () => 0.08, ms: () => 10000 }));
  assert.equal(r2.fila, 6);
});

test("tesina · fila 4 exige el IC: R ≤ 0,75 con un IC que toca el 1 → fila 6", () => {
  // Mitad de las preguntas mucho más rápidas, mitad igual: mediana ≤ 0,75, IC hasta 1.
  const r = decidir(BASE, brazo("mcp", { p: () => 3, costo: () => 0.05, ms: (q, i) => (i < 6 ? 8000 : 20000) }));
  assert.ok(r.r <= 0.75, `R = ${r.r}`);
  assert.ok(r.icR[1] >= 1, `IC de R ${r.icR}`);
  assert.equal(r.fila, 6);
});

test("tesina · fila 5: K > 1 o R > 1 sin acertar más → se rehace", () => {
  assert.equal(decidir(BASE, brazo("mcp", { p: () => 3, ms: () => 25000 })).fila, 5);
  assert.equal(decidir(BASE, brazo("mcp", { p: () => 3, costo: () => 0.12, ms: () => 10000 })).fila, 5);
});

test("tesina · filtros de la § 9.2: si fallan, no hay conclusión y R no se calcula", () => {
  const r = decidir(brazo("base", { p: () => 2 }), brazo("mcp", { p: () => 5 }));
  assert.equal(r.fila, null);
  assert.match(r.decision, /Sin conclusión/);
  assert.equal(r.r, null);
});

test("tesina · compactación: K y R dejan de ser comparables y lo que los necesita no se decide", () => {
  const r = decidir(brazo("base", { p: () => 3, compactadas: 12 }), brazo("mcp", { p: () => 3, costo: () => 0.05, ms: () => 10000 }));
  assert.equal(r.k, null);
  assert.equal(r.r, null);
  assert.match(r.decision, /NO DECIDIBLE/);
});

test("tesina · bloqueante C9: pierde 30 y nunca leyó el PDF → sí; si lo leyó alguna vez → indeterminado", () => {
  const claves = clavesDe((q, i) => (i < 2 ? "C9" : "C1"));
  const mcp = brazo("mcp", { p: (q, i) => (i < 2 ? 0 : 3), costo: () => 0.05, ms: () => 12000 });
  const nunca = new Map(mcp.filter((f) => claves[f.pregunta].clase === "C9").map((f) => [f.session_id, false]));
  const r = decidir(BASE, mcp, { leyoPdf: nunca }, claves);
  assert.equal(r.bloqueanteC9.estado, "sí");
  assert.equal(r.bloqueanteC9.tasaRepliegue, 0);
  const unaVez = new Map(nunca);
  unaVez.set([...nunca.keys()][0], true);
  const r2 = decidir(BASE, mcp, { leyoPdf: unaVez }, claves);
  assert.equal(r2.bloqueanteC9.estado, "indeterminado");
  assert.ok(r2.defectos.some((d) => /Bloqueante C9/.test(d)));
  // Sin transcripciones no se sabe: se dice, no se supone.
  const r3 = decidir(BASE, mcp, {}, claves);
  assert.equal(r3.bloqueanteC9.estado, "indeterminado");
  assert.ok(r3.defectos.some((d) => /sin transcripción/.test(d)));
});

test("tesina · bloqueante C9 no aplica si el MCP no pierde 30 puntos", () => {
  const claves = clavesDe((q, i) => (i < 2 ? "C9" : "C1"));
  const r = decidir(BASE, brazo("mcp", { p: () => 3 }), {}, claves);
  assert.equal(r.bloqueanteC9.estado, "no");
});

test("tesina · bloqueante C7: el mismo de la § 9 (caída a grep)", () => {
  const claves = clavesDe((q, i) => (i < 2 ? "C7" : "C1"));
  const mcp = brazo("mcp", { p: (q, i) => (i < 2 ? 0 : 3), llamadas: { mcp__mycelium__vault_buscar: 2 } });
  assert.equal(decidir(BASE, mcp, {}, claves).bloqueanteC7.estado, "sí");
});

test("la § 9 del vault de Mycelium no mira el tiempo: lento y barato sigue siendo la fila 4", () => {
  const mcp = brazo("mcp", { p: () => 3, costo: () => 0.05, ms: () => 40000 });
  const s9 = aplicarRegla([...BASE, ...mcp], clavesDe(), BS);
  assert.equal(s9.fila, 4);
  assert.equal(s9.r, undefined);
  assert.equal(decidir(BASE, mcp).fila, 5);
});
