// Test headless de los diagnósticos del editor (`FUN-M-44`): de los resultados
// de la salud de una nota y de sus avisos de propiedades a marcas con línea,
// columna y rango, como las de un linter. La lógica pura de `lib/diagnosticos.ts`.
//
//   node --test scripts/test-diagnosticos.mjs
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import ts from "typescript";

const aUrl = (codigo) => `data:text/javascript,${encodeURIComponent(codigo)}`;

async function fuente(ruta, mapa = {}) {
  const texto = await readFile(fileURLToPath(new URL(ruta, import.meta.url)), "utf8");
  let { outputText } = ts.transpileModule(texto, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  });
  for (const [especificador, url] of Object.entries(mapa)) {
    outputText = outputText.split(`"${especificador}"`).join(`"${url}"`);
  }
  return aUrl(outputText);
}

const FRONTMATTER = await fuente("../lib/frontmatter.ts");
const EXTENSIONES = await fuente("../lib/extensionesDeTipo.ts");
const ESQUEMAS = await fuente("../lib/esquemas.ts", { "@/lib/bases": await fuente("../lib/bases.ts"), "@/lib/frontmatter": FRONTMATTER });
const D = await import(
  await fuente("../lib/diagnosticos.ts", {
    "@/lib/esquemas": ESQUEMAS,
    "@/lib/frontmatter": FRONTMATTER,
    "@/lib/sinCodigo": await fuente("../lib/sinCodigo.ts"),
    "@/lib/wikilinks": await fuente("../lib/wikilinks.ts", { "@/lib/extensionesDeTipo": EXTENSIONES }),
  })
);
const E = await import(ESQUEMAS);

const NOTA = "Mapa.md";
const TEXTO = [
  "---", // 1
  "estado: raro", // 2
  "Issue: #24", // 3
  "---", // 4
  "# Mapa", // 5
  "Ver [[Fantasma|el fantasma]] y [[Plan]].", // 6
  "```", // 7
  "[[Fantasma]] en código no cuenta", // 8
  "```", // 9
  "  ![[Falta.excalidraw]] y otra vez [[Fantasma]]", // 10
].join("\n");

const vacio = { rotos: [], embedsRotos: [], duplicados: [], propiedades: [] };
const sinRango = (d) => ({ origen: d.origen, linea: d.linea, columna: d.columna, texto: TEXTO.slice(d.desde, d.hasta) });

test("enlace roto: cada aparición fuera del código, con línea, columna y rango", () => {
  const ds = D.diagnosticosDeNota({
    ...vacio,
    notaId: NOTA,
    texto: TEXTO,
    rotos: [{ desde: NOTA, texto: "Fantasma", tipo: "enlace" }],
  });
  assert.deepEqual(ds.map(sinRango), [
    { origen: "enlace_roto", linea: 6, columna: 5, texto: "[[Fantasma|el fantasma]]" },
    { origen: "enlace_roto", linea: 10, columna: 36, texto: "[[Fantasma]]" },
  ]);
  assert.match(ds[0].mensaje, /no hay ninguna nota «Fantasma»/);
});

test("embed roto: el rango incluye el !; los problemas de otra nota no se marcan", () => {
  const ds = D.diagnosticosDeNota({
    ...vacio,
    notaId: NOTA,
    texto: TEXTO,
    embedsRotos: [{ desde: NOTA, texto: "Falta.excalidraw", tipo: "embed" }],
    rotos: [{ desde: "Otra.md", texto: "Plan", tipo: "enlace" }],
  });
  assert.deepEqual(ds.map(sinRango), [{ origen: "embed_roto", linea: 10, columna: 3, texto: "![[Falta.excalidraw]]" }]);
});

test("título duplicado en la primera línea del cuerpo y enlace ambiguo en su enlace", () => {
  const ds = D.diagnosticosDeNota({
    ...vacio,
    notaId: NOTA,
    texto: TEXTO,
    duplicados: [
      { titulo: "Mapa", rutas: ["Mapa.md", "viejo/Mapa.md"], ambiguos: [] },
      { titulo: "Plan", rutas: ["a/Plan.md", "b/Plan.md"], ambiguos: [{ desde: NOTA, texto: "Plan", tipo: "enlace" }] },
    ],
  });
  assert.deepEqual(ds.map(sinRango), [
    { origen: "titulo_duplicado", linea: 5, columna: 1, texto: "# Mapa" },
    { origen: "enlace_ambiguo", linea: 6, columna: 32, texto: "[[Plan]]" },
  ]);
  assert.match(ds[0].mensaje, /otra nota se llama «Mapa» \(viejo\/Mapa\.md\)/);
  assert.match(ds[1].mensaje, /\[\[Carpeta\/Plan\]\]/);
});

test("propiedades: cada aviso de esquemas y del # en su línea, sin la sangría", () => {
  const { esquemas } = E.parsearEsquemas("P:\n  propiedades:\n    estado:\n      valores: [activo]\n");
  const avisos = E.validarPropiedades({ id: NOTA, carpetaId: null, tipo: "markdown" }, TEXTO, esquemas);
  const ds = D.diagnosticosDeNota({ ...vacio, notaId: NOTA, texto: TEXTO, propiedades: avisos });
  assert.deepEqual(ds.map(sinRango), [
    { origen: "propiedad", linea: 2, columna: 1, texto: "estado: raro" },
    { origen: "propiedad", linea: 3, columna: 1, texto: "Issue: #24" },
  ]);
  assert.match(ds[0].mensaje, /no admite «raro».*\(esquema «P»\)$/);
});

test("sin problemas no hay diagnósticos; el resumen cuenta", () => {
  assert.deepEqual(D.diagnosticosDeNota({ ...vacio, notaId: NOTA, texto: TEXTO }), []);
  assert.equal(D.resumenDiagnosticos(0), "Sin avisos");
  assert.equal(D.resumenDiagnosticos(1), "1 aviso");
  assert.equal(D.resumenDiagnosticos(3), "3 avisos");
});

test("CRLF: la columna y el rango de una línea no incluyen el \\r", () => {
  const texto = "a\r\n  linea dos\r\nc";
  const ds = D.diagnosticosDeNota({
    ...vacio,
    notaId: NOTA,
    texto,
    propiedades: [{ clase: "falta", clave: "x", linea: 2, mensaje: "m", esquemas: [] }],
  });
  assert.equal(ds.length, 1);
  assert.equal(texto.slice(ds[0].desde, ds[0].hasta), "linea dos");
  assert.equal(ds[0].columna, 3);
});

test("diagnosticoParaIa: línea, columna, origen y mensaje, sin offsets", () => {
  const d = { origen: "enlace_roto", linea: 2, columna: 4, desde: 10, hasta: 20, mensaje: "x" };
  assert.deepEqual(D.diagnosticoParaIa(d), { linea: 2, columna: 4, origen: "enlace_roto", mensaje: "x" });
});
