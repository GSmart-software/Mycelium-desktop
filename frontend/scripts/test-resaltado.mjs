// Test headless de `==resaltado==` (`FUN-S-33`): las reglas puras de
// `lib/resaltado.ts` —que usa la vista en vivo— y el pipeline REAL de la vista
// de lectura (`lib/markdown.ts`), para que las dos no puedan divergir.
//
// Mismo armado que `test-embeds.mjs`: `lib/markdown.ts` importa paquetes de npm,
// así que se transpila a una carpeta temporal dentro de `frontend/`.
//
//   node --test scripts/test-resaltado.mjs
import assert from "node:assert/strict";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { after, test } from "node:test";
import ts from "typescript";

const AQUI = dirname(fileURLToPath(import.meta.url));
const FRONTEND = join(AQUI, "..");
const TMP = join(FRONTEND, ".tmp-test-resaltado");

const MODULOS = [
  "lib/markdown.ts",
  "lib/resaltado.ts",
  "lib/frontmatter.ts",
  "lib/wikilinks.ts",
  "lib/drawio.ts",
  "lib/extensionesDeTipo.ts",
  "lib/editor/wikilink.ts",
  "lib/video.ts",
  "lib/imagenes.ts",
  "lib/enlacesExternos.ts",
  "lib/estadosTarea.ts",
];

await rm(TMP, { recursive: true, force: true });
await mkdir(TMP, { recursive: true });
await writeFile(
  join(TMP, "vaultStore.mjs"),
  "export const useVaultStore = { getState: () => ({ notas: [], carpetas: [] }) };\n",
);
for (const rel of MODULOS) {
  const fuente = await readFile(join(FRONTEND, rel), "utf8");
  const { outputText } = ts.transpileModule(fuente, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  });
  const js = outputText
    .replace(/(["'])@\/lib\/(?:[A-Za-z0-9_-]+\/)*([A-Za-z0-9_-]+)\1/g, '"./$2.mjs"')
    .replace(/(["'])@\/stores\/([A-Za-z0-9_-]+)\1/g, '"./$2.mjs"');
  await writeFile(join(TMP, `${rel.split("/").pop().replace(/\.ts$/, "")}.mjs`), js);
}

const { renderNota } = await import(pathToFileURL(join(TMP, "markdown.mjs")).href);
const { resaltadosEnLinea } = await import(pathToFileURL(join(TMP, "resaltado.mjs")).href);

after(async () => {
  await rm(TMP, { recursive: true, force: true });
});

/** Los tramos resaltados de una línea, como texto (sin los `==`). */
const tramos = (linea, enCodigo) =>
  resaltadosEnLinea(linea, enCodigo).map((r) => linea.slice(r.desde + 2, r.hasta - 2));

// ── Las reglas puras (vista en vivo) ────────────────────────────────────────

test("==texto== se reconoce, y varios en la misma línea", () => {
  assert.deepEqual(tramos("hola ==mundo== y ==otro== fin"), ["mundo", "otro"]);
});

test("=== y ==== no son delimitadores", () => {
  assert.deepEqual(tramos("a === b === c"), []);
  assert.deepEqual(tramos("===x==="), []);
  assert.deepEqual(tramos("===="), []);
});

test("con espacio pegado al delimitador no abre ni cierra", () => {
  assert.deepEqual(tramos("si a == b y c == d"), []);
  assert.deepEqual(tramos("== x =="), []);
});

test("vacío no cuenta, y un escape tampoco", () => {
  assert.deepEqual(tramos("===="), []);
  assert.deepEqual(tramos("\\==no== pero ==sí=="), ["sí"]);
});

test("sin cierre, nada", () => {
  assert.deepEqual(tramos("==abierto y nunca cerrado"), []);
});

test("los == dentro de código se ignoran", () => {
  const linea = "`==x==` y ==y==";
  const enCodigo = (i) => i < 7;
  assert.deepEqual(tramos(linea, enCodigo), ["y"]);
});

// ── El pipeline de lectura ──────────────────────────────────────────────────

test("lectura: ==texto== sale como <mark class=\"mic-resaltado\">", () => {
  const html = renderNota("Un ==texto resaltado== acá.");
  assert.match(html, /<mark class="mic-resaltado">texto resaltado<\/mark>/);
  assert.doesNotMatch(html, /==/);
});

test("lectura: el resaltado envuelve negritas y enlaces", () => {
  const html = renderNota("==una **negrita** y [[Nota]]==");
  assert.match(html, /<mark class="mic-resaltado">una <strong>negrita<\/strong> y <a [^>]*mic-wikilink[^>]*>Nota<\/a><\/mark>/);
});

test("lectura: dentro de un énfasis también", () => {
  assert.match(renderNota("*a ==b== c*"), /<em>a <mark class="mic-resaltado">b<\/mark> c<\/em>/);
});

test("lectura: en código en línea y en bloque queda tal cual", () => {
  assert.doesNotMatch(renderNota("`==x==`"), /<mark/);
  assert.doesNotMatch(renderNota("```\n==x==\n```"), /<mark/);
  assert.match(renderNota("`==x==`"), /<code>==x==<\/code>/);
});

test("lectura: no cruza líneas", () => {
  const html = renderNota("==empieza\ntermina==");
  assert.doesNotMatch(html, /<mark/);
});

test("lectura: === no resalta", () => {
  assert.doesNotMatch(renderNota("a ===b=== c"), /<mark/);
});

test("lectura: un resaltado por línea en un párrafo de dos líneas", () => {
  const html = renderNota("==uno==\n==dos==");
  assert.equal(html.match(/<mark class="mic-resaltado">/g)?.length, 2);
});

test("lectura: en una celda de tabla y en un título", () => {
  assert.match(renderNota("| a |\n|---|\n| ==x== |"), /<td><mark class="mic-resaltado">x<\/mark><\/td>/);
  assert.match(renderNota("# Un ==título=="), /<h1>Un <mark class="mic-resaltado">título<\/mark><\/h1>/);
});

test("lectura: el contenido se sigue escapando", () => {
  const html = renderNota("==<img src=x onerror=alert(1)>==");
  assert.doesNotMatch(html, /<img src=x/);
});
