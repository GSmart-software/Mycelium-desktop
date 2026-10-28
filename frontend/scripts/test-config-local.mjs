// Test headless de lo que pasa a decidirse en la máquina y no en el vault
// (`DEF-164`, `DEF-169`): qué snippets se aplican al abrir un vault y que el CSS
// de un snippet no pueda romper el documento de impresión. La migración y los
// comandos se prueban en Rust (`src-tauri/src/config_local.rs`).
//
//   node --test scripts/test-config-local.mjs
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

const { snippetsDelArchivo } = await import(await fuente("../lib/snippetsArchivo.ts"));
const { armarDocumentoImpresion, cssParaHtml } = await import(await fuente("../lib/printStyles.ts"));

const ARCHIVO = {
  version: 1,
  snippets: [
    { id: "a", nombre: "A", activo: true, contenido: "body{color:red}" },
    { id: "b", nombre: "B", activo: false, contenido: "x{}" },
    { id: "c", nombre: "C", contenido: "y{}" },
  ],
};

test("un vault nunca visto: sus snippets llegan apagados y marcados como traídos", () => {
  const s = snippetsDelArchivo(ARCHIVO, {});
  assert.equal(s.length, 3);
  assert.ok(s.every((x) => x.activo === false), "el `activo` del archivo no enciende nada");
  assert.ok(s.every((x) => x.traido === true));
});

test("un vault conocido: manda lo que decidió esta máquina", () => {
  const s = snippetsDelArchivo(ARCHIVO, { a: true, b: false, c: true });
  assert.deepEqual(
    s.map((x) => [x.id, x.activo, x.traido ?? false]),
    [["a", true, false], ["b", false, false], ["c", true, false]],
  );
  // Aunque el archivo diga lo contrario.
  const t = snippetsDelArchivo(ARCHIVO, { a: false });
  assert.equal(t[0].activo, false);
  assert.equal(t[1].traido, true, "b no se decidió: sigue traído");
});

test("un archivo editado a mano no rompe nada", () => {
  assert.deepEqual(snippetsDelArchivo(null, {}), []);
  assert.deepEqual(snippetsDelArchivo({ snippets: "no" }, {}), []);
  assert.deepEqual(snippetsDelArchivo({ snippets: [null, { id: 1 }, { id: "x" }] }, { x: true }), []);
});

const OPTS = { estilosMycelium: true, fondoBlanco: false, colores: true, callouts: true };

test("un snippet con </style> no cierra la hoja del documento de impresión", () => {
  const malo = `.x::before{content:"</style><img src=x onerror=alert(1)>"} /* </STYLE> */`;
  const html = armarDocumentoImpresion({
    css: malo,
    atributos: {},
    html: "<p>hola</p>",
    titulo: "Nota",
    pageSize: "A4",
    opts: OPTS,
  });
  // Solo los dos cierres que pone el propio documento.
  assert.equal(html.match(/<\/style/gi).length, 2, html);
  assert.doesNotMatch(html, /<img/i);
  // El CSS sigue diciendo lo mismo: `\3c ` es `<` para el parser de CSS.
  assert.ok(html.includes(`content:"\\3c /style>\\3c img`), html);
});

test("cssParaHtml solo toca los `<`", () => {
  assert.equal(cssParaHtml("a > b { color: red }"), "a > b { color: red }");
  assert.equal(cssParaHtml("<!--"), "\\3c !--");
});

test("con el CSS de la app, el documento de impresión suelta el alto con y sin «Estilos de Mycelium» (DEF-170)", () => {
  // `globals.css` deja `html, body { height: 100% }`: sin soltarlo, Chromium
  // imprimía una sola página, la que entraba en el scroll.
  for (const estilosMycelium of [true, false]) {
    const html = armarDocumentoImpresion({
      css: "html, body { height: 100%; overflow-x: hidden; }",
      atributos: {},
      html: "<p>x</p>",
      titulo: "t",
      pageSize: "A4",
      opts: { fondoBlanco: true, colores: false, callouts: true, estilosMycelium },
    });
    assert.match(html, /html, body \{ height: auto !important;[^}]*overflow: visible !important/, `estilosMycelium: ${estilosMycelium}`);
  }
});
