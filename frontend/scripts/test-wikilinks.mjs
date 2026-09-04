// Test headless (sin navegador ni Tauri) del partidor de `[[wikilinks]]`
// (`DEF-045`). `lib/wikilinks.ts` es puro —sin imports—, así que se transpila en
// el momento y se importa vía data: URL, igual que `scripts/test-frontmatter.mjs`.
//
//   node --test scripts/test-wikilinks.mjs
//   node scripts/test-wikilinks.mjs
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import ts from "typescript";

const rutaTs = fileURLToPath(new URL("../lib/wikilinks.ts", import.meta.url));
const { outputText } = ts.transpileModule(await readFile(rutaTs, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 },
});
const { partirWikilink, destinoDeWikilink } = await import(
  `data:text/javascript,${encodeURIComponent(outputText)}`
);

// La barra escapada se arma con charCode para que no dependa de cómo se copie
// este archivo: es la secuencia de DOS caracteres  \  y  |
const ESC = String.fromCharCode(92) + "|";

test("sin alias: el destino es todo, y también la etiqueta", () => {
  assert.deepEqual(partirWikilink("Mi nota"), {
    destino: "Mi nota",
    etiqueta: "Mi nota",
    desdeEtiqueta: 0,
  });
});

test("alias con barra normal", () => {
  assert.deepEqual(partirWikilink("Destino|alias"), {
    destino: "Destino",
    etiqueta: "alias",
    desdeEtiqueta: 8,
  });
});

test("alias con la barra ESCAPADA da el mismo destino (DEF-045)", () => {
  const r = partirWikilink("Destino" + ESC + "alias");
  assert.equal(r.destino, "Destino", "el destino no debe arrastrar la barra invertida");
  assert.equal(r.etiqueta, "alias");
  // Con el escape hay que saltar DOS caracteres, no uno.
  assert.equal(r.desdeEtiqueta, 9);
});

test("las dos formas describen el mismo enlace", () => {
  const normal = partirWikilink("Destino|alias");
  const escapado = partirWikilink("Destino" + ESC + "alias");
  assert.equal(normal.destino, escapado.destino);
  assert.equal(normal.etiqueta, escapado.etiqueta);
});

test("se conservan el ancla de sección y la de bloque", () => {
  assert.equal(partirWikilink("Nota#Sección" + ESC + "ver").destino, "Nota#Sección");
  assert.equal(partirWikilink("Nota^bloque" + ESC + "ver").destino, "Nota^bloque");
});

test("la ruta de carpetas se conserva al partir y se quita al buscar por título", () => {
  assert.equal(partirWikilink("Carpeta/Sub/Nota" + ESC + "x").destino, "Carpeta/Sub/Nota");
  assert.equal(destinoDeWikilink("Carpeta/Sub/Nota" + ESC + "x"), "Nota");
  assert.equal(destinoDeWikilink("Carpeta/Sub/Nota|x"), "Nota");
});

test("los espacios alrededor del destino y del alias se recortan", () => {
  const r = partirWikilink("  Destino  " + ESC + "  alias  ");
  assert.equal(r.destino, "Destino");
  assert.equal(r.etiqueta, "alias");
});

test("un alias vacío cae al destino", () => {
  assert.equal(partirWikilink("Destino|").etiqueta, "Destino");
  assert.equal(partirWikilink("Destino" + ESC).etiqueta, "Destino");
});

test("solo corta en la PRIMERA barra: el alias puede llevar más", () => {
  assert.equal(partirWikilink("Destino|a|b").etiqueta, "a|b");
  assert.equal(partirWikilink("Destino" + ESC + "a" + ESC + "b").etiqueta, "a" + ESC + "b");
});

test("una barra invertida que no precede a una barra no separa nada", () => {
  const raro = "C:" + String.fromCharCode(92) + "ruta";
  assert.equal(partirWikilink(raro).destino, raro);
});
