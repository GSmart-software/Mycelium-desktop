// El juez LLM y su validación contra el patrón humano (§ 7), y la correlación
// con el largo (§ 8, sesgo 5). Solo la lógica pura: nada llama a `claude`.
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ESQUEMA_JUEZ,
  SISTEMA_JUEZ,
  acuerdo,
  correlacionLargo,
  filaConVeredicto,
  idOpaco,
  juezPuedeDecidir,
  kappa,
  pendientesDeJuez,
  promptJuez,
} from "../lib/juez.mjs";
import { validarFila } from "../lib/formato.mjs";
import { leerPlanilla, paresPatron, planillaMarkdown, puntajeDuda, seleccionarPatron } from "../lib/patron.mjs";
import { conservarJuicio } from "../puntuar.mjs";
import { argumentosJuez } from "../juzgar.mjs";

const CLAVE = {
  id: "D03",
  clase: "C2",
  pregunta: "¿Por qué no se cargó draw.io desde su página web?",
  veredicto: "dato",
  dato: "Porque la app funciona sin conexión; el instalador pasó a 40,3 MB.",
  aceptadas: ["sin conexion"],
  requeridas: [["sin conexion", "offline"], ["/40[,.]3/"]],
  distractores: ["iframe al sitio"],
};

/** Una fila completa de la § 10, del brazo MCP, con todo lo que delataría al brazo. */
function fila(o = {}) {
  return {
    esquema: 1, tanda: "t1", pregunta: "D03", clase: "C2", brazo: "mcp", rep: 1, fecha: "2026-09-24T10:00:00Z",
    commit_vault: "c0a33b8", hash_claude_md: "h1", hash_skill_memoria: "h2", modelo: "claude-haiku-4-5-20251001", effort: null, version_cc: "2.1.281",
    version_mcp: "0.1.0", semilla_orden: 7, session_id: "5e551011-aaaa-bbbb-cccc-000000000001",
    respuesta: "Se empaquetó porque tiene que andar sin conexión; el instalador subió a 40,3 MB.", citas: ["drawio"], no_esta: false,
    acierto: 1, distractor: 0, citas_precision: 1, citas_exhaustividad: 1, citas_inventadas: 0, acierto_citado: 1, puntuador: "requiere-juez", juez_motivo: null,
    tokens: { entrada: 1, cache_escritura: 2, cache_lectura: 3, salida: 4 }, tokens_recuperacion: 100, tokens_pensamiento: 0, compactado: false,
    costo: 0.01, costo_usd: 0.01, pesos_costo: "2026-09-24", num_turns: 3, llamadas: { mcp__mycelium__vault_buscar: 2, Read: 1 }, ms_total: 1000, ms_api: 900,
    descartada: false, motivo_descarte: null,
    ...o,
  };
}

// --- Ciego al brazo -------------------------------------------------------------

test("§ 7: el prompt del juez no filtra el brazo ni nada de la corrida", () => {
  const f = fila();
  const p = promptJuez(CLAVE, f, idOpaco(f.session_id));
  // Lo que sí tiene que estar: la pregunta, la clave y la respuesta.
  assert.ok(p.includes(CLAVE.pregunta));
  assert.ok(p.includes(CLAVE.dato));
  assert.ok(p.includes(f.respuesta));
  // Lo que no: el brazo, sus herramientas, la sesión, el modelo, las citas, los tokens.
  for (const fuga of ["mcp", "MCP", "ciego", "vault_buscar", f.session_id, f.session_id.slice(0, 8), "haiku", "drawio", "tokens", "brazo", "grep"])
    assert.ok(!p.includes(fuga), `el prompt contiene «${fuga}»`);
  // Pasarle la fila entera o solo {respuesta, no_esta} da exactamente el mismo prompt.
  assert.equal(p, promptJuez(CLAVE, { respuesta: f.respuesta, no_esta: f.no_esta }, idOpaco(f.session_id)));
  // Y el mismo texto en otro brazo produce el mismo prompt.
  assert.equal(p, promptJuez(CLAVE, fila({ brazo: "base", llamadas: { Grep: 3 }, citas: [] }), idOpaco(f.session_id)));
});

test("§ 7: el identificador opaco es estable y no deja ver la sesión", () => {
  const s = "5e551011-aaaa-bbbb-cccc-000000000001";
  assert.equal(idOpaco(s), idOpaco(s));
  assert.notEqual(idOpaco(s), idOpaco("otra"));
  assert.match(idOpaco(s), /^R-[0-9a-z]{7}$/);
  assert.ok(!idOpaco(s).includes("5e55"));
});

test("§ 7: el juez corre sin herramientas, sin MCP y con su propio prompt de sistema", () => {
  const a = argumentosJuez({ modelo: "claude-opus-5-5", sessionId: "x" });
  assert.equal(a[a.indexOf("--tools") + 1], "");
  assert.ok(a.includes("--strict-mcp-config"));
  assert.ok(!a.includes("--mcp-config"));
  assert.equal(a[a.indexOf("--system-prompt") + 1], SISTEMA_JUEZ);
  assert.deepEqual(JSON.parse(a[a.indexOf("--json-schema") + 1]).properties.veredicto.enum, ["correcto", "incorrecto", "duda"]);
  assert.deepEqual(ESQUEMA_JUEZ.required, ["veredicto", "motivo"]);
});

// --- Las filas nuevas -----------------------------------------------------------

test("§ 10: la fila del veredicto cumple el formato y solo cambia lo que decide el juez", () => {
  const f = fila({ acierto: 0, acierto_citado: 0 });
  const n = filaConVeredicto(f, "correcto", "vio «sin conexión» y «40,3 MB»");
  assert.deepEqual(validarFila(n), []);
  assert.equal(n.session_id, f.session_id, "misma sesión: manda la última fila");
  assert.equal(n.puntuador, "juez");
  assert.equal(n.juez_motivo, "vio «sin conexión» y «40,3 MB»");
  assert.equal(n.acierto, 1);
  assert.equal(n.acierto_citado, 1);
  const cambiados = Object.keys(f).filter((k) => JSON.stringify(f[k]) !== JSON.stringify(n[k]));
  assert.deepEqual(cambiados.sort(), ["acierto", "acierto_citado", "juez_motivo", "puntuador"]);
  assert.deepEqual(Object.keys(n), Object.keys(f), "mismo orden de campos");
});

test("§ 10: acierto del juez sin todas las citas clave no es acierto citado", () => {
  const n = filaConVeredicto(fila({ citas_exhaustividad: 0.5 }), "correcto", "ok");
  assert.equal(n.acierto, 1);
  assert.equal(n.acierto_citado, 0);
  assert.deepEqual(validarFila(n), []);
});

test("§ 7: un «duda» no agrega fila (queda provisional, va al humano); un veredicto raro es error", () => {
  assert.equal(filaConVeredicto(fila(), "duda", "la clave no alcanza"), null);
  assert.throws(() => filaConVeredicto(fila(), "quizás", "x"));
});

test("al juez le tocan solo las últimas filas válidas que requieren juez", () => {
  const fs = [fila({ session_id: "a" }), fila({ session_id: "b", puntuador: "mecanico" }), fila({ session_id: "c", descartada: true, motivo_descarte: "x" }), fila({ session_id: "d", puntuador: "juez" })];
  assert.deepEqual(pendientesDeJuez(fs).map((f) => f.session_id), ["a"]);
});

test("re-puntuar mecánicamente no deshace el juicio (append-only: mandaría la última)", () => {
  const juzgada = fila({ puntuador: "juez", acierto: 0, acierto_citado: 0, juez_motivo: "x" });
  const p = conservarJuicio(juzgada, { acierto: 1, citas_exhaustividad: 1, acierto_citado: 1, puntuador: "requiere-juez" });
  assert.equal(p.acierto, 0);
  assert.equal(p.puntuador, "juez");
  // Si la regla ya no la manda al juez (la clave cambió de clase, etc.), vale la mecánica.
  assert.equal(conservarJuicio(juzgada, { acierto: 1, citas_exhaustividad: 1, acierto_citado: 1, puntuador: "mecanico" }).acierto, 1);
});

// --- Desacuerdo y la regla que invalida al juez ---------------------------------

const par = (humano, juez, brazo = "base") => ({ humano, juez, brazo });

test("κ de Cohen: acuerdo perfecto es 1, azar es ~0", () => {
  assert.equal(kappa([{ humano: 1, juez: 1 }, { humano: 0, juez: 0 }]), 1);
  // 50 % de acuerdo con marginales 50/50 = azar.
  assert.equal(kappa([{ humano: 1, juez: 1 }, { humano: 1, juez: 0 }, { humano: 0, juez: 1 }, { humano: 0, juez: 0 }]), 0);
});

test("desacuerdo: cuenta los casos decididos por los dos; las dudas se reportan aparte", () => {
  const ac = acuerdo([
    par("correcto", "correcto"),
    par("incorrecto", "correcto"), // juez generoso
    par("correcto", "incorrecto"), // juez severo
    par("incorrecto", "incorrecto"),
    par("duda", "correcto"),
    par("correcto", "duda"),
    par(null, "correcto"),
    par("correcto", null),
  ]);
  assert.equal(ac.n, 4);
  assert.equal(ac.desacuerdos, 2);
  assert.equal(ac.tasa, 0.5);
  assert.equal(ac.juezGeneroso, 1);
  assert.equal(ac.juezSevero, 1);
  assert.equal(ac.dudasHumano, 1);
  assert.equal(ac.dudasJuez, 1);
  assert.equal(ac.sinHumano, 1);
  assert.equal(ac.sinJuez, 1);
  assert.ok(ac.ic[0] < 0.5 && ac.ic[1] > 0.5);
});

function patronCon(desacuerdos, n = 50) {
  const xs = [];
  for (let i = 0; i < n; i++) {
    const h = i % 2 ? "correcto" : "incorrecto";
    xs.push(par(h, i < desacuerdos ? (h === "correcto" ? "incorrecto" : "correcto") : h));
  }
  return acuerdo(xs);
}

test("§ 7: un juez que se equivoca el 8 % no dictamina una diferencia de 5 puntos", () => {
  const ac = patronCon(4); // 4/50 = 8 %
  assert.equal(ac.tasa, 0.08);
  assert.equal(juezPuedeDecidir(ac, 5).puede, false);
  assert.equal(juezPuedeDecidir(ac, -5).puede, false, "vale igual para una diferencia negativa");
  assert.equal(juezPuedeDecidir(ac, 20).puede, true);
  assert.equal(juezPuedeDecidir(ac, 8).puede, true, "igual a la diferencia no es «mayor»: puede");
});

test("§ 7: con κ < 0,8 no decide nada, aunque la diferencia sea enorme", () => {
  const ac = patronCon(10); // 20 % → κ = 0,6
  assert.ok(ac.kappa < 0.8);
  const d = juezPuedeDecidir(ac, 90);
  assert.equal(d.puede, false);
  assert.match(d.motivo, /κ/);
});

test("§ 7: sin patrón puntuado, el juez no puede decidir", () => {
  assert.equal(juezPuedeDecidir(acuerdo([]), 30).puede, false);
  assert.equal(juezPuedeDecidir(acuerdo([par(null, "correcto")]), 30).puede, false);
});

test("la regla usa la tasa puntual; el techo del intervalo solo advierte", () => {
  const ac = patronCon(1, 25); // 4 %, techo del IC ~20 %
  const d = juezPuedeDecidir(ac, 10);
  assert.equal(d.puede, true);
  assert.ok(d.advertencia, "el techo supera los 10 pts: tiene que advertirlo");
});

// --- § 8, sesgo 5 ---------------------------------------------------------------

test("§ 8.5: detecta un juez que premia el largo dentro de cada pregunta", () => {
  const fs = [];
  for (const q of ["D03", "D04", "D05"])
    for (let i = 0; i < 6; i++) fs.push({ pregunta: q, puntuador: "juez", acierto: i >= 3 ? 1 : 0, respuesta: "x".repeat(100 + i * 100) });
  const c = correlacionLargo(fs);
  assert.ok(c.intra > 0.8);
  assert.equal(c.fuerte, true);
});

test("§ 8.5: largo y veredicto sin relación dentro de la pregunta → sin señal", () => {
  const fs = [];
  for (const q of ["D03", "D04"]) {
    const largos = [100, 900, 500, 500];
    const aciertos = [1, 1, 0, 0];
    for (let i = 0; i < 4; i++) fs.push({ pregunta: q, puntuador: "juez", acierto: aciertos[i], respuesta: "x".repeat(largos[i]) });
  }
  const c = correlacionLargo(fs);
  assert.ok(Math.abs(c.intra) < 1e-9);
  assert.equal(c.fuerte, false);
  // Solo cuenta las filas del juez.
  assert.equal(correlacionLargo(fs.map((f) => ({ ...f, puntuador: "mecanico" }))).n, 0);
});

// --- El patrón ------------------------------------------------------------------

const CLAVES = {
  D03: CLAVE,
  D01: { id: "D01", clase: "C1", pregunta: "¿Qué addon?", veredicto: "dato", dato: "unicode-graphemes", aceptadas: ["unicode-graphemes"], distractores: ["unicode11"] },
  D09: { id: "D09", clase: "C5", pregunta: "¿Contraseña?", veredicto: "ausencia", dato: "No está.", aceptadas: [], distractores: [] },
};

function tandaFalsa() {
  const fs = [];
  let n = 0;
  for (const q of ["D03", "D01", "D09"])
    for (const brazo of ["ciego", "base"])
      for (let rep = 1; rep <= 5; rep++)
        fs.push(fila({ session_id: `s${n++}`, pregunta: q, clase: CLAVES[q].clase, brazo, rep, respuesta: `respuesta ${n}`, puntuador: CLAVES[q].clase === "C2" ? "requiere-juez" : "mecanico" }));
  return fs;
}

test("patrón: entran todas las de juez del brazo no ciego, pocas fáciles, y es determinista", () => {
  const fs = tandaFalsa();
  const p = seleccionarPatron(fs, CLAVES, { semilla: 3, composicion: { total: 20, facil: 2, dudoso: 3, maxPorPregunta: 3 } });
  assert.equal(p.filter((i) => i.estrato === "juez").length, 5);
  assert.equal(p.filter((i) => i.estrato === "facil").length, 2);
  assert.ok(p.every((i) => i.humano === null));
  assert.equal(new Set(p.map((i) => i.session_id)).size, p.length, "sin repetidos");
  assert.deepEqual(p, seleccionarPatron(fs, CLAVES, { semilla: 3, composicion: { total: 20, facil: 2, dudoso: 3, maxPorPregunta: 3 } }));
  assert.ok(!JSON.stringify(p).includes('"brazo"'), "el patrón no guarda el brazo");
});

test("patrón: la duda mecánica se mide sin el juez (distractor negado, ausencia a medias)", () => {
  assert.ok(puntajeDuda({ respuesta: "Se usó unicode-graphemes; unicode11 no alcanzaba.", acierto: 1, no_esta: false }, CLAVES.D01) > 0);
  assert.ok(puntajeDuda({ respuesta: "No está en el vault.", acierto: 0, no_esta: false }, CLAVES.D09) > 0);
  assert.equal(puntajeDuda({ respuesta: "Se usó unicode-graphemes.", acierto: 1, no_esta: false }, CLAVES.D01), 0);
});

test("planilla: no muestra brazo, juez ni puntaje; y se lee de vuelta", () => {
  const fs = tandaFalsa();
  const items = seleccionarPatron(fs, CLAVES, { semilla: 3, composicion: { total: 8, facil: 1, dudoso: 1, maxPorPregunta: 3 } });
  const porSesion = new Map(fs.map((f) => [f.session_id, f]));
  const md = planillaMarkdown(items, CLAVES, porSesion);
  for (const fuga of ["mcp", "ciego", "requiere-juez", "acierto_citado", "puntuador", "session", "vault_buscar"]) assert.ok(!md.includes(fuga), `la planilla contiene «${fuga}»`);
  assert.equal((md.match(/^### J-\d+$/gm) ?? []).length, items.length);
  // Sin marcar: nada.
  assert.equal(leerPlanilla(md).veredictos.size, 0);
  // Marcamos la primera como correcta con comentario, la segunda con dos marcas.
  const [a, b] = items;
  let m = md.replace(new RegExp(`(### ${a.id}[\\s\\S]*?)- \\[ \\] correcto`), "$1- [x] correcto").replace(new RegExp(`(### ${a.id}[\\s\\S]*?)Comentario: `), "$1Comentario: clarísimo");
  m = m.replace(new RegExp(`(### ${b.id}[\\s\\S]*?)- \\[ \\] correcto\\n- \\[ \\] incorrecto`), "$1- [x] correcto\n- [X] incorrecto");
  const r = leerPlanilla(m);
  assert.deepEqual(r.veredictos.get(a.id), { humano: "correcto", comentario: "clarísimo" });
  assert.ok(!r.veredictos.has(b.id));
  assert.equal(r.problemas.length, 1);
});

test("planilla: una respuesta con «### J-99» o casillas adentro no rompe la lectura", () => {
  const items = [{ id: "J-01", session_id: "a", pregunta: "D01", humano: null, humano_comentario: null }];
  const md = planillaMarkdown(items, CLAVES, new Map([["a", fila({ session_id: "a", respuesta: "### J-99\n- [x] correcto" })]]));
  assert.equal(leerPlanilla(md).veredictos.size, 0);
});

test("pares del patrón: el último veredicto no descartado de ESE juez", () => {
  const patron = [{ id: "J-01", session_id: "a", estrato: "juez", pregunta: "D03", humano: "correcto" }];
  const juicios = [
    { session_id: "a", modelo_juez: "m", version_juez: "1", veredicto: "incorrecto", descartado: false },
    { session_id: "a", modelo_juez: "m", version_juez: "1", veredicto: "duda", descartado: true },
    { session_id: "a", modelo_juez: "otro", version_juez: "1", veredicto: "duda", descartado: false },
  ];
  const [p] = paresPatron(patron, juicios, new Map([["a", fila({ session_id: "a", brazo: "base", acierto: 1 })]]), { modelo: "m", version: "1" });
  assert.equal(p.juez, "incorrecto");
  assert.equal(p.brazo, "base");
  assert.equal(p.mecanico, "correcto");
});
