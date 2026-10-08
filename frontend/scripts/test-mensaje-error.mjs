// Test headless de `mensajeDeError` (`DEF-136`): el texto de un error, venga de
// un `Error`, de un rechazo de `invoke` de Tauri (texto) o de un objeto
// serializado. El módulo es puro: se transpila en el momento y se importa por
// data: URL, como `test-nombres.mjs`.
//
//   node --test scripts/test-mensaje-error.mjs
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import ts from "typescript";

const rutaTs = fileURLToPath(new URL("../lib/mensajeError.ts", import.meta.url));
const fuente = await readFile(rutaTs, "utf8");
const { outputText } = ts.transpileModule(fuente, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 },
});
const { mensajeDeError } = await import(`data:text/javascript,${encodeURIComponent(outputText)}`);

test("un Error da su message", () => {
  assert.equal(mensajeDeError(new Error("se cayó")), "se cayó");
});

test("un rechazo de invoke (texto) conserva el texto: era el que se perdía", () => {
  assert.equal(
    mensajeDeError("UNIQUE constraint failed: notas.id"),
    "UNIQUE constraint failed: notas.id",
  );
});

test("un objeto serializado con message o error da ese texto", () => {
  assert.equal(mensajeDeError({ message: "sin permiso" }), "sin permiso");
  assert.equal(mensajeDeError({ error: "no existe" }), "no existe");
});

test("sin nada legible, el texto por defecto", () => {
  assert.equal(mensajeDeError(undefined), "Error desconocido");
  assert.equal(mensajeDeError(null), "Error desconocido");
  assert.equal(mensajeDeError(42), "Error desconocido");
  assert.equal(mensajeDeError(""), "Error desconocido");
  assert.equal(mensajeDeError(new Error("")), "Error desconocido");
  assert.equal(mensajeDeError({ message: 3 }), "Error desconocido");
  assert.equal(mensajeDeError({}, "No se pudo abrir"), "No se pudo abrir");
});
