// Tests de la consulta del calendario de la skill `mycelium-calendario`
// (`FUN-L-26`): los casos de borde de la repetición contra el modelo real
// (`lib/recordatorios.ts`), y que el script que la skill le da a la IA
// —sacado tal cual del borrador— responda exactamente lo mismo.
//
//   node --test scripts/test-consultar-recordatorios.mjs
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { R, consultar, leerRecordatorios } from "./consultar-recordatorios.mjs";

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

// ── El script de la skill da lo mismo que la app ────────────────────────────

const md = (await readFile(SKILL, "utf8")).replace(/\r\n/g, "\n");
const snippet = /<<'EOF'\n([\s\S]*?)\nEOF/.exec(md)?.[1];

function correrSnippet(desde, hasta) {
  const r = spawnSync(process.execPath, ["-", desde, hasta], { input: snippet, cwd: VAULT, encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout.trim().split("\n").filter((l) => /^\d{4}-/.test(l));
}

/** Lo esencial de cada línea: fecha, hora, título y si está hecha. */
function esencial(linea) {
  const m = /^(\S+) \S+ {2}(todo el día|\d\d:\d\d) {2}(.+?)(?: {2}\(cada [^)]+\))?( {2}✓ hecha)?(?: {2}→ .*)?$/.exec(linea);
  assert.ok(m, `línea inesperada: ${linea}`);
  return `${m[1]}|${m[2]}|${m[3]}|${m[4] ? "hecha" : ""}`;
}

test("el borrador trae el script", () => {
  assert.ok(snippet && snippet.includes("consultar-recordatorios"), "no se encontró el bloque <<'EOF' … EOF");
});

for (const [desde, hasta] of [
  ["2026-09-28", "2026-10-04"],
  ["2026-01-01", "2026-12-31"],
  ["2028-02-01", "2028-03-31"],
  ["2026-02-27", "2026-03-02"],
]) {
  test(`script de la skill = modelo de la app, ${desde} → ${hasta}`, () => {
    const esperado = consultar(archivo, desde, hasta).map(
      (o) => `${o.fecha}|${o.hora ?? "todo el día"}|${o.titulo}|${o.completada ? "hecha" : ""}`,
    );
    assert.deepEqual(correrSnippet(desde, hasta).map(esencial), esperado);
  });
}

test("script de la skill: una marca de hecha en un día sin ocurrencia se avisa y no se cuenta", () => {
  // `a1b2c3d4-0001@2026-09-30`: el alquiler es el 31 y septiembre no tiene 31.
  const r = spawnSync(process.execPath, ["-", "2026-09-28", "2026-10-04"], { input: snippet, cwd: VAULT, encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^Aviso: «Pagar alquiler» tiene una marca de hecha el 2026-09-30, pero ese día no ocurre/m);
  assert.doesNotMatch(r.stdout, /^2026-09-30 .*Pagar alquiler/m);
  // Un id que ya no existe (`…0099`) se ignora sin aviso, y fuera del rango tampoco se avisa.
  assert.equal((r.stdout.match(/^Aviso:/gm) ?? []).length, 1);
  const fuera = spawnSync(process.execPath, ["-", "2026-10-01", "2026-10-31"], { input: snippet, cwd: VAULT, encoding: "utf8" });
  assert.doesNotMatch(fuera.stdout, /^Aviso:/m);
});

test("script de la skill: los de todo el día van primero aunque otro sea a las 00:00", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cal-"));
  try {
    await mkdir(join(dir, ".mycelium"));
    await writeFile(join(dir, ".mycelium", "recordatorios.json"), JSON.stringify({
      version: 1,
      recordatorios: [
        { id: "a", titulo: "A medianoche", fecha: "2026-10-01", hora: "00:00", repeticion: "ninguna", color: 1, detalle: "" },
        { id: "z", titulo: "Z todo el día", fecha: "2026-10-01", hora: null, repeticion: "ninguna", color: 1, detalle: "" },
        { id: "b", titulo: "B tarde", fecha: "2026-10-01", hora: "18:00", repeticion: "ninguna", color: 1, detalle: "" },
      ],
      ocurrencias: {},
    }));
    const r = spawnSync(process.execPath, ["-", "2026-10-01", "2026-10-01"], { input: snippet, cwd: dir, encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);
    const orden = r.stdout.trim().split("\n").map((l) => l.split("  ")[2]);
    assert.deepEqual(orden, ["Z todo el día", "A medianoche", "B tarde"]);
    const modelo = consultar(R.leerArchivo(JSON.parse(await readFile(join(dir, ".mycelium", "recordatorios.json"), "utf8"))), "2026-10-01", "2026-10-01");
    assert.deepEqual(modelo.map((o) => o.titulo), orden);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

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

test("script de la skill sin calendario: lo dice y no falla", () => {
  const r = spawnSync(process.execPath, ["-", "2026-01-01", "2026-01-02"], {
    input: snippet,
    cwd: fileURLToPath(new URL("./fixtures/ia/base/vault", import.meta.url)),
    encoding: "utf8",
  });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /Sin calendario/);
});
