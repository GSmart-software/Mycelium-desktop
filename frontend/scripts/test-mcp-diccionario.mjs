// Test headless (sin navegador ni Tauri) de la Parte 4 del MCP de control
// (`FUN-L-09`): la lógica de `mycelium_diccionario`
// (`lib/mcpDiccionarioLogica.ts`) —validar argumentos y el tope, qué se acepta
// como palabra (la regla del corrector, `motivoPalabraNoAceptada` en
// `lib/ortografia/palabras.ts`), el efecto contado contra el archivo, el texto,
// y el Deshacer que no pisa lo que cambió después— y el formato del registro
// para las entradas nuevas (`lib/actividadIa.ts`). Los módulos se transpilan en
// el momento, como en `scripts/test-mcp-archivos.mjs`.
//
//   node --test scripts/test-mcp-diccionario.mjs
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

const PALABRAS = await fuente("../lib/ortografia/palabras.ts");
const pal = await import(PALABRAS);
const dic = await import(await fuente("../lib/mcpDiccionarioLogica.ts", { "@/lib/ortografia/palabras": PALABRAS }));
const act = await import(await fuente("../lib/actividadIa.ts"));

// ── Qué es una palabra ──────────────────────────────────────────────────────

test("se acepta lo que el corrector revisaría tal cual", () => {
  for (const p of ["Mycelium", "rizoma", "l'amico", "ÁRBOL", "Ñandú"]) assert.equal(pal.motivoPalabraNoAceptada(p), null, p);
});

test("se rechaza con el motivo: vacía, espacios, signos, dígitos, camelCase, una letra", () => {
  assert.match(pal.motivoPalabraNoAceptada(""), /vacía/);
  assert.match(pal.motivoPalabraNoAceptada("dos palabras"), /espacios/);
  assert.match(pal.motivoPalabraNoAceptada("Wi-Fi"), /«-».*«Wi», «Fi» por separado/);
  assert.match(pal.motivoPalabraNoAceptada("#tag"), /«#»/);
  assert.match(pal.motivoPalabraNoAceptada("v2"), /dígitos/);
  assert.match(pal.motivoPalabraNoAceptada("mi_var"), /dígitos o «_»/);
  assert.match(pal.motivoPalabraNoAceptada("JavaScript"), /camelCase/);
  assert.match(pal.motivoPalabraNoAceptada("x"), /una sola letra/);
});

test("la regla coincide con lo que el corrector extrae", () => {
  // Lo aceptado es exactamente una palabra de `extraerPalabras`.
  for (const p of ["Mycelium", "l'amico", "Wi-Fi", "v2", "JavaScript", "x", "a b"]) {
    const extraidas = pal.extraerPalabras(p).map((w) => w.texto);
    const acepta = pal.motivoPalabraNoAceptada(p) === null;
    assert.equal(acepta, extraidas.length === 1 && extraidas[0] === p, p);
  }
});

test("entradaParecida: la misma palabra salvo tildes o mayúsculas", () => {
  assert.equal(pal.entradaParecida(["Mycelium", "rizoma"], "mycelium"), "Mycelium");
  assert.equal(pal.entradaParecida(["árbol"], "arbol"), "árbol");
  assert.equal(pal.entradaParecida(["rizoma"], "otra"), null);
});

// ── Argumentos ──────────────────────────────────────────────────────────────

test("validar: listar por defecto, acciones, lista, tope y campos desconocidos", () => {
  assert.deepEqual(dic.validarDiccionario({}), { ok: true, valor: { accion: "listar" } });
  assert.deepEqual(dic.validarDiccionario({ accion: "agregar", palabras: [" Mycelium ", "Mycelium", "l’amico"] }), {
    ok: true,
    valor: { accion: "agregar", palabras: ["Mycelium", "l'amico"] },
  });
  const malo = (args, campo) => {
    const r = dic.validarDiccionario(args);
    assert.equal(r.ok, false, JSON.stringify(args));
    assert.equal(r.error.codigo, "INVALIDO");
    assert.equal(r.error.datos.campo, campo);
    return r.error.mensaje;
  };
  malo({ accion: "borrar" }, "accion");
  malo({ accion: "agregar" }, "palabras");
  malo({ accion: "quitar", palabras: [] }, "palabras");
  malo({ accion: "agregar", palabras: "Mycelium" }, "palabras");
  malo({ accion: "agregar", palabras: ["ok", 3] }, "palabras");
  malo({ accion: "agregar", palabra: ["x"] }, "palabra");
  const muchas = Array.from({ length: dic.TOPE_POR_LLAMADA + 1 }, (_, i) => `p${i}`);
  assert.match(malo({ accion: "agregar", palabras: muchas }, "palabras"), /tope es 200/);
  assert.equal(dic.validarDiccionario({ accion: "agregar", palabras: muchas.slice(1) }).ok, true);
});

// ── El efecto ───────────────────────────────────────────────────────────────

test("agregar: agregadas, las que ya estaban y las rechazadas, contra el archivo", () => {
  const { aceptadas, rechazadas } = dic.separarAceptadas(["Mycelium", "rizoma", "Wi-Fi", ""]);
  assert.deepEqual(aceptadas, ["Mycelium", "rizoma"]);
  assert.deepEqual(rechazadas.map((r) => r.palabra), ["Wi-Fi", ""]);
  const antes = ["rizoma"];
  const despues = ["Mycelium", "rizoma"];
  const e = dic.efectoAgregar(aceptadas, rechazadas, antes, despues);
  assert.deepEqual(e.agregadas, ["Mycelium"]);
  assert.deepEqual(e.ya_estaban, ["rizoma"]);
  assert.equal(e.total, 2);
  const t = dic.textoAgregar(e);
  assert.match(t, /^Agregué 1 palabra al diccionario del vault: «Mycelium»\./);
  assert.match(t, /Ya estaban: «rizoma»\./);
  assert.match(t, /Rechacé «Wi-Fi» y «»\./);
  assert.match(t, /Ahora tiene 2 palabras\.$/);
});

test("quitar: las quitadas y las que no estaban, con la parecida", () => {
  const { aceptadas, rechazadas } = dic.separarParaQuitar(["mycelium", "rizoma", "Wi-Fi"]);
  // Al quitar, una entrada rara escrita a mano se puede limpiar: no se rechaza.
  assert.deepEqual(aceptadas, ["mycelium", "rizoma", "Wi-Fi"]);
  assert.deepEqual(rechazadas, []);
  const antes = ["Mycelium", "rizoma", "Wi-Fi"];
  const e = dic.efectoQuitar(aceptadas, rechazadas, antes, ["Mycelium"]);
  assert.deepEqual(e.quitadas, ["rizoma", "Wi-Fi"]);
  assert.deepEqual(e.no_estaban, [{ palabra: "mycelium", parecida: "Mycelium" }]);
  assert.match(dic.textoQuitar(e), /^Quité 2 palabras del diccionario del vault: «rizoma» y «Wi-Fi»\. No estaban: «mycelium»\./);
});

test("el texto resume las listas largas", () => {
  const muchas = Array.from({ length: 12 }, (_, i) => `palabra${"abcdefghijkl"[i]}`);
  const t = dic.textoAgregar({ agregadas: muchas, ya_estaban: [], rechazadas: [], total: 12 });
  assert.match(t, /y 4 más\./);
});

test("listar: con tope y el total", () => {
  const todas = Array.from({ length: 7 }, (_, i) => `w${i}`);
  assert.deepEqual(dic.listado(todas, 5), { palabras: todas.slice(0, 5), total: 7, recortado: true });
  assert.deepEqual(dic.listado(todas), { palabras: todas, total: 7, recortado: false });
});

// ── Deshacer ────────────────────────────────────────────────────────────────

test("deshacer un agregar quita esas mismas, salvo que alguna ya no esté", () => {
  const d = { tipo: "diccionario_quitar", palabras: ["Mycelium", "hifa"] };
  assert.deepEqual(dic.puedeDeshacerDiccionario(new Set(["Mycelium", "hifa", "otra"]), d), { ok: true });
  assert.deepEqual(dic.aplicarDeshacer(["Mycelium", "hifa", "otra"], d), ["otra"]);
  const no = dic.puedeDeshacerDiccionario(new Set(["Mycelium", "otra"]), d);
  assert.equal(no.ok, false);
  assert.match(no.porque, /^cambió después: «hifa» ya no está/);
  assert.match(dic.describirDeshacerDiccionario(d), /quitar del diccionario del vault «Mycelium» y «hifa»/);
});

test("deshacer un quitar las vuelve a agregar, salvo que alguna ya haya vuelto", () => {
  const d = { tipo: "diccionario_agregar", palabras: ["rizoma"] };
  assert.deepEqual(dic.puedeDeshacerDiccionario(new Set(["otra"]), d), { ok: true });
  assert.deepEqual(dic.aplicarDeshacer(["otra"], d), ["otra", "rizoma"]);
  const no = dic.puedeDeshacerDiccionario(new Set(["rizoma"]), d);
  assert.match(no.porque, /volvió al diccionario/);
  assert.match(dic.textoDeshacer(d), /^Volvió al diccionario del vault «rizoma»\./);
});

// ── El registro ─────────────────────────────────────────────────────────────

test("el registro lee y nombra las entradas del diccionario", () => {
  const e = act.nuevaEntrada({
    op: "diccionario",
    resultado: "hecho",
    efecto: "Agregué 1 palabra…",
    deshacer: { tipo: "diccionario_quitar", palabras: ["Mycelium"] },
  });
  const leida = act.leerRenglon(JSON.stringify(e));
  assert.deepEqual(leida.deshacer, { tipo: "diccionario_quitar", palabras: ["Mycelium"] });
  assert.equal(act.NOMBRE_OP.diccionario, "Diccionario del vault");
  // Un deshacer roto (sin palabras) se descarta, la entrada queda.
  const rota = act.leerRenglon(JSON.stringify({ ...e, deshacer: { tipo: "diccionario_agregar", palabras: [] } }));
  assert.equal(rota.deshacer, undefined);
  assert.equal(act.seRegistra("diccionario", "hecho"), true);
});
