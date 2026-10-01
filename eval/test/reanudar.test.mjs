// Reanudar una tanda sin volver a pagar lo ya hecho.
import assert from "node:assert/strict";
import { test } from "node:test";
import { yaHechas } from "../correr.mjs";

const fila = (o) => ({ tanda: "t1", pregunta: "D01", brazo: "base", rep: 1, descartada: false, motivo_descarte: null, ...o });

test("una corrida válida cuenta como hecha; una descartada no", () => {
  const r = yaHechas([fila({ session_id: "a" }), fila({ session_id: "b", rep: 2, descartada: true, motivo_descarte: "sin salida" })], "t1");
  assert.ok(r.hechas.has("D01|base|1"));
  assert.ok(!r.hechas.has("D01|base|2"), "la descartada se tiene que repetir");
});

test("manda la última fila de cada sesión (append-only)", () => {
  // Una corrida primero válida y después corregida como descartada: se repite.
  const r = yaHechas([fila({ session_id: "a" }), fila({ session_id: "a", descartada: true, motivo_descarte: "corregida" })], "t1");
  assert.ok(!r.hechas.has("D01|base|1"));
});

test("solo cuenta la tanda pedida", () => {
  const r = yaHechas([fila({ session_id: "a", tanda: "otra" })], "t1");
  assert.equal(r.hechas.size, 0);
});

test("el calentamiento se reconoce aunque esté descartado a propósito", () => {
  const r = yaHechas([fila({ session_id: "c", descartada: true, motivo_descarte: "calentamiento" })], "t1");
  assert.equal(r.calentamiento, true);
  assert.equal(r.hechas.size, 0);
});
