// Test headless (sin navegador ni Tauri) de la Parte 2 del MCP de control
// (`FUN-L-09`): la lógica de las herramientas del calendario
// (`lib/mcpCalendarioLogica.ts`) —validación de argumentos, colores por nombre,
// ocurrencias de un rango, próxima ocurrencia, el texto del efecto, deshacer— y
// el registro de actividad (`lib/actividadIa.ts`). Los módulos se transpilan en
// el momento, como en `scripts/test-mcp-control.mjs`.
//
//   node --test scripts/test-mcp-calendario.mjs
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import ts from "typescript";

const aUrl = (codigo) => `data:text/javascript,${encodeURIComponent(codigo)}`;

async function fuente(ruta, mapa = {}) {
  const texto = await readFile(fileURLToPath(new URL(ruta, import.meta.url)), "utf8");
  let { outputText } = ts.transpileModule(texto, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 },
  });
  for (const [especificador, url] of Object.entries(mapa)) {
    outputText = outputText.split(`"${especificador}"`).join(`"${url}"`);
  }
  return aUrl(outputText);
}

const EXTENSIONES = await fuente("../lib/extensionesDeTipo.ts");
const WIKILINKS = await fuente("../lib/wikilinks.ts", { "@/lib/extensionesDeTipo": EXTENSIONES });
const CONTROL = await fuente("../lib/mcpControlLogica.ts", { "@/lib/wikilinks": WIKILINKS });
const RECORDATORIOS = await fuente("../lib/recordatorios.ts");
const cal = await import(
  await fuente("../lib/mcpCalendarioLogica.ts", { "@/lib/mcpControlLogica": CONTROL, "@/lib/recordatorios": RECORDATORIOS })
);
const rec = await import(RECORDATORIOS);
const act = await import(await fuente("../lib/actividadIa.ts"));

const r = (campos) => ({ id: "r1", titulo: "Revisar", fecha: "2026-10-03", hora: "10:00", repeticion: "ninguna", color: 1, detalle: "", ...campos });
const archivo = (recordatorios, ocurrencias = {}) => ({ version: 1, recordatorios, ocurrencias });
// Jueves 1 de octubre de 2026, 12:00 local.
const AHORA = new Date(2026, 9, 1, 12, 0);

// ── Validación ──────────────────────────────────────────────────────────────

test("crear: valores por defecto y normalización", () => {
  const v = cal.validarCrear({ titulo: "  Revisar conclusiones ", fecha: "2026-10-03" });
  assert.deepEqual(v, {
    ok: true,
    valor: { titulo: "Revisar conclusiones", fecha: "2026-10-03", hora: null, repeticion: "ninguna", color: 1, detalle: "" },
  });
  const w = cal.validarCrear({ titulo: "X", fecha: "2026-10-03", hora: "09:30", repeticion: "Semana", color: "espora", detalle: "ver [[Plan]]" });
  assert.equal(w.ok, true);
  assert.equal(w.valor.repeticion, "semana");
  assert.equal(w.valor.color, 7);
});

test("crear: cada campo malo es INVALIDO con el campo y el porqué", () => {
  const casos = [
    [{ titulo: "", fecha: "2026-10-03" }, "titulo", /vacío/],
    [{ titulo: "a\nb", fecha: "2026-10-03" }, "titulo", /una sola línea/],
    [{ titulo: "X", fecha: "2026-02-30" }, "fecha", /no existe/],
    [{ titulo: "X", fecha: "3/10/2026" }, "fecha", /AAAA-MM-DD/],
    [{ titulo: "X" }, "fecha", /AAAA-MM-DD/],
    [{ titulo: "X", fecha: "2026-10-03", hora: "25:00" }, "hora", /HH:MM/],
    [{ titulo: "X", fecha: "2026-10-03", hora: "9:30" }, "hora", /HH:MM/],
    [{ titulo: "X", fecha: "2026-10-03", color: "Violeta" }, "color", /Hifa, Musgo/],
    [{ titulo: "X", fecha: "2026-10-03", color: 3 }, "color", /paleta/],
    [{ titulo: "X", fecha: "2026-10-03", repeticion: "quincena" }, "repeticion", /ninguna, dia, semana, mes, anio/],
    [{ titulo: "X", fecha: "2026-10-03", lugar: "casa" }, "lugar", /no es un campo/],
  ];
  for (const [args, campo, porque] of casos) {
    const v = cal.validarCrear(args);
    assert.equal(v.ok, false, JSON.stringify(args));
    assert.equal(v.error.codigo, "INVALIDO");
    assert.deepEqual(v.error.datos, { campo });
    assert.match(v.error.mensaje, porque, v.error.mensaje);
    assert.ok(v.error.mensaje.startsWith(`\`${campo}\``), v.error.mensaje);
  }
});

test("los colores se reconocen sin mayúsculas ni tildes", () => {
  assert.equal(cal.colorPorNombre("HIFA"), 1);
  assert.equal(cal.colorPorNombre(" bruma "), 8);
  assert.equal(cal.colorPorNombre("Lìquen"), 3);
  assert.equal(cal.colorPorNombre("verde"), null);
  assert.equal(cal.nombreDeColor(6), "Coral");
});

test("editar: solo lo que viene; hora null pasa a todo el día; vacío es inválido", () => {
  assert.deepEqual(cal.validarEditar({ id: "r1", hora: null }), { ok: true, valor: { id: "r1", cambios: { hora: null } } });
  assert.deepEqual(cal.validarEditar({ id: "r1", color: "Coral", titulo: "Nuevo" }).valor.cambios, { color: 6, titulo: "Nuevo" });
  assert.equal(cal.validarEditar({ id: "r1" }).ok, false);
  assert.equal(cal.validarEditar({ titulo: "X" }).error.datos.campo, "id");
  assert.equal(cal.validarEditar({ id: "r1", fecha: "2026-13-01" }).error.datos.campo, "fecha");
});

test("completar: completado por defecto true; borrar pide id", () => {
  assert.deepEqual(cal.validarCompletar({ id: "r1", fecha: "2026-10-03" }).valor, { id: "r1", fecha: "2026-10-03", completado: true });
  assert.equal(cal.validarCompletar({ id: "r1", fecha: "2026-10-03", completado: false }).valor.completado, false);
  assert.equal(cal.validarCompletar({ id: "r1", fecha: "2026-10-03", completado: "no" }).ok, false);
  assert.equal(cal.validarBorrar({}).ok, false);
});

test("el rango tiene tope de 366 días y orden", () => {
  assert.equal(cal.validarRango({ desde: "2026-01-01", hasta: "2027-01-01" }).ok, true, "366 días justos");
  const largo = cal.validarRango({ desde: "2026-01-01", hasta: "2027-01-02" });
  assert.equal(largo.ok, false);
  assert.match(largo.error.mensaje, /367 días/);
  assert.equal(cal.validarRango({ desde: "2026-10-05", hasta: "2026-10-01" }).error.datos.campo, "hasta");
});

// ── Lectura ─────────────────────────────────────────────────────────────────

test("las ocurrencias de un rango salen con la lógica de la app", () => {
  const a = archivo(
    [
      r({ id: "sem", titulo: "Reunión", fecha: "2026-09-28", hora: "10:30", repeticion: "semana", color: 2 }),
      r({ id: "dia", titulo: "Médico", fecha: "2026-10-02", hora: null, detalle: "# Llevar\n**estudios** y [[Plan|el plan]]" }),
      r({ id: "mes", titulo: "Alquiler", fecha: "2026-08-31", hora: null, repeticion: "mes" }),
    ],
    { "sem@2026-10-05": { completada: true } },
  );
  const o = cal.ocurrenciasParaIa(a, "2026-10-01", "2026-10-31");
  assert.deepEqual(
    o.map((x) => `${x.fecha} ${x.id}`),
    ["2026-10-02 dia", "2026-10-05 sem", "2026-10-12 sem", "2026-10-19 sem", "2026-10-26 sem", "2026-10-31 mes"],
  );
  assert.equal(o[0].detalle, "Llevar");
  assert.equal(o[0].dia, "vie 2 oct");
  assert.equal(o[1].color, "Musgo");
  assert.equal(o[1].completada, true);
  assert.equal(o[2].completada, false, "es por ocurrencia");
  // Septiembre no tiene 31: el alquiler no cae.
  assert.equal(cal.ocurrenciasParaIa(a, "2026-09-01", "2026-09-30").some((x) => x.id === "mes"), false);
});

test("NO_ENCONTRADO ofrece los parecidos por título, con su id", () => {
  const a = archivo([r({ id: "x1", titulo: "Médico" }), r({ id: "x2", titulo: "Reunión de equipo" })]);
  const v = cal.buscarRecordatorio(a, "medico");
  assert.equal(v.ok, false);
  assert.equal(v.error.codigo, "NO_ENCONTRADO");
  assert.deepEqual(v.error.datos.candidatas, [{ titulo: "Médico", ruta: "id x1" }]);
  assert.equal(cal.buscarRecordatorio(a, "x2").valor.titulo, "Reunión de equipo");
});

// ── Próxima ocurrencia y efecto ─────────────────────────────────────────────

test("la próxima ocurrencia y si va a avisar", () => {
  assert.deepEqual(cal.proximaOcurrencia(r({}), AHORA), { proxima: "2026-10-03", avisa: "2026-10-03" });
  // Todo el día, hoy: se ve hoy pero su momento (medianoche) ya pasó.
  assert.deepEqual(cal.proximaOcurrencia(r({ fecha: "2026-10-01", hora: null }), AHORA), { proxima: "2026-10-01", avisa: null });
  assert.deepEqual(
    cal.proximaOcurrencia(r({ fecha: "2026-10-01", hora: null, repeticion: "dia" }), AHORA),
    { proxima: "2026-10-01", avisa: "2026-10-02" },
  );
  // Ya pasó y no se repite.
  assert.deepEqual(cal.proximaOcurrencia(r({ fecha: "2026-09-20" }), AHORA), { proxima: null, avisa: null });
  // Hoy a las 9, ya pasó; semanal → la semana que viene.
  assert.deepEqual(
    cal.proximaOcurrencia(r({ fecha: "2026-10-01", hora: "09:00", repeticion: "semana" }), AHORA),
    { proxima: "2026-10-08", avisa: "2026-10-08" },
  );
  // 29 de febrero anual: el próximo bisiesto.
  assert.equal(cal.proximaOcurrencia(r({ fecha: "2024-02-29", repeticion: "anio" }), AHORA).proxima, "2028-02-29");
});

test("el efecto dice qué pasó, no el eco", () => {
  assert.equal(
    cal.efectoCrear(r({ titulo: "Revisar conclusiones" }), AHORA),
    "Creé «Revisar conclusiones» para el sábado 3 de octubre a las 10:00, color Hifa. Va a avisar.",
  );
  assert.match(cal.efectoCrear(r({ fecha: "2026-10-02" }), AHORA), /para mañana a las 10:00/);
  assert.match(cal.efectoCrear(r({ fecha: "2026-09-20" }), AHORA), /No va a avisar: su fecha ya pasó/);
  assert.match(
    cal.efectoCrear(r({ fecha: "2026-09-28", repeticion: "semana", color: 3 }), AHORA),
    /para el lunes 28 de septiembre a las 10:00 \(se repite cada lunes; la próxima, el lunes 5 de octubre a las 10:00\), color Liquen\. Va a avisar\./,
  );
  assert.match(cal.efectoCrear(r({ fecha: "2027-01-05" }), AHORA), /martes 5 de enero de 2027/);

  const antes = r({});
  const despues = r({ hora: "11:00", color: 6 });
  assert.equal(
    cal.efectoEditar(antes, despues, AHORA),
    "Edité «Revisar»: hora 10:00 → 11:00, color Hifa → Coral. Queda para el sábado 3 de octubre a las 11:00. Va a avisar.",
  );
  assert.match(cal.efectoEditar(antes, antes, AHORA), /no cambié nada/);
  assert.match(cal.efectoCompletar(antes, "2026-10-03", true, false, AHORA), /^Marqué como completado «Revisar»/);
  assert.match(cal.efectoCompletar(antes, "2026-10-03", true, true, AHORA), /ya estaba completado/);
  assert.match(cal.efectoBorrar(r({ repeticion: "dia" }), AHORA), /^Borré «Revisar» \(la serie entera\)/);
});

test("completar una fecha en la que no ocurre dice las vecinas", () => {
  const semanal = r({ fecha: "2026-09-28", repeticion: "semana" });
  assert.equal(cal.comprobarOcurrencia(semanal, "2026-10-05").ok, true);
  const v = cal.comprobarOcurrencia(semanal, "2026-10-06");
  assert.equal(v.ok, false);
  assert.match(v.error.mensaje, /Las más cercanas: 2026-10-05 y 2026-10-12/);
  assert.match(cal.comprobarOcurrencia(r({}), "2026-10-04").error.mensaje, /es solo el 2026-10-03/);
});

// ── Deshacer ────────────────────────────────────────────────────────────────

test("deshacer: lo creado tiene que existir, lo borrado no tiene que haber vuelto", () => {
  const a = archivo([r({})]);
  assert.equal(cal.puedeDeshacer(a, { tipo: "borrar", id: "r1" }).ok, true);
  assert.equal(cal.puedeDeshacer(archivo([]), { tipo: "borrar", id: "r1" }).ok, false);
  assert.equal(cal.puedeDeshacer(a, { tipo: "restaurar", recordatorio: r({}), ocurrencias: {} }).ok, false);
  assert.equal(cal.puedeDeshacer(archivo([]), { tipo: "restaurar", recordatorio: r({}), ocurrencias: {} }).ok, true);
  assert.equal(cal.puedeDeshacer(archivo([]), { tipo: "completar", id: "r1", fecha: "2026-10-03", completado: false }).ok, false);
});

test("restaurar devuelve el recordatorio con su id y el estado de sus ocurrencias", () => {
  const original = archivo([r({ repeticion: "dia" }), r({ id: "otro" })], {
    "r1@2026-10-02": { completada: true },
    "otro@2026-10-02": { descartada: true },
  });
  const guardadas = rec.ocurrenciasDe(original, "r1");
  assert.deepEqual(guardadas, { "r1@2026-10-02": { completada: true } });
  const sin = archivo([r({ id: "otro" })], { "otro@2026-10-02": { descartada: true } });
  const vuelta = rec.restaurarRecordatorio(sin, r({ repeticion: "dia" }), guardadas);
  assert.deepEqual(vuelta.recordatorios.map((x) => x.id), ["otro", "r1"]);
  assert.equal(rec.estaCompletada(vuelta, "r1@2026-10-02"), true);
  assert.equal(vuelta.ocurrencias["otro@2026-10-02"].descartada, true);
});

test("fijarCompletada es idempotente y conserva lo demás", () => {
  const a = archivo([r({})], { "r1@2026-10-03": { descartada: true } });
  const b = rec.fijarCompletada(a, "r1@2026-10-03", true);
  assert.deepEqual(b.ocurrencias["r1@2026-10-03"], { descartada: true, completada: true });
  assert.equal(rec.fijarCompletada(b, "r1@2026-10-03", true), b, "ya estaba: no cambia");
  assert.deepEqual(rec.fijarCompletada(b, "r1@2026-10-03", false).ocurrencias["r1@2026-10-03"], { descartada: true });
});

// ── El registro de actividad ────────────────────────────────────────────────

const entrada = (id, op, extra = {}) => ({ v: 1, id, momento: "2026-10-01T15:00:00.000Z", op, resultado: "hecho", efecto: `${op} ${id}`, ...extra });

test("un renglón dañado se ignora y los demás valen", () => {
  const texto = [
    JSON.stringify(entrada("a", "abrir", { objetivo: { tipo: "nota", ruta: "Plan.md" } })),
    "{esto no es json",
    "",
    JSON.stringify({ id: "b", op: "x" }), // sin efecto ni momento
    JSON.stringify(entrada("c", "recordatorio_crear", { deshacer: { tipo: "borrar", id: "r1" }, objetivo: { tipo: "rara" } })),
  ].join("\r\n");
  const l = act.leerActividad(texto);
  assert.deepEqual(l.map((e) => e.id), ["a", "c"]);
  assert.deepEqual(l[0].objetivo, { tipo: "nota", ruta: "Plan.md" });
  assert.equal(l[1].objetivo, undefined, "un objetivo desconocido se descarta, la entrada no");
  assert.deepEqual(l[1].deshacer, { tipo: "borrar", id: "r1" });
  assert.deepEqual(act.leerActividad(null), []);
});

test("el registro tiene tope y se recorta al escribir", () => {
  let lista = [];
  for (let i = 0; i < 7; i++) lista = act.agregarEntrada(lista, entrada(`e${i}`, "abrir"), 5);
  assert.deepEqual(lista.map((e) => e.id), ["e2", "e3", "e4", "e5", "e6"]);
  const texto = act.serializar(lista);
  assert.equal(texto.split("\n").length, 6, "un renglón por entrada y salto final");
  assert.deepEqual(act.leerActividad(texto), lista);
  assert.equal(act.TOPE_ENTRADAS, 500);
});

test("deshacer no reescribe: se cruza al leer", () => {
  const lista = [
    entrada("a", "recordatorio_crear", { deshacer: { tipo: "borrar", id: "r1" } }),
    entrada("b", "abrir"),
    { ...entrada("d", "deshacer"), ref: "a", momento: "2026-10-01T15:05:00.000Z" },
  ];
  const v = act.vistaActividad(lista);
  assert.deepEqual(v.map((e) => e.id), ["b", "a"], "lo más nuevo primero, sin las entradas de deshacer");
  assert.equal(v[1].deshechaEn, "2026-10-01T15:05:00.000Z");
  assert.equal(v[0].deshechaEn, null);
});

test("qué se registra: estado no, leer el calendario solo si falla", () => {
  assert.equal(act.seRegistra("estado", "hecho"), false);
  assert.equal(act.seRegistra("abrir", "hecho"), true);
  assert.equal(act.seRegistra("recordatorios", "hecho"), false);
  assert.equal(act.seRegistra("recordatorios", "fallo"), true);
  assert.equal(act.seRegistra("recordatorio_borrar", "rechazado"), true);
});

test("el estado del canal: conectado es que habló hace poco", () => {
  const t = 1_000_000_000;
  assert.equal(act.estadoCanal(false, null, t, t), "apagado");
  assert.equal(act.estadoCanal(true, "tomado", null, t), "error");
  assert.equal(act.estadoCanal(true, null, null, t), "encendido");
  assert.equal(act.estadoCanal(true, null, t - 60_000, t), "conectado");
  assert.equal(act.estadoCanal(true, null, t - act.VENTANA_CONECTADO_MS - 1, t), "encendido");
});
