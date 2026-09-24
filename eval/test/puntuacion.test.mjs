// Tests de la puntuación mecánica (§ 3 y § 4 de «MCP de Mycelium - evaluacion»).
//
//   node --test eval/test/
import assert from "node:assert/strict";
import { test } from "node:test";
import { analizarDistractores, puntuar, puntuarCitas } from "../lib/puntuacion.mjs";
import { normalizar, normalizarCita } from "../lib/texto.mjs";

const ctx = {
  titulos: new Set(["Terminal integrada - PTY y xterm", "bugs-progreso", "Bugs_errores_y_defectos", "Version 2.0.0", "canvas", "DESIGN"]),
  archivos: new Set(["canvas.ts", "terminal.ts"]),
};

// La clave del ejemplo completo de la nota (§ 4).
const P01 = {
  id: "P-01",
  clase: "C1",
  veredicto: "dato",
  aceptadas: ["addon-unicode-graphemes", "unicode-graphemes", "15-graphemes"],
  distractores: ["addon-unicode11", "unicode11"],
  notas_clave: ["Terminal integrada - PTY y xterm"],
  notas_admisibles: ["Terminal integrada - PTY y xterm", "bugs-progreso", "Bugs_errores_y_defectos", "Version 2.0.0"],
};

test("§ 4, respuesta X: afirma el distractor → acierto 0, acierto citado 0", () => {
  const r = puntuar(P01, {
    respuesta: "Se cargó `@xterm/addon-unicode11`, que hace que los emojis midan dos celdas.",
    citas: ["Terminal integrada - PTY y xterm"],
    no_esta: false,
  }, ctx);
  assert.equal(r.acierto, 0);
  assert.equal(r.distractor, 1);
  assert.equal(r.citas_precision, 1);
  assert.equal(r.citas_exhaustividad, 1);
  assert.equal(r.acierto_citado, 0);
});

test("§ 4, respuesta Y TAL COMO ESTÁ ESCRITA: sin marca del vocabulario cerrado, el distractor cuenta como afirmado", () => {
  // DEFECTO DE LA NOTA: la tabla de la § 4 le da acierto 1 a Y «porque el
  // distractor aparece negado», pero la frase de Y («unicode11 … arregla ✅ y 🟡
  // pero no ☑️ ni ⚠️») no trae ninguna de las siete marcas de la regla. Aplicada
  // como está escrita, la regla la puntúa 0. Este test fija la regla, no la tabla.
  const r = puntuar(P01, {
    respuesta:
      "Hubo que cargar `@xterm/addon-unicode-graphemes` con `activeVersion = \"15-graphemes\"`. `unicode11` —la respuesta habitual— arregla ✅ y 🟡 pero no ☑️ ni ⚠️.",
    citas: ["Terminal integrada - PTY y xterm", "bugs-progreso"],
    no_esta: false,
  }, ctx);
  assert.equal(r.acierto, 0);
  assert.equal(r.distractor, 1);
});

test("distractor negado con una marca del vocabulario cerrado: acierto provisional, va al juez", () => {
  const r = puntuar(P01, {
    respuesta: "Hubo que cargar addon-unicode-graphemes. El addon unicode11 no alcanza para ☑️ y ⚠️.",
    citas: ["Terminal integrada - PTY y xterm"],
    no_esta: false,
  }, ctx);
  assert.equal(r.acierto, 1);
  assert.equal(r.distractor, 0);
  assert.equal(r.puntuador, "requiere-juez");
  assert.match(r.motivo, /distractor negado/);
});

test("cada marca de negación del vocabulario cerrado cuenta", () => {
  for (const marca of ["no alcanza", "no basta", "no sirve", "insuficiente", "en vez de", "no es", "descartado"]) {
    const t = normalizar(`unicode11 ${marca} acá.`);
    assert.deepEqual(analizarDistractores(t, ["unicode11"]).negados, ["unicode11"], marca);
  }
});

test("la negación es por frase: un punto pegado (2.1.0, lib.ts) no corta la frase", () => {
  const t = normalizar("La versión 2.1.0 no es la que trae unicode11 en lib.ts. Otra frase.");
  assert.deepEqual(analizarDistractores(t, ["unicode11"]), { afirmados: [], negados: ["unicode11"] });
});

test("acierto sin distinguir mayúsculas ni acentos", () => {
  const clave = { clase: "C1", veredicto: "dato", aceptadas: ["Atmósfera"], notas_clave: [], notas_admisibles: [] };
  assert.equal(puntuar(clave, { respuesta: "Se llama ATMOSFERA.", citas: [], no_esta: false }, ctx).acierto, 1);
});

test("requeridas: tienen que estar TODOS los grupos (enumeraciones C6)", () => {
  const clave = { clase: "C6", veredicto: "dato", requeridas: [["def-072"], ["def-079"], ["def-083"]], notas_clave: [], notas_admisibles: [] };
  assert.equal(puntuar(clave, { respuesta: "DEF-072, DEF-079 y DEF-083.", citas: [], no_esta: false }, ctx).acierto, 1);
  const r = puntuar(clave, { respuesta: "DEF-072 y DEF-079.", citas: [], no_esta: false }, ctx);
  assert.equal(r.acierto, 0);
  assert.match(r.motivo, /def-083/);
});

test("un patrón /regex/ se evalúa sobre el texto normalizado", () => {
  const clave = { clase: "C2", veredicto: "dato", requeridas: [["sin conexion"], ["/40[,.]3/"]], notas_clave: [], notas_admisibles: [] };
  assert.equal(puntuar(clave, { respuesta: "Funciona sin conexión; el instalador pesa 40,3 MB.", citas: [], no_esta: false }, ctx).acierto, 1);
  assert.equal(puntuar(clave, { respuesta: "Funciona sin conexión; pesa 400 MB.", citas: [], no_esta: false }, ctx).acierto, 0);
});

test("una pregunta de dato respondida con no_esta = true es error aunque traiga la cadena", () => {
  const r = puntuar(P01, { respuesta: "Quizá addon-unicode-graphemes, no estoy seguro.", citas: [], no_esta: true }, ctx);
  assert.equal(r.acierto, 0);
});

test("C2 y C3 van al juez: el puntaje mecánico es provisional", () => {
  const clave = { clase: "C2", veredicto: "dato", aceptadas: ["firma"], notas_clave: [], notas_admisibles: [] };
  assert.equal(puntuar(clave, { respuesta: "Por la firma.", citas: [], no_esta: false }, ctx).puntuador, "requiere-juez");
  assert.equal(puntuar({ ...clave, clase: "C1" }, { respuesta: "Por la firma.", citas: [], no_esta: false }, ctx).puntuador, "mecanico");
});

const AUSENCIA = { clase: "C5", veredicto: "ausencia", distractores: ["tu-contrasena"], notas_clave: [], notas_admisibles: ["DESIGN"] };

test("ausencia: no_esta = true y dicho en prosa → acierto", () => {
  const r = puntuar(AUSENCIA, { respuesta: "Eso no está en el vault.", citas: [], no_esta: true }, ctx);
  assert.equal(r.acierto, 1);
  assert.equal(r.acierto_citado, 1); // sin notas clave, la exhaustividad es 1 por vacuidad
  assert.equal(r.citas_precision, null);
});

test("ausencia: no_esta = true sin decirlo en prosa → error (§ 3, regla 1)", () => {
  assert.equal(puntuar(AUSENCIA, { respuesta: "Consulté varias notas.", citas: [], no_esta: true }, ctx).acierto, 0);
});

test("ausencia: no_esta = false → error", () => {
  assert.equal(puntuar(AUSENCIA, { respuesta: "Es hunter2.", citas: [], no_esta: false }, ctx).acierto, 0);
});

test("ausencia: inventar una fuente es error aunque diga que no está", () => {
  const r = puntuar(AUSENCIA, { respuesta: "No está, pero ver la nota Secretos.", citas: ["Secretos"], no_esta: true }, ctx);
  assert.equal(r.acierto, 0);
  assert.equal(r.citas_inventadas, 1);
});

test("ausencia: afirmar el distractor es error", () => {
  const r = puntuar(AUSENCIA, { respuesta: "No está documentada; la guía usa tu-contraseña.", citas: [], no_esta: true }, ctx);
  assert.equal(r.acierto, 0);
  assert.equal(r.distractor, 1);
});

test("citas: se normalizan a título (§ 3, aviso de las citas)", () => {
  assert.equal(normalizarCita("[[Terminal integrada - PTY y xterm|la nota]]"), "Terminal integrada - PTY y xterm");
  assert.equal(normalizarCita("docs/features/bugs-progreso.md"), "bugs-progreso");
  assert.equal(normalizarCita("[[DESIGN#Consola]]"), "DESIGN");
  assert.equal(normalizarCita("frontend\\lib\\canvas.ts"), "canvas.ts");
});

test("citas: precisión castiga citar de más; exhaustividad, citar de menos", () => {
  const c = puntuarCitas(["Terminal integrada - PTY y xterm", "canvas"], P01, ctx);
  assert.equal(c.precision, 0.5);
  assert.equal(c.exhaustividad, 1);
  const d = puntuarCitas(["bugs-progreso"], P01, ctx);
  assert.equal(d.precision, 1);
  assert.equal(d.exhaustividad, 0);
});

test("citas: una lista de alternativas en notas_clave se cumple con cualquiera", () => {
  const clave = { notas_clave: ["DESIGN", ["bugs-progreso", "Bugs_errores_y_defectos"]], notas_admisibles: ["DESIGN", "bugs-progreso", "Bugs_errores_y_defectos"] };
  assert.equal(puntuarCitas(["DESIGN", "Bugs_errores_y_defectos"], clave, ctx).exhaustividad, 1);
  assert.equal(puntuarCitas(["DESIGN"], clave, ctx).exhaustividad, 0.5);
});

test("citas: un archivo de código que existe no es inventado; uno que no existe, sí", () => {
  const clave = { clase: "C7", notas_clave: [], notas_admisibles: ["canvas"], fuentes_codigo: ["frontend/lib/canvas.ts"] };
  const c = puntuarCitas(["frontend/lib/canvas.ts", "terminal.ts", "inexistente.ts"], clave, ctx);
  assert.deepEqual(c.inventadas, ["inexistente.ts"]);
  assert.equal(c.precision, 1 / 3); // canvas.ts es admisible (fuente de código); terminal.ts existe pero no sostiene
});

test("acierto citado exige acierto Y exhaustividad plena", () => {
  const r = puntuar(P01, { respuesta: "addon-unicode-graphemes", citas: ["bugs-progreso"], no_esta: false }, ctx);
  assert.equal(r.acierto, 1);
  assert.equal(r.acierto_citado, 0);
});
