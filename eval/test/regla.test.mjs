// Tests de la regla de decisión (§ 9): cada filtro de la § 9.2 y cada fila de la
// tabla de la § 9.3, más el hueco que la tabla deja y los otros defectos.
//
//   node --test eval/test/
import assert from "node:assert/strict";
import { test } from "node:test";
import { aplicarRegla, bootstrap, contaminadas, agrupar, mediana } from "../lib/regla.mjs";

const N = 10; // preguntas
const IDS = Array.from({ length: N }, (_, i) => `Q${String(i + 1).padStart(2, "0")}`);
const claves = Object.fromEntries(IDS.map((q) => [q, { clase: "C1", veredicto: "dato" }]));
const BS = { bootstrap: { replicas: 4000, semilla: 11 } };

/**
 * Filas sintéticas: `p(q)` = aciertos citados de 5, `costo(q)` = costo de cada
 * repetición; el brazo mcp llama a la herramienta salvo que se diga lo contrario.
 */
function brazo(nombre, { p, costo = () => 0.1, mcp = true, compactadas = 0 }) {
  const filas = [];
  for (const [i, q] of IDS.entries())
    for (let rep = 1; rep <= 5; rep++)
      filas.push({
        pregunta: q,
        brazo: nombre,
        rep,
        acierto: rep <= p(q, i) ? 1 : 0,
        acierto_citado: rep <= p(q, i) ? 1 : 0,
        costo: costo(q, i),
        llamadas: nombre === "mcp" && mcp ? { mcp__mycelium__vault_buscar: 1 } : { Grep: 2, Read: 1 },
        compactado: i * 5 + rep <= compactadas,
        descartada: false,
      });
  return filas;
}

const decidir = (base, mcp, extra = []) => aplicarRegla([...base, ...mcp, ...extra], claves, BS);

test("filtro 9.2 · piso: el brazo base por debajo del 50 % → sin conclusión", () => {
  const r = decidir(brazo("base", { p: () => 2 }), brazo("mcp", { p: () => 5 }));
  assert.equal(r.filtros.piso.pasa, false);
  assert.equal(r.fila, null);
  assert.match(r.decision, /Sin conclusión.*piso/);
});

test("filtro 9.2 · adopción: el MCP usado en menos del 50 % → sin conclusión", () => {
  const r = decidir(brazo("base", { p: () => 3 }), brazo("mcp", { p: () => 5, mcp: false }));
  assert.equal(r.filtros.adopcion.pasa, false);
  assert.equal(r.fila, null);
  assert.match(r.decision, /adopción/);
});

test("filtro 9.2 · compactación ≥ 20 %: el costo sale y lo que necesita K no se decide", () => {
  // Δ = 8 pts con IC sin el 0: sería la fila 3, que necesita K.
  const r = decidir(brazo("base", { p: () => 3, compactadas: 12 }), brazo("mcp", { p: (q, i) => (i < 4 ? 4 : 3) }));
  assert.equal(r.filtros.compactacion.base.pasa, false);
  assert.equal(r.k, null);
  assert.equal(r.fila, 3);
  assert.match(r.decision, /NO DECIDIBLE/);
  // Desde el 2026-09-24 la § 9.2 lo dice así: ya no es un defecto de la regla.
  assert.ok(!r.defectos.some((d) => /no tiene filas para decidir sin K/.test(d)));
});

test("bordes: Δ = +10 exacto es fila 2 pese a la coma flotante; −6 es fila 1 y −4 no", () => {
  // Con 10 preguntas y 5 repeticiones Δ va de 2 en 2 pts: el borde −5 no se puede
  // pisar exacto, el +10 sí (5 preguntas ganan 1 de 5).
  const diez = decidir(brazo("base", { p: () => 3 }), brazo("mcp", { p: (q, i) => (i < 5 ? 4 : 3) }));
  assert.equal(diez.delta, 10);
  assert.equal(diez.fila, 2);
  const menos6 = decidir(brazo("base", { p: () => 4 }), brazo("mcp", { p: (q, i) => (i < 3 ? 3 : 4) }));
  assert.equal(menos6.delta, -6);
  assert.equal(menos6.fila, 1);
  const menos4 = decidir(brazo("base", { p: () => 4 }), brazo("mcp", { p: (q, i) => (i < 2 ? 3 : 4) }));
  assert.equal(menos4.delta, -4);
  assert.notEqual(menos4.fila, 1);
});

test("fila 1 · Δ ≤ −5: se abandona o se rehace", () => {
  const r = decidir(brazo("base", { p: () => 4 }), brazo("mcp", { p: () => 3 }));
  assert.equal(r.delta, -20);
  assert.equal(r.fila, 1);
});

test("fila 2 · Δ ≥ +10 con IC sin el 0 y K ≤ 2: entra", () => {
  const r = decidir(brazo("base", { p: () => 3 }), brazo("mcp", { p: () => 5, costo: () => 0.15 }));
  assert.equal(r.fila, 2);
  assert.ok(r.icDelta[0] > 0);
  assert.match(r.decision, /entra/);
  assert.doesNotMatch(r.decision, /usuario/);
});

test("fila 2 · con K > 2: entra solo con decisión explícita del usuario", () => {
  const r = decidir(brazo("base", { p: () => 3 }), brazo("mcp", { p: () => 5, costo: () => 0.4 }));
  assert.equal(r.fila, 2);
  assert.ok(r.k > 2);
  assert.match(r.decision, /decisión explícita del usuario/);
});

test("fila 3 · 0 < Δ < 10 con IC sin el 0 y K ≤ 1: entra", () => {
  const r = decidir(brazo("base", { p: () => 3 }), brazo("mcp", { p: (q, i) => (i < 4 ? 4 : 3), costo: () => 0.09 }));
  assert.equal(r.delta, 8);
  assert.ok(r.icDelta[0] > 0);
  assert.equal(r.fila, 3);
  assert.match(r.decision, /K ≤ 1.*entra/);
});

test("fila 3 · con K > 1 se trata como la fila 5", () => {
  const r = decidir(brazo("base", { p: () => 3 }), brazo("mcp", { p: (q, i) => (i < 4 ? 4 : 3), costo: () => 0.12 }));
  assert.equal(r.fila, 3);
  assert.match(r.decision, /como la fila 5/);
});

test("fila 4 · igual de exacto, K ≤ 0,6 con el IC de K sin el 1: entra por ahorro", () => {
  const r = decidir(brazo("base", { p: () => 3 }), brazo("mcp", { p: () => 3, costo: () => 0.05 }));
  assert.equal(r.delta, 0);
  assert.equal(r.k, 0.5);
  assert.equal(r.fila, 4);
});

test("fila 5 · 0,6 < K ≤ 1: no entra como está", () => {
  const r = decidir(brazo("base", { p: () => 3 }), brazo("mcp", { p: () => 3, costo: () => 0.08 }));
  assert.equal(r.fila, 5);
});

test("fila 6 · K > 1: se rehace", () => {
  const r = decidir(brazo("base", { p: () => 3 }), brazo("mcp", { p: () => 3, costo: () => 0.15 }));
  assert.equal(r.fila, 6);
});

test("fila 7 de la § 9.3: K ≤ 0,6 con el IC de K que no excluye el 1 no demuestra ahorro", () => {
  // Seis preguntas mucho más baratas y cuatro más caras: K = 0,3, pero remuestreando
  // preguntas la mediana llega a 1,3 con probabilidad alta.
  const r = decidir(brazo("base", { p: () => 3 }), brazo("mcp", { p: () => 3, costo: (q, i) => (i < 6 ? 0.03 : 0.13) }));
  assert.ok(Math.abs(r.k - 0.3) < 1e-9);
  assert.ok(r.icK[1] >= 1);
  // Antes era un hueco de la tabla; ahora la fila 7 la hace exhaustiva.
  assert.equal(r.fila, 7);
  assert.match(r.decision, /no entra como está/);
  assert.ok(!r.defectos.some((d) => /Hueco/.test(d)));
});

test("§ 8.2: el ciego que acierta ≥ 2 de 5 contamina la pregunta y la saca del Δ", () => {
  const ciego = brazo("ciego", { p: (q, i) => (i === 0 ? 2 : 0) });
  const r = decidir(brazo("base", { p: () => 3 }), brazo("mcp", { p: () => 3, costo: () => 0.05 }), ciego);
  assert.deepEqual(r.contaminadas.map((c) => c.pregunta), ["Q01"]);
  assert.equal(r.preguntas.length, N - 1);
});

test("§ 8.2 corregido: una pregunta de AUSENCIA no se marca contaminada aunque el ciego «acierte»", () => {
  const g = agrupar(brazo("ciego", { p: () => 5 }));
  const cl = { ...claves, Q01: { clase: "C5", veredicto: "ausencia" } };
  const c = contaminadas(g, cl).map((x) => x.pregunta);
  assert.ok(!c.includes("Q01"));
  assert.ok(c.includes("Q02"));
});

test("bloqueante C7: pierde más de 30 pts sin caer nunca a grep → sí; con caídas → indeterminado", () => {
  const cl = { ...claves, Q01: { clase: "C7", veredicto: "dato" } };
  const base = brazo("base", { p: () => 5 });
  const mcp = brazo("mcp", { p: (q, i) => (i === 0 ? 0 : 5) });
  const r = aplicarRegla([...base, ...mcp], cl, BS);
  assert.equal(r.bloqueanteC7.estado, "sí");
  const mcpConGrep = mcp.map((f) => (f.pregunta === "Q01" && f.rep === 1 ? { ...f, llamadas: { ...f.llamadas, Grep: 1 } } : f));
  const r2 = aplicarRegla([...base, ...mcpConGrep], cl, BS);
  assert.equal(r2.bloqueanteC7.estado, "indeterminado");
  assert.ok(r2.defectos.some((d) => /sin caer a grep|cuánta caída/.test(d)));
});

test("las corridas descartadas no cuentan", () => {
  const base = brazo("base", { p: () => 3 });
  const basura = base.map((f) => ({ ...f, acierto_citado: 0, descartada: true }));
  const r = decidir(base, brazo("mcp", { p: () => 3, costo: () => 0.05 }), basura);
  assert.equal(r.fila, 4);
});

test("el bootstrap es determinista con la misma semilla", () => {
  const datos = IDS.map((q, i) => ({ q, d: i % 3 ? 0.2 : 0, razon: 0.5 + i / 10 }));
  assert.deepEqual(bootstrap(datos, { replicas: 500, semilla: 3 }), bootstrap(datos, { replicas: 500, semilla: 3 }));
  assert.equal(mediana([3, 1, 2]), 2);
  assert.equal(mediana([4, 1, 2, 3]), 2.5);
});
