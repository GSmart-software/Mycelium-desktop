// Tests del script que viaja con la skill `mycelium-calendario` (`FUN-L-26`):
// `scripts/consultar-recordatorios-vault.mjs` replica `lib/recordatorios.ts` sin
// importarlo (en el vault no hay TypeScript), así que acá se comparan los dos en
// miles de casos al azar —con semilla fija— y en varias zonas horarias, y se
// prueba la línea de comandos sobre el vault de ejemplo.
//
//   node --test scripts/test-consultar-recordatorios-vault.mjs
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { importarTs } from "./lib-vault-fixture.mjs";
import * as V from "./consultar-recordatorios-vault.mjs";

const R = await importarTs("lib/recordatorios.ts");
const SCRIPT = fileURLToPath(new URL("./consultar-recordatorios-vault.mjs", import.meta.url));
const VAULT = fileURLToPath(new URL("./fixtures/ia/calendario/vault", import.meta.url));
const SKILL = fileURLToPath(new URL("../lib/ia/borradores/mycelium-calendario.md", import.meta.url));

// ── Generador de casos (mulberry32, semilla fija: los fallos se reproducen) ──

function azar(semilla) {
  let a = semilla >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const dd = (n) => String(n).padStart(2, "0");

function generar(rnd) {
  const elegir = (l) => l[Math.floor(rnd() * l.length)];
  const fecha = () => {
    const raro = rnd() < 0.3;
    const a = elegir([2024, 2025, 2026, 2027, 2028]);
    const m = 1 + Math.floor(rnd() * 12);
    const d = raro ? elegir([28, 29, 30, 31]) : 1 + Math.floor(rnd() * 31);
    return `${a}-${dd(m)}-${dd(d)}`; // a veces imposible (2026-02-30): la app lo descarta
  };
  const recordatorios = [];
  const n = 1 + Math.floor(rnd() * 6);
  for (let i = 0; i < n; i++) {
    const r = {
      id: rnd() < 0.05 ? "" : `r${i}`,
      titulo: rnd() < 0.03 ? 7 : elegir(["Alquiler", "alquiler", "Médico", "medico", "Reunión", "Árbol", "Zeta"]),
      fecha: rnd() < 0.03 ? "2026-1-5" : fecha(),
      hora: elegir([null, undefined, "00:00", "09:30", "09:30", "21:00", "23:59", "24:00", "25:00", "9:30", ""]),
      repeticion: elegir(["ninguna", "dia", "semana", "mes", "mes", "anio", "anio", "quincenal", undefined]),
      color: elegir([1, 4, 8, 0, 12, 2.5, "3"]),
      detalle: elegir(["", "Ver [[Nota]] y [[Otra|alias]].", 5]),
    };
    if (r.hora === undefined) delete r.hora;
    recordatorios.push(r);
  }
  if (rnd() < 0.05) recordatorios.push(null, "x", 3);
  const ocurrencias = {};
  for (let i = 0; i < 6; i++) {
    const clave = `${elegir(recordatorios.filter((r) => r && r.id !== undefined).map((r) => r.id).concat("fantasma"))}@${fecha()}`;
    ocurrencias[rnd() < 0.05 ? "sin-arroba" : clave] = elegir([
      { completada: true },
      { descartada: true },
      { pospuestaHasta: "2026-10-02T21:00" },
      { pospuestaHasta: "2026-02-30T21:00" },
      { pospuestaHasta: "mañana" },
      { completada: "sí" },
      {},
      null,
    ]);
  }
  return { version: 1, recordatorios, ocurrencias };
}

/** Las próximas `n` según la app: día por día con su `ocurrenciasEnRango`, sin atajos. */
function proximasApp(recordatorios, desde, n) {
  const salida = [];
  const vivas = recordatorios.some((r) => r.repeticion !== "ninguna");
  const ultima = recordatorios.reduce((m, r) => (r.fecha > m ? r.fecha : m), desde);
  const tope = vivas ? R.sumarDias(ultima, 366 * 9 * n) : ultima;
  for (let f = desde; f <= tope && salida.length < n; f = R.sumarDias(f, 1)) {
    salida.push(...R.ocurrenciasEnRango(recordatorios, f, f));
  }
  return salida.slice(0, n);
}

const plano = (ocs) => ocs.map((o) => `${o.fecha}|${o.recordatorio.id}|${o.recordatorio.hora}|${o.recordatorio.titulo}`);

/** Lo que el modelo de la app considera un recordatorio (sin `vigenteDesde`, que el script no usa). */
const normalizar = (a) => ({
  recordatorios: a.recordatorios.map(({ vigenteDesde, ...r }) => r),
  ocurrencias: a.ocurrencias,
});

// La app trabaja en hora local; el script, en el calendario. Tienen que dar lo mismo
// en cualquier zona, también en las que cambian de horario (Santiago) o están a +14.
for (const tz of ["America/Argentina/Buenos_Aires", "America/Santiago", "Pacific/Kiritimati", "UTC"]) {
  test(`script = lib/recordatorios.ts en 400 calendarios al azar (TZ=${tz})`, () => {
    const antes = process.env.TZ;
    process.env.TZ = tz;
    try {
      const rnd = azar(0xc0ffee + tz.length);
      for (let caso = 0; caso < 400; caso++) {
        const json = generar(rnd);
        const app = R.leerArchivo(json);
        const script = V.leerArchivo(json);
        assert.deepEqual(normalizar(script), normalizar(app), `caso ${caso}: lectura`);

        const desde = `${2026 + Math.floor(rnd() * 3)}-${dd(1 + Math.floor(rnd() * 12))}-${dd(1 + Math.floor(rnd() * 28))}`;
        const hasta = R.sumarDias(desde, Math.floor(rnd() * 120));
        assert.deepEqual(
          plano(V.ocurrenciasEnRango(script.recordatorios, desde, hasta)),
          plano(R.ocurrenciasEnRango(app.recordatorios, desde, hasta)),
          `caso ${caso}: ${desde} → ${hasta}\n${JSON.stringify(json)}`,
        );

        const n = 1 + Math.floor(rnd() * 8);
        const esperadas = plano(proximasApp(app.recordatorios, desde, n));
        assert.deepEqual(plano(V.proximas(script.recordatorios, desde, n)), esperadas, `caso ${caso}: próximas ${n}`);

        for (const p of ["dia", "semana", "mes"]) assert.deepEqual(V.rangoDePeriodo(desde, p), R.rangoDePeriodo(desde, p));
        assert.equal(V.diaDeSemana(desde), R.diaDeSemana(desde));
        assert.equal(V.diasEntre(desde, hasta), R.diasEntre(desde, hasta));
      }
    } finally {
      if (antes === undefined) delete process.env.TZ;
      else process.env.TZ = antes;
    }
  });
}

test("fechas: válidas e imposibles como la app (bisiestos, 31 de abril, formato)", () => {
  for (const f of ["2028-02-29", "2026-02-29", "2100-02-29", "2000-02-29", "2026-04-31", "2026-12-31", "2026-13-01", "2026-00-10", "2026-1-05", "", "2026-09-30T10:00"]) {
    assert.equal(V.esFechaValida(f), R.esFechaValida(f), f);
  }
});

// ── Línea de comandos ────────────────────────────────────────────────────────

const correr = (args, cwd = VAULT) => spawnSync(process.execPath, [SCRIPT, ...args], { cwd, encoding: "utf8" });
const lineas = (r) => r.stdout.split("\n").filter((l) => /^\d{4}-/.test(l));

test("--semana con --fecha-hoy: lunes a domingo, hecha, aviso pospuesto y marca huérfana", () => {
  const r = correr(["--semana", "--fecha-hoy", "2026-09-30"]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^Del 2026-09-28 al 2026-10-04: 11 ocurrencia/m);
  assert.match(r.stdout, /^2026-09-29 mar {2}10:30 {2}Reunión de equipo {2}\(cada semana\) {2}✓ hecha {2}→ \[\[Reuniones\/Equipo\]\]$/m);
  assert.match(r.stdout, /^2026-10-01 jue {2}21:00 {2}Tomar la medicación .*\[aviso pospuesto hasta 2026-10-02 21:00\]/m);
  assert.match(r.stdout, /^Aviso: «Pagar alquiler» tiene una marca de hecha el 2026-09-30, pero ese día no ocurre/m);
  assert.doesNotMatch(r.stdout, /^2026-09-30 .*Pagar alquiler/m);
  assert.equal((r.stdout.match(/^Aviso:/gm) ?? []).length, 1, "el id que ya no existe no avisa");
});

test("--proximas con --buscar: sin tildes ni mayúsculas, sin tope de fecha", () => {
  const r = correr(["--proximas", "3", "--buscar", "MEDICACION", "--fecha-hoy", "2026-09-30"]);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(lineas(r).map((l) => l.slice(0, 10)), ["2026-09-30", "2026-10-01", "2026-10-02"]);
  const lucia = correr(["--proximas", "2", "--buscar", "lucía", "--fecha-hoy", "2026-09-30"]);
  assert.deepEqual(lineas(lucia).map((l) => l.slice(0, 10)), ["2028-02-29", "2032-02-29"]);
});

test("--mes y --desde/--hasta dan lo mismo que el modelo de la app", async () => {
  const app = R.leerArchivo(JSON.parse(await readFile(`${VAULT}/.mycelium/recordatorios.json`, "utf8")));
  for (const [args, desde, hasta] of [
    [["--mes", "2026-10-15"], "2026-10-01", "2026-10-31"],
    [["--desde", "2026-01-01", "--hasta", "2026-12-31"], "2026-01-01", "2026-12-31"],
    [["--dia", "2028-02-29"], "2028-02-29", "2028-02-29"],
  ]) {
    const r = correr([...args, "--json"]);
    assert.equal(r.status, 0, r.stderr);
    const j = JSON.parse(r.stdout);
    assert.deepEqual([j.desde, j.hasta], [desde, hasta]);
    assert.deepEqual(
      j.ocurrencias.map((o) => `${o.fecha}|${o.hora}|${o.titulo}`),
      R.ocurrenciasEnRango(app.recordatorios, desde, hasta).map((o) => `${o.fecha}|${o.recordatorio.hora}|${o.recordatorio.titulo}`),
    );
  }
});

test("sin --fecha-hoy toma el reloj local y lo dice", () => {
  const r = correr(["--hoy"]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^Hoy: \d{4}-\d{2}-\d{2} \S+ \(\d\d:\d\d, reloj de este proceso\)$/m);
});

test("sin calendario lo dice y no falla; argumentos malos → exit 2", () => {
  const sin = correr(["--hoy"], fileURLToPath(new URL("./fixtures/ia/base/vault", import.meta.url)));
  assert.equal(sin.status, 0);
  assert.match(sin.stdout, /Sin calendario/);
  assert.equal(correr(["--dia"]).status, 2);
  assert.equal(correr(["--desde", "2026-10-05", "--hasta", "2026-10-01"]).status, 2);
  assert.equal(correr(["--proximas", "cero"]).status, 2);
  assert.equal(correr(["--semana", "--fecha-hoy", "2026-02-30"]).status, 2);
});

test("la skill manda a correr el script que viaja con ella", async () => {
  const md = (await readFile(SKILL, "utf8")).replace(/\r\n/g, "\n");
  assert.match(md, /node \.claude\/skills\/mycelium-calendario\/consultar\.mjs --semana/);
  for (const op of ["--proximas", "--buscar", "--fecha-hoy", "--mes"]) assert.ok(md.includes(op), `la skill no explica ${op}`);
});
