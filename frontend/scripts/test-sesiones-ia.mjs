// Test headless (sin navegador ni Tauri) de la coordinación entre sesiones de
// IA (`FUN-L-31`): anuncios de sesión, quién murió, las reservas (vencimiento,
// conflicto, renovar, liberar, limpieza al morir la sesión), el objetivo de una
// reserva, lo que se le cuenta a una sesión de las otras y el registro de
// actividad agrupado por sesión (`lib/sesionesIa.ts`, `lib/actividadIa.ts`).
//
//   node --test scripts/test-sesiones-ia.mjs
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

const s = await import(await fuente("../lib/sesionesIa.ts"));
const act = await import(await fuente("../lib/actividadIa.ts"));
const EXTENSIONES = await fuente("../lib/extensionesDeTipo.ts");
const WIKILINKS = await fuente("../lib/wikilinks.ts", { "@/lib/extensionesDeTipo": EXTENSIONES });
const CONTROL = await fuente("../lib/mcpControlLogica.ts", { "@/lib/wikilinks": WIKILINKS });
const TITULO = await fuente("../lib/tituloEditable.ts");
const arch = await import(
  await fuente("../lib/mcpArchivosLogica.ts", { "@/lib/mcpControlLogica": CONTROL, "@/lib/tituloEditable": TITULO })
);

const MIN = 60_000;
const T0 = Date.parse("2026-11-01T10:00:00Z");
const datos = (id, extra = {}) => ({ id, pid: 1, inicio: T0, cliente: null, ...extra });
const sesion = (id, extra = {}) => ({ ...datos(id), tarea: null, ultimaActividad: null, presente: true, ...extra });
const nota = (ruta) => ({ clase: "nota", ruta, existe: true });
const carpeta = (ruta) => ({ clase: "carpeta", ruta, existe: true });
const reserva = (sesionId, objetivo, extra = {}) => ({
  sesion: sesionId,
  objetivo,
  motivo: "trabajo",
  desde: T0,
  vence: T0 + 30 * MIN,
  ...extra,
});

// ── Anuncios y sesiones ─────────────────────────────────────────────────────

test("un anuncio de sesión se lee con su cliente; uno sin id usable no sirve", () => {
  const d = s.leerDatosSesion({ id: "4f28-a1b3", pid: 20264, inicio: T0, cliente: { nombre: "claude-code", version: "2.1" } });
  assert.deepEqual(d, { id: "4f28-a1b3", pid: 20264, inicio: T0, cliente: { nombre: "claude-code", version: "2.1" } });
  assert.equal(s.leerDatosSesion({ id: "4f28-a1b3", cliente: null }).cliente, null);
  assert.equal(s.leerDatosSesion(null), null);
  assert.equal(s.leerDatosSesion({ id: "con espacio" }), null);
  assert.equal(s.leerDatosSesion({ id: "x".repeat(65) }), null);
  assert.equal(s.leerDatosSesion("4f28"), null);
});

test("la lista de Rust manda: las presentes que no figuran murieron; las no anunciadas quedan", () => {
  const previas = {
    a: sesion("a", { tarea: "Docs", ultimaActividad: T0 + MIN }),
    b: sesion("b"),
    c: sesion("c", { presente: false, ultimaActividad: T0 }),
  };
  const { sesiones, murieron } = s.conConectadas(previas, [datos("a"), datos("d")]);
  assert.deepEqual(murieron, ["b"]);
  assert.deepEqual(Object.keys(sesiones).sort(), ["a", "c", "d"]);
  assert.equal(sesiones.a.tarea, "Docs", "la tarea sobrevive al aviso");
  assert.equal(sesiones.a.ultimaActividad, T0 + MIN);
  assert.equal(sesiones.d.presente, true);
  assert.equal(sesiones.c.presente, false);
});

test("un pedido registra la sesión (aunque no se haya anunciado) y su actividad", () => {
  let ses = s.conActividad({}, datos("x"), T0 + 5 * MIN);
  assert.equal(ses.x.presente, false);
  assert.equal(ses.x.ultimaActividad, T0 + 5 * MIN);
  ses = s.conConectadas(ses, [datos("x")]).sesiones;
  assert.equal(ses.x.presente, true);
  ses = s.conActividad(ses, datos("x"), T0 + 9 * MIN);
  assert.equal(ses.x.ultimaActividad, T0 + 9 * MIN);
  assert.equal(ses.x.presente, true);
});

test("una sesión que nunca se anunció se olvida tras la inactividad; una presente no", () => {
  const ses = {
    vieja: sesion("vieja", { presente: false, ultimaActividad: T0 }),
    viva: sesion("viva", { ultimaActividad: T0 }),
  };
  assert.deepEqual(s.sinOlvidadas(ses, T0 + 10 * MIN).olvidadas, []);
  const r = s.sinOlvidadas(ses, T0 + s.OLVIDAR_SIN_PRESENCIA_MS + 1);
  assert.deepEqual(r.olvidadas, ["vieja"]);
  assert.deepEqual(Object.keys(r.sesiones), ["viva"]);
});

// ── Validar ─────────────────────────────────────────────────────────────────

test("mycelium_sesion: la tarea en una línea, con tope; un campo de más es INVALIDO", () => {
  assert.deepEqual(s.validarSesion({ tarea: "  Reorganizar\n docs  " }), { ok: true, valor: { tarea: "Reorganizar docs" } });
  assert.equal(s.validarSesion({}).ok, false);
  assert.equal(s.validarSesion({ tarea: "   " }).ok, false);
  const larga = s.validarSesion({ tarea: "x".repeat(s.TOPE_TEXTO + 1) });
  assert.equal(larga.ok, false);
  assert.equal(larga.error.datos.campo, "tarea");
  const otro = s.validarSesion({ tarea: "a", titulo: "b" });
  assert.equal(otro.error.codigo, "INVALIDO");
  assert.equal(otro.error.datos.campo, "titulo");
});

test("mycelium_reservar: objetivo y motivo obligatorios, minutos por defecto y con tope; liberar sin objetivo", () => {
  assert.deepEqual(s.validarReservar({ objetivo: "Plan", motivo: "reescribir" }), {
    ok: true,
    valor: { liberar: false, objetivo: "Plan", motivo: "reescribir", minutos: s.MINUTOS_RESERVA_DEFECTO },
  });
  assert.equal(s.validarReservar({ objetivo: "Plan", motivo: "x", minutos: 90 }).valor.minutos, 90);
  for (const minutos of [0, 241, 1.5, "10"]) {
    const r = s.validarReservar({ objetivo: "Plan", motivo: "x", minutos });
    assert.equal(r.ok, false, String(minutos));
    assert.equal(r.error.datos.campo, "minutos");
  }
  assert.equal(s.validarReservar({ objetivo: "Plan" }).error.datos.campo, "motivo");
  assert.equal(s.validarReservar({ motivo: "x" }).error.datos.campo, "objetivo");
  assert.deepEqual(s.validarReservar({ liberar: true }), { ok: true, valor: { liberar: true, objetivo: null } });
  assert.deepEqual(s.validarReservar({ liberar: true, objetivo: "Plan" }).valor, { liberar: true, objetivo: "Plan" });
  assert.equal(s.validarReservar({ liberar: "si" }).error.datos.campo, "liberar");
  assert.equal(s.validarReservar({ objetivo: "Plan", motivo: "x", hasta: 3 }).error.datos.campo, "hasta");
});

// ── El objetivo ─────────────────────────────────────────────────────────────

const notas = [
  { id: "docs/Plan.md", titulo: "Plan", carpetaId: "docs", tipo: "markdown" },
  { id: "Inicio.md", titulo: "Inicio", carpetaId: null, tipo: "markdown" },
];
const carpetas = [{ id: "docs", nombre: "docs", padreId: null }];
const resolver = (o) => s.objetivoDeReserva(o, arch.resolverAfectado(o, notas, carpetas, []));

test("el objetivo: nota por título o ruta, carpeta por ruta; una nota que no existe, solo por ruta", () => {
  assert.deepEqual(resolver("Plan").valor, nota("docs/Plan.md"));
  assert.deepEqual(resolver("docs/").valor, carpeta("docs"));
  assert.deepEqual(resolver("docs/Nueva").valor, { clase: "nota", ruta: "docs/Nueva.md", existe: false });
  assert.deepEqual(resolver("Nueva.md").valor, { clase: "nota", ruta: "Nueva.md", existe: false });
  assert.deepEqual(resolver("docs/sub/").valor, { clase: "carpeta", ruta: "docs/sub", existe: false });
  // Un título suelto que no existe es un typo, no una reserva.
  const typo = resolver("Plam");
  assert.equal(typo.ok, false);
  assert.equal(typo.error.codigo, "NO_ENCONTRADO");
  assert.ok(typo.error.datos.candidatas.some((c) => c.ruta === "docs/Plan.md"));
  // Ni rutas que se salen del vault.
  assert.equal(resolver("../fuera.md").error.codigo, "INVALIDO");
});

// ── Reservas ────────────────────────────────────────────────────────────────

test("dos objetivos se pisan si son la misma ruta o uno es una carpeta que contiene al otro", () => {
  assert.ok(s.sePisan(nota("docs/Plan.md"), nota("DOCS/plan.md")));
  assert.ok(s.sePisan(carpeta("docs"), nota("docs/Plan.md")));
  assert.ok(s.sePisan(nota("docs/a/b.md"), carpeta("docs")));
  assert.ok(s.sePisan(carpeta("docs"), carpeta("docs/a")));
  assert.ok(!s.sePisan(carpeta("docs"), nota("docs2/Plan.md")), "un prefijo de nombre no es contener");
  assert.ok(!s.sePisan(nota("docs/a.md"), nota("docs/b.md")));
});

test("reservar se concede siempre y avisa del conflicto con otra sesión", () => {
  const ajena = reserva("b", carpeta("docs"), { motivo: "reordenar" });
  const r = s.reservar([ajena], reserva("a", nota("docs/Plan.md")), T0 + MIN);
  assert.equal(r.reservas.length, 2, "concedida aunque pise");
  assert.deepEqual(r.conflictos, [ajena]);
  assert.equal(r.renovada, false);
  // Las propias no son conflicto.
  const propia = s.reservar([reserva("a", carpeta("docs"))], reserva("a", nota("docs/Plan.md")), T0 + MIN);
  assert.deepEqual(propia.conflictos, []);
});

test("reservar de nuevo lo mismo renueva (no duplica); lo vencido se descarta y no es conflicto", () => {
  const vieja = reserva("a", nota("docs/Plan.md"), { vence: T0 + 10 * MIN });
  const nueva = reserva("a", nota("docs/plan.md"), { desde: T0 + 5 * MIN, vence: T0 + 35 * MIN });
  const r = s.reservar([vieja], nueva, T0 + 5 * MIN);
  assert.equal(r.renovada, true);
  assert.deepEqual(r.reservas, [nueva]);
  const vencida = reserva("b", nota("docs/Plan.md"), { vence: T0 + 2 * MIN });
  const r2 = s.reservar([vencida], reserva("a", nota("docs/Plan.md")), T0 + 3 * MIN);
  assert.deepEqual(r2.conflictos, []);
  assert.equal(r2.reservas.length, 1, "la vencida se fue");
  assert.deepEqual(s.vigentes([vencida], T0 + 2 * MIN), [], "vencer es estricto: en el instante del vencimiento ya no vale");
});

test("liberar suelta solo lo de la sesión: una ruta, o todas", () => {
  const lista = [
    reserva("a", nota("docs/Plan.md")),
    reserva("a", carpeta("docs")),
    reserva("b", nota("docs/Plan.md")),
  ];
  const una = s.liberar(lista, "a", "docs/plan.md", T0);
  assert.equal(una.liberadas.length, 1);
  assert.equal(una.reservas.length, 2);
  const carpetaSola = s.liberar(lista, "a", "docs", T0);
  assert.deepEqual(carpetaSola.liberadas.map((r) => r.objetivo.ruta), ["docs"], "liberar la carpeta no suelta lo de adentro");
  const todas = s.liberar(lista, "a", null, T0);
  assert.equal(todas.liberadas.length, 2);
  assert.deepEqual(todas.reservas.map((r) => r.sesion), ["b"]);
  assert.match(s.efectoLiberar([], null), /no tenía reservas/);
  assert.match(s.efectoLiberar(todas.liberadas, null), /^Liberé 2 reservas/);
});

test("cuando una sesión muere se van sus reservas (y solo las suyas)", () => {
  const lista = [reserva("a", nota("x.md")), reserva("b", nota("y.md")), reserva("a", carpeta("z"))];
  assert.deepEqual(s.sinReservasDe(lista, ["a"]).map((r) => r.sesion), ["b"]);
  // De punta a punta con el aviso de Rust: «a» deja de figurar.
  const { murieron } = s.conConectadas({ a: sesion("a"), b: sesion("b") }, [datos("b")]);
  assert.deepEqual(s.sinReservasDe(lista, murieron).length, 1);
});

test("el efecto de una reserva con conflicto dice quién lo tiene, por qué y hasta cuándo", () => {
  const sesiones = { b: sesion("b", { tarea: "Refactor de docs" }) };
  const c = reserva("b", carpeta("docs"), { motivo: "reordenar", vence: T0 + 20 * MIN });
  const t = s.efectoReserva(reserva("a", nota("docs/Plan.md")), [c], false, sesiones, T0);
  assert.match(t, /^Reservé docs\/Plan\.md \(nota\) por 30 min: «trabajo»\./);
  assert.match(t, /aviso, no un bloqueo/);
  assert.match(t, /docs\/ \(carpeta\) · sesión b «Refactor de docs» · «reordenar» · vence en 20 min/);
  assert.match(t, /coordina con el usuario/);
  const sinConflicto = s.efectoReserva(reserva("a", { clase: "nota", ruta: "N.md", existe: false }), [], true, {}, T0);
  assert.equal(sinConflicto, "Renové N.md (nota, todavía no existe) por 30 min: «trabajo».");
});

// ── Lo que se le cuenta a una sesión ────────────────────────────────────────

const entrada = (extra) => ({
  v: 1,
  id: Math.random().toString(36).slice(2),
  momento: new Date(T0).toISOString(),
  op: "renombrar",
  resultado: "hecho",
  efecto: "…",
  ...extra,
});

test("lo modificado por otras sesiones sale del registro: solo lo que cambia notas, de otras, reciente", () => {
  const entradas = [
    entrada({ sesion: "b", objetivo: { tipo: "nota", ruta: "docs/A.md" } }),
    entrada({ sesion: "a", objetivo: { tipo: "nota", ruta: "docs/Propia.md" } }),
    entrada({ sesion: "b", op: "abrir", objetivo: { tipo: "nota", ruta: "docs/Abierta.md" } }),
    entrada({ sesion: "b", resultado: "fallo", objetivo: { tipo: "nota", ruta: "docs/Fallo.md" } }),
    entrada({ objetivo: { tipo: "nota", ruta: "docs/SinSesion.md" } }),
    entrada({ sesion: "b", op: "mover", objetivo: { tipo: "nota", ruta: "docs/A.md" }, momento: new Date(T0 + 2 * MIN).toISOString() }),
    entrada({ sesion: "b", objetivo: { tipo: "nota", ruta: "Viejo.md" }, momento: new Date(T0 - 40 * MIN).toISOString() }),
  ];
  const m = s.modificadasPorOtras(entradas, "a", T0 + 5 * MIN);
  assert.deepEqual(m.map((x) => [x.ruta, x.op]), [["docs/A.md", "mover"]]);
});

test("coordinación: las otras sesiones, reservas ajenas y propias, lo cambiado por MCP y por fuera", () => {
  const ahora = T0 + 10 * MIN;
  const sesiones = {
    a: sesion("a", { tarea: "Bug DEF-173", inicio: T0 }),
    b: sesion("b", { tarea: "Refactor de docs", inicio: T0 - 30 * MIN, ultimaActividad: ahora - 2 * MIN }),
    c: sesion("c", { inicio: T0 + 5 * MIN }),
  };
  const reservas = [
    reserva("b", carpeta("docs"), { motivo: "reordenar", vence: ahora + 20 * MIN }),
    reserva("a", nota("Bugs.md"), { motivo: "anotar", vence: ahora + 5 * MIN }),
    reserva("c", nota("Vieja.md"), { vence: ahora - 1 }),
  ];
  const entradas = [entrada({ sesion: "b", objetivo: { tipo: "nota", ruta: "docs/A.md" }, momento: new Date(ahora - 3 * MIN).toISOString() })];
  const externos = [{ ruta: "docs/Escrita.md", momento: ahora - MIN, borrada: false }];
  const c = s.coordinacion({ propia: "a", sesiones, reservas, entradas, externos, ahora, nombreOp: act.NOMBRE_OP });
  assert.equal(c.tarea, "Bug DEF-173");
  assert.deepEqual(c.sesiones.map((x) => x.id), ["b", "c"], "las otras, de la más vieja a la más nueva");
  assert.equal(c.sesiones[0].actividad_min, 2);
  assert.equal(c.sesiones[1].actividad_min, null);
  assert.deepEqual(c.reservas_ajenas.map((r) => r.ruta), ["docs"], "sin la vencida");
  assert.deepEqual(c.reservas_propias.map((r) => r.ruta), ["Bugs.md"]);
  assert.equal(c.modificadas[0].ruta, "docs/A.md");
  assert.equal(c.externas[0].ruta, "docs/Escrita.md");
  const t = c.texto;
  assert.match(t, /^Sesiones de IA en este vault: 3 conectadas \(contando esta\)\./);
  assert.match(t, /Esta sesión: a · tarea «Bug DEF-173»\./);
  assert.match(t, /Tus reservas:\n  - Bugs\.md \(nota\) · «anotar» · vence en 5 min/);
  assert.match(t, /  - b · «Refactor de docs» · conectada hace 40 min · última actividad hace 2 min/);
  assert.match(t, /  - c · sin tarea declarada · conectada hace 5 min · todavía no pidió nada/);
  assert.match(t, /Reservado por otras sesiones .*:\n  - docs\/ \(carpeta\) · sesión b «Refactor de docs» · «reordenar» · vence en 20 min/);
  assert.match(t, /Cambiado por otras sesiones a través de Mycelium .*:\n  - docs\/A\.md · Renombrar · hace 3 min · sesión b «Refactor de docs»/);
  assert.match(t, /Cambiado en disco por fuera de Mycelium .*no se sabe quién.*:\n  - docs\/Escrita\.md · hace 1 min/);
});

test("coordinación sola: una línea, y la invitación a declarar la tarea", () => {
  const c = s.coordinacion({ propia: "a", sesiones: { a: sesion("a") }, reservas: [], entradas: [], externos: [], ahora: T0 });
  assert.equal(
    c.texto,
    "Sesiones de IA en este vault: solo esta.\nEsta sesión: a · sin tarea declarada (declárala con mycelium_sesion si vas a trabajar un rato).",
  );
});

test("las listas largas se recortan diciendo cuántas faltan", () => {
  const externos = Array.from({ length: 13 }, (_, i) => ({ ruta: `n${i}.md`, momento: T0 - i * 1000, borrada: i === 0 }));
  const c = s.coordinacion({ propia: null, sesiones: {}, reservas: [], entradas: [], externos, ahora: T0 });
  assert.match(c.texto, /n0\.md \(ya no está\)/);
  assert.match(c.texto, /… y 3 más$/);
  assert.equal(c.externas.length, 13, "los datos van enteros; el recorte es del texto");
});

// ── El registro ─────────────────────────────────────────────────────────────

test("el renglón del registro guarda la sesión y su tarea; los viejos se leen igual", () => {
  const e = act.leerRenglon(JSON.stringify(entrada({ sesion: "a-1", tarea: "Docs" })));
  assert.equal(e.sesion, "a-1");
  assert.equal(e.tarea, "Docs");
  const viejo = act.leerRenglon(JSON.stringify(entrada({})));
  assert.equal(viejo.sesion, undefined);
  assert.equal(act.NOMBRE_OP.reservar, "Reservar");
});

test("el canal está conectado mientras haya sesiones, aunque no hablen", () => {
  const hace20 = T0 - 20 * MIN;
  assert.equal(act.estadoCanal(true, null, hace20, T0), "encendido");
  assert.equal(act.estadoCanal(true, null, hace20, T0, 2), "conectado");
  assert.equal(act.estadoCanal(false, null, hace20, T0, 2), "apagado");
  assert.equal(act.estadoCanal(true, "x", null, T0, 2), "error");
});

test("el registro se agrupa por sesión, en el orden de su entrada más nueva, con la tarea de cada una", () => {
  const vista = act.vistaActividad([
    entrada({ id: "1", sesion: "a", tarea: "Vieja tarea" }),
    entrada({ id: "2" }),
    entrada({ id: "3", sesion: "b" }),
    entrada({ id: "4", sesion: "a", tarea: "Nueva tarea" }),
    entrada({ id: "5", op: "deshacer", ref: "4" }),
  ]);
  const g = s.agruparPorSesion(vista, { b: sesion("b", { tarea: "Docs" }) });
  assert.deepEqual(g.map((x) => x.clave), ["a", "b", "sin-sesion"]);
  assert.deepEqual(g[0].entradas.map((e) => e.id), ["4", "1"]);
  assert.equal(g[0].tarea, "Nueva tarea", "la última que figura, si ya no está conectada");
  assert.equal(g[0].conectada, false);
  assert.equal(g[1].tarea, "Docs", "la de la sesión viva");
  assert.equal(g[1].conectada, true);
  assert.equal(g[2].sesion, null);
  // El Deshacer no se rompe: la entrada sigue sabiendo que se deshizo.
  assert.ok(g[0].entradas[0].deshechaEn);
});
