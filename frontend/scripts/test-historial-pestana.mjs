// Test headless de `lib/historialPestana.ts`: la línea de historial de una
// pestaña (`DEF-040`) y la que hereda una pestaña abierta desde otra
// (`FUN-S-34`): un enlace con Ctrl+clic o con la rueda, y la rueda sobre las
// flechas del historial (`FUN-S-13`). Más `dondeAbrirClic`, que decide cuál de
// los tres caminos toma un clic. Se transpilan los módulos en el momento.
//
//   node --test scripts/test-historial-pestana.mjs
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import ts from "typescript";

const aUrl = (codigo) => `data:text/javascript,${encodeURIComponent(codigo)}`;

async function fuente(ruta) {
  const texto = await readFile(fileURLToPath(new URL(ruta, import.meta.url)), "utf8");
  const { outputText } = ts.transpileModule(texto, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 },
  });
  return aUrl(outputText);
}

const { lineaDe, empujarEnLinea, lineaHeredada, lineaEnPaso, MAX_HISTORIAL } = await import(
  await fuente("../lib/historialPestana.ts")
);

const esNota = (id) => !id.includes(":");

test("una pestaña vieja, sin línea, es una línea de un solo paso", () => {
  assert.deepEqual(lineaDe({ notaId: "a.md" }), { historial: ["a.md"], indice: 0 });
  assert.deepEqual(lineaDe({ notaId: "b.md", historial: ["a.md", "b.md"], indice: 9 }), {
    historial: ["a.md", "b.md"],
    indice: 1,
  });
});

test("empujar trunca lo de adelante", () => {
  const tab = { notaId: "b.md", historial: ["a.md", "b.md", "c.md"], indice: 1 };
  assert.deepEqual(empujarEnLinea(tab, "d.md"), { historial: ["a.md", "b.md", "d.md"], indice: 2 });
});

test("la pestaña nueva de un enlace hereda la línea y Atrás vuelve al origen", () => {
  const origen = { notaId: "b.md", historial: ["a.md", "b.md"], indice: 1 };
  const linea = lineaHeredada(origen, "c.md", esNota);
  assert.deepEqual(linea, { historial: ["a.md", "b.md", "c.md"], indice: 2 });
  assert.equal(linea.historial[linea.indice - 1], "b.md");
  // El origen no se toca.
  assert.deepEqual(origen.historial, ["a.md", "b.md"]);
});

test("heredar desde un punto atrás de la línea descarta lo de adelante", () => {
  const origen = { notaId: "a.md", historial: ["a.md", "b.md", "c.md"], indice: 0 };
  assert.deepEqual(lineaHeredada(origen, "x.md", esNota), { historial: ["a.md", "x.md"], indice: 1 });
});

test("un enlace a la misma nota no agrega un paso repetido", () => {
  const origen = { notaId: "b.md", historial: ["a.md", "b.md", "c.md"], indice: 1 };
  assert.deepEqual(lineaHeredada(origen, "b.md", esNota), { historial: ["a.md", "b.md"], indice: 1 });
});

test("sin origen, o con un origen o destino que no es nota, la línea es propia", () => {
  assert.deepEqual(lineaHeredada(null, "c.md", esNota), { historial: ["c.md"], indice: 0 });
  assert.deepEqual(lineaHeredada({ notaId: "terminal:1" }, "c.md", esNota), {
    historial: ["c.md"],
    indice: 0,
  });
  assert.deepEqual(lineaHeredada({ notaId: "a.md" }, "graph:global", esNota), {
    historial: ["graph:global"],
    indice: 0,
  });
});

test("la herencia respeta el tope de la línea", () => {
  const historial = Array.from({ length: MAX_HISTORIAL }, (_, i) => `n${i}.md`);
  const origen = { notaId: historial.at(-1), historial, indice: historial.length - 1 };
  const linea = lineaHeredada(origen, "nueva.md", esNota);
  assert.equal(linea.historial.length, MAX_HISTORIAL);
  assert.equal(linea.historial.at(-1), "nueva.md");
  assert.equal(linea.indice, MAX_HISTORIAL - 1);
});

test("la rueda en una flecha copia la línea entera, parada en ese paso (FUN-S-13)", () => {
  const origen = { notaId: "b.md", historial: ["a.md", "b.md", "c.md"], indice: 1 };
  assert.deepEqual(lineaEnPaso(origen, -1), { historial: ["a.md", "b.md", "c.md"], indice: 0 });
  assert.deepEqual(lineaEnPaso(origen, 1), { historial: ["a.md", "b.md", "c.md"], indice: 2 });
  assert.equal(lineaEnPaso({ notaId: "a.md" }, -1), null);
  assert.equal(lineaEnPaso({ notaId: "a.md" }, 1), null);
});

test("dondeAbrirClic: clic aquí, Ctrl o ⌘ en pestaña nueva, rueda en segundo plano", async () => {
  // `enlacesExternos` importa Tauri de forma diferida; para esta función alcanza
  // con transpilarla sola.
  const texto = (
    await readFile(fileURLToPath(new URL("../lib/enlacesExternos.ts", import.meta.url)), "utf8")
  ).replaceAll(String.fromCharCode(13), "");
  const inicio = texto.indexOf("export function dondeAbrirClic");
  const fin = texto.indexOf("\n}\n", inicio) + 3;
  const { outputText } = ts.transpileModule(texto.slice(inicio, fin), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 },
  });
  const { dondeAbrirClic } = await import(aUrl(outputText));
  assert.equal(dondeAbrirClic({ button: 0 }), "aqui");
  assert.equal(dondeAbrirClic({ button: 0, ctrlKey: true }), "pestana");
  assert.equal(dondeAbrirClic({ button: 0, metaKey: true }), "pestana");
  assert.equal(dondeAbrirClic({ button: 1 }), "fondo");
  assert.equal(dondeAbrirClic({ button: 1, ctrlKey: true }), "fondo");
});
