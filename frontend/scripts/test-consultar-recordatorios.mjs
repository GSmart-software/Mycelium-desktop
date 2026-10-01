// Tests de la consulta del calendario de la skill `mycelium-calendario`
// (`FUN-L-26`): los casos de borde de la repetición contra el modelo real
// (`lib/recordatorios.ts`) y el comando de las fechas de las notas del borrador.
// El script que viaja con la skill se prueba en `test-consultar-recordatorios-vault.mjs`.
//
//   node --test scripts/test-consultar-recordatorios.mjs
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { consultar, leerRecordatorios } from "./consultar-recordatorios.mjs";

const VAULT = fileURLToPath(new URL("./fixtures/ia/calendario/vault", import.meta.url));
const SKILL = fileURLToPath(new URL("../lib/ia/borradores/mycelium-calendario.md", import.meta.url));
const archivo = await leerRecordatorios(VAULT);

const titulos = (desde, hasta) => consultar(archivo, desde, hasta).map((o) => `${o.fecha} ${o.titulo}`);

test("la app descarta: sin id, fecha imposible", () => {
  const nombres = archivo.recordatorios.map((r) => r.titulo);
  assert.ok(!nombres.includes("Sin id"));
  assert.ok(!nombres.includes("Fecha imposible"));
  assert.equal(archivo.recordatorios.length, 8);
});

test("normaliza: hora inválida → todo el día, repetición desconocida → ninguna, color → 1", () => {
  const d30 = archivo.recordatorios.find((r) => r.titulo === "Día 30 de cada mes");
  assert.equal(d30.hora, null);
  assert.equal(d30.color, 1);
  const q = archivo.recordatorios.find((r) => r.titulo === "Repetición desconocida");
  assert.equal(q.repeticion, "ninguna");
  assert.deepEqual(titulos("2026-10-13", "2026-10-13").filter((t) => t.includes("Repetición")), []);
});

test("mensual el 31: no cae en meses sin 31 (ni se corre al 30)", () => {
  const alquiler = titulos("2026-01-01", "2026-12-31").filter((t) => t.endsWith("Pagar alquiler"));
  assert.deepEqual(alquiler.map((t) => t.slice(0, 10)), [
    "2026-01-31", "2026-03-31", "2026-05-31", "2026-07-31", "2026-08-31", "2026-10-31", "2026-12-31",
  ]);
});

test("mensual el 30: no cae en febrero", () => {
  const d30 = titulos("2026-02-01", "2026-03-31").filter((t) => t.endsWith("Día 30 de cada mes"));
  assert.deepEqual(d30, ["2026-03-30 Día 30 de cada mes"]);
});

test("anual el 29 de febrero: solo en bisiestos", () => {
  const cumple = (a) => titulos(`${a}-02-01`, `${a}-03-31`).filter((t) => t.includes("Lucía"));
  assert.deepEqual(cumple(2026), []);
  assert.deepEqual(cumple(2027), []);
  assert.deepEqual(cumple(2028), ["2028-02-29 Cumpleaños de Lucía"]);
});

test("nada antes de la fecha del recordatorio", () => {
  assert.deepEqual(titulos("2026-09-20", "2026-09-27").filter((t) => t.includes("medicación")), []);
});

test("semanal: el mismo día de la semana; completada es por ocurrencia", () => {
  const semana = consultar(archivo, "2026-09-28", "2026-10-11").filter((o) => o.titulo === "Reunión de equipo");
  assert.deepEqual(semana.map((o) => [o.fecha, o.dia, o.completada]), [
    ["2026-09-29", "mar", true],
    ["2026-10-06", "mar", false],
  ]);
});

test("descartada y pospuesta no quitan la ocurrencia del día", () => {
  const med = consultar(archivo, "2026-09-30", "2026-10-01").filter((o) => o.titulo === "Tomar la medicación");
  assert.equal(med.length, 2);
  assert.equal(med[0].descartada, true);
  assert.equal(med[0].completada, false);
  assert.equal(med[1].pospuestaHasta, "2026-10-02T21:00");
});

test("orden: todo el día primero, después por hora", () => {
  const dia = consultar(archivo, "2026-09-30", "2026-09-30").map((o) => o.hora);
  assert.deepEqual(dia, [null, "21:00"]);
});

const md = (await readFile(SKILL, "utf8")).replace(/\r\n/g, "\n");

// ── Las fechas de las notas (sección aparte de la skill) ────────────────────

const sh = spawnSync("sh", ["-c", "true"]).status === 0;
const notasConFecha = /```sh\n(# notas-con-fecha[\s\S]*?)```/.exec(md)?.[1];

test("el comando de notas con fecha: propiedades del rango, sin lo oculto", { skip: !sh && "sin sh" }, () => {
  assert.ok(notasConFecha, "no se encontró el bloque # notas-con-fecha");
  const r = spawnSync("sh", ["-c", notasConFecha], {
    cwd: fileURLToPath(new URL("./fixtures/ia/base/vault", import.meta.url)),
    encoding: "utf8",
  });
  assert.equal(r.status, 0, r.stderr);
  // Del 28/09 al 04/10 solo vence «Pagar dominio» (28/09); «Rediseño del API» vence el 15/10.
  assert.deepEqual(r.stdout.trim().split("\n"), ["2026-09-28  ./Tareas/Pagar dominio.md  vence: 2026-09-28"]);
});
