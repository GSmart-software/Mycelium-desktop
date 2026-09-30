// Test headless del criterio «¿se puede leer este dibujo o diagrama?» (`DEF-119`).
//
// `lib/archivosIlegibles.ts` es puro —sin imports—, así que se transpila en el
// momento y se importa vía data: URL, igual que el resto de los núcleos. El
// `DOMParser` que usa la app para el XML no existe en Node: acá se simula lo que
// devolvería (`estructura`).
//
//   node --test scripts/test-archivos-ilegibles.mjs
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import ts from "typescript";

const rutaTs = fileURLToPath(new URL("../lib/archivosIlegibles.ts", import.meta.url));
const { outputText } = ts.transpileModule(await readFile(rutaTs, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
});
const A = await import(`data:text/javascript,${encodeURIComponent(outputText)}`);

// ── Excalidraw ──────────────────────────────────────────────────────────────

const rect = { id: "r", type: "rectangle", x: 0, y: 0, width: 10, height: 10 };

test("excalidraw: un archivo vacío es un dibujo en blanco válido", () => {
  assert.deepEqual(A.diagnosticarExcalidraw(""), { estado: "vacio" });
  assert.deepEqual(A.diagnosticarExcalidraw("  \n"), { estado: "vacio" });
});

test("excalidraw: un dibujo bien formado es legible", () => {
  const json = JSON.stringify({ type: "excalidraw", version: 2, elements: [rect], files: {} });
  assert.deepEqual(A.diagnosticarExcalidraw(json), { estado: "legible" });
  assert.deepEqual(A.diagnosticarExcalidraw('{"elements":[]}'), { estado: "legible" });
});

test("excalidraw: JSON inválido es ilegible, con el motivo", () => {
  const r = A.diagnosticarExcalidraw('{"elements": [ {"type": "rectangle", } ]');
  assert.equal(r.estado, "ilegible");
  assert.match(r.motivo, /No es JSON válido/);
});

test("excalidraw: sin la lista elements no es un dibujo", () => {
  assert.equal(A.diagnosticarExcalidraw("{}").estado, "ilegible");
  assert.equal(A.diagnosticarExcalidraw("[]").estado, "ilegible");
  assert.equal(A.diagnosticarExcalidraw("42").estado, "ilegible");
  assert.equal(A.diagnosticarExcalidraw('{"elements": {}}').estado, "ilegible");
});

test("excalidraw: un elemento que no es objeto o no tiene type es ilegible", () => {
  assert.match(A.diagnosticarExcalidraw('{"elements":[null]}').motivo, /elemento 1/);
  assert.match(A.diagnosticarExcalidraw('{"elements":[{"x":1}]}').motivo, /type/);
});

test("excalidraw: un tipo desconocido es ilegible (restore lo descartaría y se perdería al guardar)", () => {
  const r = A.diagnosticarExcalidraw(JSON.stringify({ elements: [rect, { type: "circle" }] }));
  assert.equal(r.estado, "ilegible");
  assert.match(r.motivo, /elemento 2.*circle/);
});

test("excalidraw: los tipos del propio editor pasan (también selection y el draw viejo)", () => {
  const tipos = ["rectangle", "ellipse", "diamond", "arrow", "line", "draw", "text", "freedraw",
    "image", "frame", "magicframe", "embeddable", "iframe", "selection"];
  const json = JSON.stringify({ elements: tipos.map((type, i) => ({ id: `e${i}`, type })) });
  assert.deepEqual(A.diagnosticarExcalidraw(json), { estado: "legible" });
});

// ── draw.io ─────────────────────────────────────────────────────────────────

/** Lo que devolvería el `DOMParser` para un XML bien formado. */
const estructura = (raiz, diagramas = []) => () => ({ error: null, raiz, diagramas });

test("drawio: un archivo vacío es un diagrama en blanco válido, sin mirar el XML", () => {
  const nunca = () => assert.fail("no hace falta analizar un archivo vacío");
  assert.deepEqual(A.diagnosticarDrawio("", nunca), { estado: "vacio" });
  assert.deepEqual(A.diagnosticarDrawio(" \n", nunca), { estado: "vacio" });
});

test("drawio: XML mal formado es ilegible, con el mensaje del parser", () => {
  const r = A.diagnosticarDrawio("<mxfile><diagram>", () => ({
    error: "error on line 1 at column 18: Premature end of data",
    raiz: null,
    diagramas: [],
  }));
  assert.equal(r.estado, "ilegible");
  assert.match(r.motivo, /mal formado.*Premature end/);
});

test("drawio: una raíz que no es mxfile ni mxGraphModel no es un diagrama", () => {
  const r = A.diagnosticarDrawio("<svg/>", estructura("svg"));
  assert.equal(r.estado, "ilegible");
  assert.match(r.motivo, /<svg>/);
});

test("drawio: mxfile con modelo, mxGraphModel suelto y páginas vacías son legibles", () => {
  assert.equal(
    A.diagnosticarDrawio("x", estructura("mxfile", [{ conModelo: true, texto: "" }])).estado,
    "legible",
  );
  assert.equal(A.diagnosticarDrawio("x", estructura("mxGraphModel")).estado, "legible");
  assert.equal(
    A.diagnosticarDrawio("x", estructura("mxfile", [{ conModelo: false, texto: "  \n" }])).estado,
    "legible",
  );
  assert.equal(A.diagnosticarDrawio("x", estructura("mxfile", [])).estado, "legible");
});

test("drawio: una página comprimida tiene que ser base64", () => {
  const bien = { conModelo: false, texto: "\n  dZHBDoIwDIafhuMS2NToFVE9eeHgcS6rMm1Z\n" };
  assert.equal(A.diagnosticarDrawio("x", estructura("mxfile", [bien])).estado, "legible");
  const mal = { conModelo: false, texto: "esto no es base64 {}" };
  const r = A.diagnosticarDrawio("x", estructura("mxfile", [bien, mal]));
  assert.equal(r.estado, "ilegible");
  assert.match(r.motivo, /página 2/);
});

// ── Común ───────────────────────────────────────────────────────────────────

test("motivoDeExcepcion deja el mensaje en una línea", () => {
  assert.equal(A.motivoDeExcepcion(new Error("a\n   b\tc")), "a b c");
  assert.equal(A.motivoDeExcepcion("x"), "x");
  assert.equal(A.motivoDeExcepcion(""), "error desconocido");
});
