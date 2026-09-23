// Test headless de `lib/extensionesDeTipo.ts`: la ÚNICA respuesta a «qué
// extensión tiene este tipo» (`FUN-S-03`, `FUN-L-20`).
//
// Existe por un defecto concreto: la respuesta estaba repetida en tres archivos
// —`extDeTipo`, el mapa del explorador y la lista que `resolveWikilink` sabe
// quitar— y al agregar `.drawio` se tocó solo una. El archivo se creaba bien,
// pero se listaba sin extensión y `![[diagrama.drawio]]` no resolvía a nada.
//
//   node --test scripts/test-extensiones.mjs
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import ts from "typescript";

const rutaTs = fileURLToPath(new URL("../lib/extensionesDeTipo.ts", import.meta.url));
const { outputText } = ts.transpileModule(await readFile(rutaTs, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 },
});
const { EXTENSION_POR_TIPO, EXTENSIONES_DE_NOTA, sinExtensionDeNota } = await import(
  `data:text/javascript,${encodeURIComponent(outputText)}`
);

/**
 * Los tipos que existen hoy. Si se agrega uno y no se agrega acá, este test
 * falla — que es el punto: obliga a contestar la pregunta en el único sitio
 * donde se contesta.
 */
const TIPOS = ["markdown", "excalidraw", "base", "canvas", "drawio"];

test("todos los tipos tienen extensión, y ninguna lleva punto", () => {
  for (const tipo of TIPOS) {
    const ext = EXTENSION_POR_TIPO[tipo];
    assert.ok(ext, `falta la extensión del tipo "${tipo}"`);
    assert.ok(!ext.startsWith("."), `la extensión de "${tipo}" no debe llevar punto`);
  }
  assert.equal(Object.keys(EXTENSION_POR_TIPO).length, TIPOS.length);
});

test("los diagramas de draw.io son .drawio", () => {
  // El caso que se rompió: sin esta entrada el archivo se lista sin extensión.
  assert.equal(EXTENSION_POR_TIPO.drawio, "drawio");
  assert.ok(EXTENSIONES_DE_NOTA.includes("drawio"));
});

test("sinExtensionDeNota quita la extensión de cada tipo", () => {
  // Es lo que necesita `resolveWikilink`: el título de una nota NO lleva
  // extensión, pero un embed `![[archivo.ext]]` sí. Si la extensión no se quita,
  // el destino no se encuentra y el embed se dibuja como «no existe».
  for (const ext of EXTENSIONES_DE_NOTA) {
    assert.equal(sinExtensionDeNota(`Mi archivo.${ext}`), "Mi archivo");
    assert.equal(
      sinExtensionDeNota(`Mi archivo.${ext.toUpperCase()}`),
      "Mi archivo",
      "la extensión no distingue mayúsculas",
    );
  }
});

test("sinExtensionDeNota no recorta lo que NO es una extensión de nota", () => {
  // Un punto en el nombre no es una extensión: recortarlo rompería el título.
  assert.equal(sinExtensionDeNota("Notas de ayer"), "Notas de ayer");
  assert.equal(sinExtensionDeNota("v1.2.3"), "v1.2.3");
  assert.equal(sinExtensionDeNota("informe.pdf"), "informe.pdf");
  assert.equal(sinExtensionDeNota("captura.png"), "captura.png");
  assert.equal(sinExtensionDeNota(".oculto"), ".oculto", "no hay stem que recortar");
  assert.equal(sinExtensionDeNota("sin punto"), "sin punto");
});

test("un nombre que ya viene sin extensión se devuelve igual", () => {
  // `resolveWikilink` llama a esto tras fallar el match exacto: si devolviera
  // algo distinto, buscaría un título que no existe.
  assert.equal(sinExtensionDeNota("Diagrama sin título"), "Diagrama sin título");
});
