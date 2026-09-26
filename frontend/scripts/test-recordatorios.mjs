// Test headless del modelo de recordatorios del calendario (`FUN-L-22`).
//
// `lib/recordatorios.ts` es puro —sin imports y sin leer el reloj—, así que se
// transpila en el momento y se importa vía data: URL, igual que el resto de los
// núcleos del proyecto. «Ahora» se pasa a mano: así se prueba «la app estuvo
// cerrada una semana» sin esperar una semana.
//
//   node --test scripts/test-recordatorios.mjs
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import ts from "typescript";

const rutaTs = fileURLToPath(new URL("../lib/recordatorios.ts", import.meta.url));
const { outputText } = ts.transpileModule(await readFile(rutaTs, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
});
const R = await import(`data:text/javascript,${encodeURIComponent(outputText)}`);

/** Un recordatorio con valores por defecto razonables. */
function rec(extra) {
  return {
    id: "r1",
    titulo: "Recordatorio",
    fecha: "2026-01-01",
    hora: null,
    repeticion: "ninguna",
    color: 1,
    detalle: "",
    ...extra,
  };
}

const archivo = (recordatorios, ocurrencias = {}) => ({
  version: 1,
  recordatorios,
  ocurrencias,
});

/** Un momento local: `en("2026-09-25", "10:30")`. */
const en = (fecha, hora = "00:00") => R.aDate(fecha, hora);

/** Las fechas en las que ocurre un recordatorio dentro de un rango. */
const fechas = (r, desde, hasta) => R.ocurrenciasEnRango([r], desde, hasta).map((o) => o.fecha);

// ── Repetición ─────────────────────────────────────────────────────────────

test("sin repetición ocurre solo en su fecha", () => {
  assert.deepEqual(fechas(rec({ fecha: "2026-03-10" }), "2026-03-01", "2026-03-31"), ["2026-03-10"]);
});

test("cada día: todos los días desde su fecha, ninguno antes", () => {
  const r = rec({ fecha: "2026-03-29", repeticion: "dia" });
  assert.deepEqual(fechas(r, "2026-03-27", "2026-04-02"), [
    "2026-03-29", "2026-03-30", "2026-03-31", "2026-04-01", "2026-04-02",
  ]);
});

test("cada semana cae siempre el mismo día de la semana", () => {
  const r = rec({ fecha: "2026-09-02", repeticion: "semana" }); // miércoles
  const lista = fechas(r, "2026-08-01", "2026-11-30");
  assert.equal(lista[0], "2026-09-02", "no hay ocurrencias antes de la fecha");
  assert.equal(lista.length, 13);
  for (const f of lista) assert.equal(R.diaDeSemana(f), 2, `${f} no es miércoles`);
  // Cruza el cambio de mes sin correrse.
  assert.ok(lista.includes("2026-09-30") && lista.includes("2026-10-07"));
});

test("cada mes el 31: se saltea los meses que no tienen 31, no se corre al último día", () => {
  const r = rec({ fecha: "2026-01-31", repeticion: "mes" });
  assert.deepEqual(fechas(r, "2026-01-01", "2026-12-31"), [
    "2026-01-31", "2026-03-31", "2026-05-31", "2026-07-31",
    "2026-08-31", "2026-10-31", "2026-12-31",
  ]);
});

test("cada mes el 30: febrero no tiene ocurrencia", () => {
  const r = rec({ fecha: "2026-01-30", repeticion: "mes" });
  const lista = fechas(r, "2026-01-01", "2026-04-30");
  assert.deepEqual(lista, ["2026-01-30", "2026-03-30", "2026-04-30"]);
});

test("cada año el 29 de febrero: solo en los bisiestos", () => {
  const r = rec({ fecha: "2028-02-29", repeticion: "anio" });
  const lista = fechas(r, "2028-01-01", "2036-12-31");
  assert.deepEqual(lista, ["2028-02-29", "2032-02-29", "2036-02-29"]);
});

test("cada año cae la misma fecha", () => {
  const r = rec({ fecha: "2026-09-25", repeticion: "anio" });
  assert.deepEqual(fechas(r, "2026-01-01", "2028-12-31"), [
    "2026-09-25", "2027-09-25", "2028-09-25",
  ]);
});

// ── Ocurrencias de un rango ───────────────────────────────────────────────

test("las ocurrencias de un rango salen ordenadas: fecha, todo el día primero, hora, título", () => {
  const recs = [
    rec({ id: "b", titulo: "B", fecha: "2026-09-25", hora: "10:00" }),
    rec({ id: "a", titulo: "A", fecha: "2026-09-25", hora: null }),
    rec({ id: "c", titulo: "C", fecha: "2026-09-24", hora: "18:00" }),
    rec({ id: "d", titulo: "D", fecha: "2026-09-25", hora: "08:30" }),
    rec({ id: "fuera", fecha: "2026-10-01" }),
  ];
  const ids = R.ocurrenciasEnRango(recs, "2026-09-24", "2026-09-25").map((o) => o.recordatorio.id);
  assert.deepEqual(ids, ["c", "a", "d", "b"]);
});

test("el rango de un período: día, semana de lunes a domingo, mes entero", () => {
  assert.deepEqual(R.rangoDePeriodo("2026-09-25", "dia"), { desde: "2026-09-25", hasta: "2026-09-25" });
  // 2026-09-25 es viernes.
  assert.deepEqual(R.rangoDePeriodo("2026-09-25", "semana"), { desde: "2026-09-21", hasta: "2026-09-27" });
  assert.deepEqual(R.rangoDePeriodo("2026-02-10", "mes"), { desde: "2026-02-01", hasta: "2026-02-28" });
});

test("la grilla del mes: semanas completas de lunes a domingo", () => {
  const semanas = R.semanasDelMes(2026, 9); // septiembre 2026 empieza en martes
  assert.equal(semanas[0][0], "2026-08-31");
  assert.equal(semanas.at(-1)[6], "2026-10-04");
  for (const s of semanas) assert.equal(s.length, 7);
  assert.equal(semanas.length, 5);
});

// ── Cuándo avisa ───────────────────────────────────────────────────────────

test("uno con hora avisa a esa hora, no antes", () => {
  const a = archivo([rec({ fecha: "2026-09-25", hora: "10:00" })]);
  assert.equal(R.avisosPendientes(a, en("2026-09-25", "09:59")).length, 0);
  const avisos = R.avisosPendientes(a, en("2026-09-25", "10:00"));
  assert.equal(avisos.length, 1);
  assert.equal(avisos[0].vencida, false, "a su hora no está vencido");
});

test("uno sin hora avisa al abrir ese día, sin marcarse vencido", () => {
  const a = archivo([rec({ fecha: "2026-09-25", hora: null })]);
  const avisos = R.avisosPendientes(a, en("2026-09-25", "15:20"));
  assert.equal(avisos.length, 1);
  assert.equal(avisos[0].vencida, false);
  // El día anterior, todavía no.
  assert.equal(R.avisosPendientes(a, en("2026-09-24", "23:59")).length, 0);
});

test("uno que venció con la app cerrada avisa marcado como vencido", () => {
  const a = archivo([rec({ fecha: "2026-09-25", hora: "10:00" })]);
  const [aviso] = R.avisosPendientes(a, en("2026-09-25", "12:00"));
  assert.equal(aviso.vencida, true);
  assert.equal(R.describirVencimiento(aviso, en("2026-09-25", "12:00")), "Era a las 10:00");

  const [ayer] = R.avisosPendientes(a, en("2026-09-26", "09:00"));
  assert.equal(R.describirVencimiento(ayer, en("2026-09-26", "09:00")), "Era ayer a las 10:00");

  const b = archivo([rec({ fecha: "2026-09-20", hora: null })]);
  const [viejo] = R.avisosPendientes(b, en("2026-09-25", "09:00"));
  assert.equal(viejo.vencida, true);
  assert.equal(R.describirVencimiento(viejo, en("2026-09-25", "09:00")), "Era el 20 de septiembre");
});

test("uno diario perdido una semana avisa UNA vez, por la ocurrencia más reciente", () => {
  const a = archivo([rec({ fecha: "2026-09-01", hora: "09:00", repeticion: "dia" })]);
  const avisos = R.avisosPendientes(a, en("2026-09-25", "12:00"));
  assert.equal(avisos.length, 1);
  assert.equal(avisos[0].fecha, "2026-09-25");
  // Antes de la hora de hoy, la más reciente es la de ayer.
  const temprano = R.avisosPendientes(a, en("2026-09-25", "08:00"));
  assert.equal(temprano.length, 1);
  assert.equal(temprano[0].fecha, "2026-09-24");
});

test("hacia atrás, como mucho 30 días", () => {
  const hace29 = archivo([rec({ fecha: "2026-08-27", hora: null })]);
  assert.equal(R.avisosPendientes(hace29, en("2026-09-25", "12:00")).length, 1);
  const hace40 = archivo([rec({ fecha: "2026-08-16", hora: "10:00" })]);
  assert.equal(R.avisosPendientes(hace40, en("2026-09-25", "12:00")).length, 0);
  // Uno que se repite desde hace meses sí avisa: por la de hoy.
  const viejoDiario = archivo([rec({ fecha: "2025-01-01", repeticion: "dia" })]);
  assert.equal(R.avisosPendientes(viejoDiario, en("2026-09-25", "12:00"))[0].fecha, "2026-09-25");
});

test("no avisa por ocurrencias anteriores a que el recordatorio existiera", () => {
  const a = archivo([
    rec({ fecha: "2026-09-25", hora: "09:00", repeticion: "dia", vigenteDesde: "2026-09-25T11:00" }),
  ]);
  assert.equal(R.avisosPendientes(a, en("2026-09-25", "11:05")).length, 0);
  // Mañana a las 9 sí.
  assert.equal(R.avisosPendientes(a, en("2026-09-26", "09:00")).length, 1);
});

test("Listo: la ocurrencia descartada no vuelve a avisar; la próxima repetición sí", () => {
  let a = archivo([rec({ fecha: "2026-09-24", hora: "10:00", repeticion: "dia" })]);
  const [aviso] = R.avisosPendientes(a, en("2026-09-24", "10:00"));
  a = R.descartar(a, aviso.clave);
  // «Reabrir la app»: el archivo pasa por JSON y se relee.
  a = R.leerArchivo(JSON.parse(JSON.stringify(a)));
  assert.equal(R.avisosPendientes(a, en("2026-09-24", "18:00")).length, 0);
  assert.equal(R.avisosPendientes(a, en("2026-09-25", "09:00")).length, 0);
  const [manana] = R.avisosPendientes(a, en("2026-09-25", "10:00"));
  assert.equal(manana.fecha, "2026-09-25");
});

test("Posponer: vuelve a avisar a su hora, aunque la app se cierre entre medio", () => {
  let a = archivo([rec({ fecha: "2026-09-25", hora: "10:00" })]);
  const ahora = en("2026-09-25", "10:00");
  const [aviso] = R.avisosPendientes(a, ahora);
  const [diezMin, unaHora, manana] = R.opcionesPosponer(ahora);
  assert.equal(R.momentoLocal(diezMin.hasta), "2026-09-25T10:10");
  assert.equal(R.momentoLocal(unaHora.hasta), "2026-09-25T11:00");
  assert.equal(R.momentoLocal(manana.hasta), "2026-09-26T10:00");

  a = R.posponer(a, aviso.clave, unaHora.hasta);
  a = R.leerArchivo(JSON.parse(JSON.stringify(a)));
  assert.equal(R.avisosPendientes(a, en("2026-09-25", "10:30")).length, 0);
  const [otraVez] = R.avisosPendientes(a, en("2026-09-25", "11:00"));
  assert.equal(otraVez.clave, aviso.clave);
  assert.equal(otraVez.vencida, false);
  // Con la app cerrada hasta las 15: avisa al abrir, vencido desde las 11.
  const [tarde] = R.avisosPendientes(a, en("2026-09-25", "15:00"));
  assert.equal(R.describirVencimiento(tarde, en("2026-09-25", "15:00")), "Era a las 11:00");
});

test("la limpieza tira el estado de recordatorios borrados y de ocurrencias viejas", () => {
  const a = archivo([rec({ id: "vivo", repeticion: "dia" })], {
    "vivo@2026-09-24": { descartada: true },
    "vivo@2026-07-01": { descartada: true },
    "vivo@2026-07-02": { pospuestaHasta: "2026-10-01T10:00" },
    "borrado@2026-09-24": { descartada: true },
  });
  const limpio = R.limpiarOcurrencias(a, en("2026-09-25", "12:00"));
  assert.deepEqual(Object.keys(limpio.ocurrencias).sort(), ["vivo@2026-07-02", "vivo@2026-09-24"]);
});

// ── El archivo ─────────────────────────────────────────────────────────────

test("leer el archivo tolera entradas rotas sin perder las buenas", () => {
  const a = R.leerArchivo({
    version: 1,
    recordatorios: [
      rec({ id: "ok", hora: "25:00", color: 42, repeticion: "cada tanto" }),
      { id: "sin-fecha", titulo: "x" },
      rec({ id: "fecha-imposible", fecha: "2026-02-30" }),
      null,
    ],
    ocurrencias: { "ok@2026-01-01": { descartada: true }, basura: 3 },
  });
  assert.equal(a.recordatorios.length, 1);
  assert.equal(a.recordatorios[0].hora, null);
  assert.equal(a.recordatorios[0].color, 1);
  assert.equal(a.recordatorios[0].repeticion, "ninguna");
  assert.deepEqual(a.ocurrencias, { "ok@2026-01-01": { descartada: true } });
});

test("lo que no tiene forma de archivo de recordatorios devuelve null (no se sobrescribe)", () => {
  assert.equal(R.leerArchivo(null), null);
  assert.equal(R.leerArchivo([]), null);
  assert.equal(R.leerArchivo({ version: 1 }), null);
  assert.equal(R.leerArchivo("texto"), null);
});

test("fechas: validación y aritmética de calendario", () => {
  assert.equal(R.esFechaValida("2028-02-29"), true);
  assert.equal(R.esFechaValida("2026-02-29"), false);
  assert.equal(R.esHoraValida("23:59"), true);
  assert.equal(R.esHoraValida("24:00"), false);
  assert.equal(R.sumarDias("2026-12-31", 1), "2027-01-01");
  assert.equal(R.sumarMeses("2026-01-31", 1), "2026-02-28");
  assert.equal(R.diasEntre("2026-03-01", "2026-04-01"), 31);
});

test("el primer renglón del detalle, sin marcas", () => {
  assert.equal(R.primerRenglon("\n\n# Llamar a [[Juan Pérez|Juan]]\nresto"), "Llamar a Juan");
  assert.equal(R.primerRenglon("- [ ] revisar **[[Presupuesto]]**"), "revisar Presupuesto");
  assert.equal(R.primerRenglon(""), "");
});
