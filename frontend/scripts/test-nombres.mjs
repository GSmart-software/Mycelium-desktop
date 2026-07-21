// Test headless (sin navegador ni Tauri) del saneo/desambiguación de nombres del
// "vault en carpeta" (fase 7). El módulo bajo prueba (`lib/db/nombres.ts`) es puro
// —sin imports—, así que se transpila en el momento con el compilador de
// TypeScript (devDep ya instalada) y se importa vía data: URL. No hace falta ni
// framework de test ni build previo.
//
//   node --test scripts/test-nombres.mjs
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import ts from "typescript";

const rutaTs = fileURLToPath(new URL("../lib/db/nombres.ts", import.meta.url));
const fuente = await readFile(rutaTs, "utf8");
const { outputText } = ts.transpileModule(fuente, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 },
});
const mod = await import(`data:text/javascript,${encodeURIComponent(outputText)}`);
const { sanearNombre, esReservadoWindows, desambiguar } = mod;

test("reemplaza los caracteres prohibidos por guion", () => {
  assert.equal(sanearNombre('a/b\\c:d*e?f"g<h>i|j'), "a-b-c-d-e-f-g-h-i-j");
});

test("recorta espacios y puntos finales (Windows los recorta)", () => {
  assert.equal(sanearNombre("nota...  "), "nota");
  assert.equal(sanearNombre("  hola  "), "hola");
});

test("colapsa espacios repetidos", () => {
  assert.equal(sanearNombre("a    b"), "a b");
});

test("nombre vacío tras sanear usa el fallback", () => {
  assert.equal(sanearNombre("   "), "Sin título");
  assert.equal(sanearNombre("///"), "Sin título");
  assert.equal(sanearNombre("", "Sin nombre"), "Sin nombre");
  assert.equal(sanearNombre("...", "Sin nombre"), "Sin nombre");
});

test("nombres reservados de Windows reciben sufijo _", () => {
  assert.equal(sanearNombre("CON"), "CON_");
  assert.equal(sanearNombre("con"), "con_");
  assert.equal(sanearNombre("NUL"), "NUL_");
  assert.equal(sanearNombre("com1"), "com1_");
  assert.equal(sanearNombre("LPT9"), "LPT9_");
  // No reservados: se dejan igual.
  assert.equal(sanearNombre("COM0"), "COM0");
  assert.equal(sanearNombre("COM10"), "COM10");
  assert.equal(sanearNombre("console"), "console");
});

test("esReservadoWindows es case-insensitive y solo nombres exactos", () => {
  assert.equal(esReservadoWindows("con"), true);
  assert.equal(esReservadoWindows("  AUX "), true);
  assert.equal(esReservadoWindows("aux2"), false);
  assert.equal(esReservadoWindows("miconarchivo"), false);
});

test("desambiguar añade sufijo incremental estilo Obsidian", () => {
  const ocupados = new Set(["Nota", "Nota 1"]);
  assert.equal(desambiguar("Nota", (c) => ocupados.has(c)), "Nota 2");
  assert.equal(desambiguar("Libre", (c) => ocupados.has(c)), "Libre");
});
