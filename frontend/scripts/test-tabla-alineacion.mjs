// Test headless de la alineación de columnas en la vista de lectura (`DEF-143`).
//
// La alineación (`:---`, `:---:`, `---:`) depende de DOS piezas que viven en
// archivos distintos y que nada más une:
//   1. `lib/markdown.ts` (remark-rehype) la emite como el atributo `align` de
//      cada `<th>`/`<td>`;
//   2. `styles/editor.css` la convierte en `text-align` con un selector de
//      atributo, porque `.mic-preview th, .mic-preview td { text-align: left }`
//      pisa el `align` a secas (sugerencia de presentación, especificidad cero).
// Si una cambia sin la otra —otro renderer que emita `style`, o una regla
// borrada—, las columnas vuelven a quedar a la izquierda sin que nada falle.
//
// Mismo arnés que `scripts/test-estados-tarea.mjs`.
//
//   node --test scripts/test-tabla-alineacion.mjs
import assert from "node:assert/strict";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { after, test } from "node:test";
import ts from "typescript";

const AQUI = dirname(fileURLToPath(import.meta.url));
const FRONTEND = join(AQUI, "..");
const TMP = join(FRONTEND, ".tmp-test-tabla-alineacion");

const MODULOS = [
  "lib/estadosTarea.ts",
  "lib/markdown.ts",
  "lib/frontmatter.ts",
  "lib/wikilinks.ts",
  "lib/drawio.ts",
  "lib/extensionesDeTipo.ts",
  "lib/editor/wikilink.ts",
  "lib/video.ts",
  "lib/imagenes.ts",
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
const css = await readFile(join(FRONTEND, "styles/editor.css"), "utf8");

after(async () => {
  await rm(TMP, { recursive: true, force: true });
});

const TABLA = [
  "| Fruta | Origen | Kilos | Nota |",
  "|:---|:---:|---:|---|",
  "| Manzana | Sur | 3,5 | — |",
].join("\n");

/** `[etiqueta, align|null]` de cada celda, en orden. */
function celdas(html) {
  return [...html.matchAll(/<(th|td)(?:\s+align="(\w+)")?>/g)].map((m) => [m[1], m[2] ?? null]);
}

test("lectura: cada celda lleva el `align` de su columna, encabezado incluido", () => {
  assert.deepEqual(celdas(renderNota(TABLA, true)), [
    ["th", "left"],
    ["th", "center"],
    ["th", "right"],
    ["th", null],
    ["td", "left"],
    ["td", "center"],
    ["td", "right"],
    ["td", null],
  ]);
});

test("lectura: la alineación se emite como atributo, no como `style`", () => {
  // El CSS de abajo depende del atributo; un `style` en línea esquivaría la regla.
  assert.doesNotMatch(renderNota(TABLA), /<t[hd][^>]*style=/);
});

/** Declaraciones de la regla cuyo selector es exactamente esa lista. */
function reglaDe(selectores) {
  const sinComentarios = css.replace(/\/\*[\s\S]*?\*\//g, "");
  for (const m of sinComentarios.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const lista = m[1].split(",").map((s) => s.trim().replace(/\s+/g, " "));
    if (lista.length === selectores.length && selectores.every((s) => lista.includes(s))) {
      return m[2];
    }
  }
  return null;
}

for (const [valor, alineacion] of [
  ["center", "center"],
  ["right", "right"],
]) {
  test(`editor.css: \`align="${valor}"\` se respeta en \`.mic-preview\``, () => {
    const decl = reglaDe([
      `.mic-preview th[align="${valor}"]`,
      `.mic-preview td[align="${valor}"]`,
    ]);
    assert.ok(decl, `falta la regla de align="${valor}" en styles/editor.css`);
    assert.match(decl, new RegExp(`text-align:\\s*${alineacion}\\s*;`));
  });
}

test("editor.css: la regla base sigue alineando a la izquierda (`:---` y sin marca)", () => {
  const decl = reglaDe([".mic-preview th", ".mic-preview td"]);
  assert.ok(decl, "falta la regla base de celdas en styles/editor.css");
  assert.match(decl, /text-align:\s*left\s*;/);
});
