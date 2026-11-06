// Test del modo pistas (`FUN-XL-04`, Parte 5): las etiquetas (únicas, del mismo
// largo, sin que una sea el comienzo de otra), el orden por posición, cómo se
// escribe una etiqueta letra a letra, qué se hace con cada tipo de elemento y
// que el comando `pistas.mostrar` tenga F10, en captura, sin tecla reservada.
//
// Los módulos se transpilan en el momento, como en `scripts/test-comandos.mjs`.
//
//   node --test scripts/test-pistas.mjs
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import ts from "typescript";

const aUrl = (codigo) => `data:text/javascript,${encodeURIComponent(codigo)}`;

const FALSO = `
const falso = new Proxy(function () {}, {
  get: (_, k) => (k === Symbol.toPrimitive ? () => "falso" : k === "then" ? undefined : falso),
  apply: () => falso,
  construct: () => falso,
});`;

function moduloFalso(nombres) {
  const lineas = [FALSO];
  for (const n of nombres) lineas.push(n === "default" ? "export default falso;" : `export const ${n} = falso;`);
  return aUrl(lineas.join("\n"));
}

async function fuente(ruta, mapa = {}, { falsos = false } = {}) {
  const texto = await readFile(fileURLToPath(new URL(ruta, import.meta.url)), "utf8");
  let { outputText } = ts.transpileModule(texto, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  });
  outputText = outputText.replace(/import\s*\{([^}]*)\}\s*from\s*"([^"]+)";/g, (todo, lista, esp) => {
    if (mapa[esp]) return `import {${lista}} from "${mapa[esp]}";`;
    if (!falsos) return todo;
    const nombres = lista
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => s.split(/\s+as\s+/)[0].trim());
    return `import {${lista}} from "${moduloFalso(nombres)}";`;
  });
  return aUrl(outputText);
}

const PISTAS = await fuente("../lib/teclado/pistas.ts");
const ATAJOS = await fuente("../lib/comandos/atajos.ts");
const MODO_DEV = await fuente("../lib/modoDev.ts");
const PERSONALIZAR = await fuente("../lib/comandos/personalizar.ts", { "./atajos": ATAJOS });
const REGISTRO = await fuente("../lib/comandos/registro.ts", {
  "@/lib/modoDev": MODO_DEV,
  "./atajos": ATAJOS,
  "./personalizar": PERSONALIZAR,
});
const CONSOLA = await fuente("../lib/comandos/teclasConsola.ts", { "./atajos": ATAJOS, "./registro": REGISTRO });
const ATMOSFERAS = await fuente("../lib/atmosferas.ts");
const NUEVO = await fuente("../lib/comandos/nuevo.ts");
const APP = await fuente(
  "../lib/comandos/comandosApp.ts",
  { "@/lib/modoDev": MODO_DEV, "@/lib/atmosferas": ATMOSFERAS, "./nuevo": NUEVO },
  { falsos: true },
);

const p = await import(PISTAS);
const at = await import(ATAJOS);
const reg = await import(REGISTRO);
const consola = await import(CONSOLA);
const { COMANDOS_APP } = await import(APP);

const tecla = (code, mods = {}) => ({ code, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...mods });

// ── el alfabeto ───────────────────────────────────────────────────────────

test("el alfabeto: sin repetidas, sin I ni O, y la fila central primero", () => {
  const a = p.ALFABETO_PISTAS;
  assert.equal(new Set(a).size, a.length);
  assert.ok(!a.includes("I") && !a.includes("O"));
  assert.ok(a.startsWith("ASDFGHJKL"));
  assert.match(a, /^[A-Z]+$/);
});

// ── las etiquetas ─────────────────────────────────────────────────────────

const sinPrefijos = (lista) => lista.every((x, i) => lista.every((y, j) => i === j || !y.startsWith(x)));

test("pocas: una letra cada una, las más cómodas primero", () => {
  assert.deepEqual(p.etiquetasPistas(0), []);
  assert.deepEqual(p.etiquetasPistas(3), ["A", "S", "D"]);
  const todas = p.etiquetasPistas(p.ALFABETO_PISTAS.length);
  assert.ok(todas.every((e) => e.length === 1));
});

test("más que letras: dos cada una, todas del mismo largo y sin prefijos", () => {
  const k = p.ALFABETO_PISTAS.length;
  for (const n of [k + 1, 60, 200, k * k]) {
    const l = p.etiquetasPistas(n);
    assert.equal(l.length, n);
    assert.equal(new Set(l).size, n, `repetidas con ${n}`);
    assert.ok(l.every((e) => e.length === 2), `largo distinto con ${n}`);
    assert.ok(sinPrefijos(l), `prefijos con ${n}`);
    assert.ok(l.every((e) => [...e].every((c) => p.ALFABETO_PISTAS.includes(c))));
  }
  assert.deepEqual(p.etiquetasPistas(k + 1).slice(0, 3), ["AA", "AS", "AD"]);
});

test("muchísimas: tres letras", () => {
  const k = p.ALFABETO_PISTAS.length;
  const l = p.etiquetasPistas(k * k + 1);
  assert.ok(l.every((e) => e.length === 3));
  assert.equal(new Set(l).size, l.length);
});

// ── el orden ──────────────────────────────────────────────────────────────

const en = (id, left, top) => ({ id, caja: { left, top, right: left + 20, bottom: top + 20 } });

test("de arriba-izquierda a abajo-derecha, por renglones", () => {
  const items = [en("abajo", 0, 100), en("der", 200, 10), en("izq", 10, 12), en("medio", 100, 8)];
  assert.deepEqual(
    p.ordenarPorPosicion(items).map((x) => x.id),
    ["izq", "medio", "der", "abajo"],
  );
});

test("un par de píxeles de diferencia no cambia el renglón; más que la tolerancia, sí", () => {
  const items = [en("b", 50, 3), en("a", 0, 0)];
  assert.deepEqual(p.ordenarPorPosicion(items).map((x) => x.id), ["a", "b"]);
  const lejos = [en("b", 0, 30), en("a", 50, 0)];
  assert.deepEqual(p.ordenarPorPosicion(lejos).map((x) => x.id), ["a", "b"]);
});

// ── escribir una etiqueta ─────────────────────────────────────────────────

test("las letras se reconocen por posición, solo las del alfabeto", () => {
  assert.equal(p.letraDeCode("KeyA"), "A");
  assert.equal(p.letraDeCode("KeyI"), null);
  assert.equal(p.letraDeCode("KeyO"), null);
  assert.equal(p.letraDeCode("Digit1"), null);
  assert.equal(p.letraDeCode("Semicolon"), null);
});

test("filtrar por prefijo", () => {
  const l = ["AA", "AS", "SA", "SS"];
  assert.deepEqual(p.filtrarPorPrefijo(l, ""), [0, 1, 2, 3]);
  assert.deepEqual(p.filtrarPorPrefijo(l, "S"), [2, 3]);
  assert.deepEqual(p.filtrarPorPrefijo(l, "SA"), [2]);
  assert.deepEqual(p.filtrarPorPrefijo(l, "D"), []);
});

test("escribir letra a letra: sigue, activa, o ignora lo que no lleva a nada", () => {
  const l = ["AA", "AS", "SA", "SS"];
  assert.deepEqual(p.escribirLetra(l, "", "S"), { tipo: "seguir", escrito: "S", coinciden: [2, 3] });
  assert.deepEqual(p.escribirLetra(l, "S", "A"), { tipo: "activar", escrito: "SA", indice: 2 });
  assert.deepEqual(p.escribirLetra(l, "S", "D"), { tipo: "ignorar", escrito: "S" });
  assert.deepEqual(p.escribirLetra(l, "", "D"), { tipo: "ignorar", escrito: "" });
  assert.deepEqual(p.escribirLetra(["A", "S"], "", "S"), { tipo: "activar", escrito: "S", indice: 1 });
  assert.equal(p.borrarLetra("SA"), "S");
  assert.equal(p.borrarLetra(""), "");
});

// ── qué se hace con cada objetivo ─────────────────────────────────────────

test("enlaces, botones, pestañas, opciones y casillas: clic; con Shift, solo foco", () => {
  for (const d of [
    { etiqueta: "A" },
    { etiqueta: "BUTTON" },
    { etiqueta: "DIV", rol: "tab" },
    { etiqueta: "LI", rol: "option" },
    { etiqueta: "TR" },
    { etiqueta: "SUMMARY" },
    { etiqueta: "INPUT", tipo: "checkbox" },
    { etiqueta: "INPUT", tipo: "radio" },
    { etiqueta: "INPUT", tipo: "button" },
  ]) {
    assert.equal(p.accionDePista(d), "clic", JSON.stringify(d));
    assert.equal(p.accionDePista(d, true), "foco", JSON.stringify(d));
  }
});

test("campos de texto, desplegables y lo editable: foco (modo escribir)", () => {
  for (const d of [
    { etiqueta: "INPUT" },
    { etiqueta: "INPUT", tipo: "text" },
    { etiqueta: "INPUT", tipo: "search" },
    { etiqueta: "INPUT", tipo: "range" },
    { etiqueta: "TEXTAREA" },
    { etiqueta: "SELECT" },
    { etiqueta: "DIV", editable: true },
  ]) {
    assert.equal(p.accionDePista(d), "foco", JSON.stringify(d));
    assert.equal(p.accionDePista(d, true), "foco", JSON.stringify(d));
  }
});

test("un iframe es el marco entero; las marcas del DOM mandan", () => {
  assert.equal(p.accionDePista({ etiqueta: "IFRAME" }), "marco");
  assert.equal(p.accionDePista({ etiqueta: "DIV", marca: "consola" }), "consola");
  assert.equal(p.accionDePista({ etiqueta: "CANVAS", marca: "documento" }), "documento");
  assert.equal(p.accionDePista({ etiqueta: "DIV", marca: "puntero" }), "puntero");
  assert.equal(p.accionDePista({ etiqueta: "DIV", editable: true, marca: "foco" }), "foco");
  assert.equal(p.accionDePista({ etiqueta: "DIV", marca: "clic" }, true), "foco");
  // Una marca desconocida no inventa una acción: se decide por el elemento.
  assert.equal(p.accionDePista({ etiqueta: "BUTTON", marca: "volar" }), "clic");
});

// ── el comando ────────────────────────────────────────────────────────────

test("pistas.mostrar: F10, en captura, sin tecla reservada, y sale de la consola", () => {
  const c = COMANDOS_APP.find((x) => x.id === "pistas.mostrar");
  assert.ok(c, "no existe pistas.mostrar");
  assert.equal(at.textoAtajo(c.atajos[0]), "F10");
  assert.equal(c.enCaptura, true);
  for (const a of c.atajos) assert.equal(at.reservaQueChoca(a, c.id), null);
  assert.equal(at.problemaDeAtajo(c.atajos[0]), null);
  assert.equal(reg.comandoParaTecla(tecla("F10"), COMANDOS_APP, false, "captura")?.id, "pistas.mostrar");
  assert.equal(reg.comandoParaTecla(tecla("F10"), COMANDOS_APP, false, "burbuja"), null);
  // Shift+F10 es el menú contextual de una pestaña o del árbol: no son las pistas.
  assert.equal(reg.comandoParaTecla(tecla("F10", { shiftKey: true }), COMANDOS_APP, false, "captura"), null);
  assert.equal(consola.teclaSaleDeLaConsola(tecla("F10")), true);
  assert.ok(consola.FIJOS_EN_LA_CONSOLA.has("pistas.mostrar"));
  assert.deepEqual(reg.validarComandos(COMANDOS_APP), []);
});
