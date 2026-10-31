// Test headless de `lib/menuNota.ts` (`FUN-S-32`): las carpetas que ofrece
// «Mover a…» y el enlace que copia «Copiar enlace». Se transpilan los módulos
// puros en el momento, igual que `test-homonimos.mjs`.
//
//   node --test scripts/test-menu-nota.mjs
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import ts from "typescript";

const aUrl = (codigo) => `data:text/javascript,${encodeURIComponent(codigo)}`;

async function fuente(ruta, mapa = {}) {
  const texto = await readFile(fileURLToPath(new URL(ruta, import.meta.url)), "utf8");
  let { outputText } = ts.transpileModule(texto, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 },
  });
  for (const [especificador, url] of Object.entries(mapa)) {
    outputText = outputText.split(`"${especificador}"`).join(`"${url}"`);
  }
  return aUrl(outputText);
}

const EXTENSIONES = await fuente("../lib/extensionesDeTipo.ts");
const WIKILINKS = await fuente("../lib/wikilinks.ts", { "@/lib/extensionesDeTipo": EXTENSIONES });
const { destinosDeMover, enlaceANota } = await import(
  await fuente("../lib/menuNota.ts", {
    "@/lib/extensionesDeTipo": EXTENSIONES,
    "@/lib/wikilinks": WIKILINKS,
  })
);

const CARPETAS = [
  { id: "Proyectos", nombre: "Proyectos", padreId: null },
  { id: "Proyectos/Activos", nombre: "Activos", padreId: "Proyectos" },
  { id: "Árboles", nombre: "Árboles", padreId: null },
  { id: "Archivo", nombre: "Archivo", padreId: null },
];

const ids = (destinos) => destinos.map((d) => d.id);

test("ofrece la raíz primero y las carpetas por ruta (sin distinguir tildes), sin la actual", () => {
  assert.deepEqual(ids(destinosDeMover(CARPETAS, { actual: "Proyectos" })), [
    null,
    "Árboles",
    "Archivo",
    "Proyectos/Activos",
  ]);
  assert.equal(destinosDeMover(CARPETAS, { actual: null })[0].id, "Árboles", "desde la raíz no se ofrece la raíz");
  const activos = destinosDeMover(CARPETAS, { actual: null }).find((d) => d.id === "Proyectos/Activos");
  assert.equal(activos.ruta, "Proyectos/Activos");
});

test("al mover una carpeta no se ofrece ella ni su subárbol", () => {
  const excluir = new Set(["Proyectos", "Proyectos/Activos"]);
  assert.deepEqual(ids(destinosDeMover(CARPETAS, { actual: null, excluir })), ["Árboles", "Archivo"]);
});

test("filtra por palabras, sin tildes ni mayúsculas", () => {
  assert.deepEqual(ids(destinosDeMover(CARPETAS, { actual: null }, "arbol")), ["Árboles"]);
  assert.deepEqual(ids(destinosDeMover(CARPETAS, { actual: null }, "proy act")), ["Proyectos/Activos"]);
  assert.deepEqual(ids(destinosDeMover(CARPETAS, { actual: "Archivo" }, "raíz")), [null]);
  assert.deepEqual(destinosDeMover(CARPETAS, { actual: null }, "nada así"), []);
});

const nota = (id, tipo = "markdown") => {
  const partes = id.split("/");
  const archivo = partes.pop();
  return { id, titulo: archivo.replace(/\.[^.]+$/, ""), carpetaId: partes.join("/") || null, tipo };
};

test("Copiar enlace: el título solo, o con la carpeta si hay homónimas", () => {
  const plan = nota("Proyectos/Plan.md");
  const unica = [plan, nota("Idea.md")];
  assert.equal(enlaceANota(plan, unica, CARPETAS), "[[Plan]]");
  const otra = nota("Archivo/Plan.md");
  assert.equal(enlaceANota(plan, [plan, otra], CARPETAS), "[[Proyectos/Plan]]");
});

test("Copiar enlace: lienzos, dibujos, bases y diagramas llevan su extensión", () => {
  const mapa = nota("Mapa.canvas", "canvas");
  const notaMapa = nota("Mapa.md");
  assert.equal(enlaceANota(mapa, [mapa, notaMapa], CARPETAS), "[[Mapa.canvas]]");
  const boceto = nota("Proyectos/Boceto.excalidraw", "excalidraw");
  const otro = nota("Archivo/Boceto.excalidraw", "excalidraw");
  assert.equal(enlaceANota(boceto, [boceto, otro], CARPETAS), "[[Proyectos/Boceto.excalidraw]]");
});
