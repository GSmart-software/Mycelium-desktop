// Test headless de `lib/enlaceRoto.ts` (`FUN-S-31`): qué nota —y en qué
// carpeta— crea el clic en un `[[enlace]]` a una nota que no existe. Se
// transpilan los módulos puros en el momento, igual que `test-homonimos.mjs`.
//
//   node --test scripts/test-enlace-roto.mjs
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
const NOMBRES = await fuente("../lib/db/nombres.ts");
const WIKILINKS = await fuente("../lib/wikilinks.ts", { "@/lib/extensionesDeTipo": EXTENSIONES });
const { planDeEnlaceRoto } = await import(
  await fuente("../lib/enlaceRoto.ts", {
    "@/lib/extensionesDeTipo": EXTENSIONES,
    "@/lib/db/nombres": NOMBRES,
    "@/lib/wikilinks": WIKILINKS,
  })
);

// Proyectos/ · Proyectos/Activos/ · Archivo/Proyectos/
const CARPETAS = [
  { id: "Proyectos", nombre: "Proyectos", padreId: null },
  { id: "Proyectos/Activos", nombre: "Activos", padreId: "Proyectos" },
  { id: "Archivo", nombre: "Archivo", padreId: null },
  { id: "Archivo/Proyectos", nombre: "Proyectos", padreId: "Archivo" },
];

test("sin ruta, va a la carpeta por defecto (la raíz si no hay)", () => {
  assert.deepEqual(planDeEnlaceRoto("Idea nueva", CARPETAS), {
    carpetaId: null,
    crearCarpetas: [],
    titulo: "Idea nueva",
    tipo: "markdown",
  });
  assert.equal(planDeEnlaceRoto("Idea", CARPETAS, "Archivo").carpetaId, "Archivo");
});

test("con ruta a una carpeta que existe, se crea ahí (la menos profunda si calzan varias)", () => {
  const plan = planDeEnlaceRoto("Proyectos/Plan", CARPETAS);
  assert.equal(plan.carpetaId, "Proyectos", "Proyectos le gana a Archivo/Proyectos");
  assert.equal(plan.titulo, "Plan");
  assert.deepEqual(plan.crearCarpetas, []);
  assert.equal(planDeEnlaceRoto("proyectos/activos/Plan", CARPETAS).carpetaId, "Proyectos/Activos");
  assert.equal(planDeEnlaceRoto("Archivo/Proyectos/Plan", CARPETAS).carpetaId, "Archivo/Proyectos");
});

test("con ruta a carpetas que no existen, se crean las que faltan desde la raíz", () => {
  assert.deepEqual(planDeEnlaceRoto("Proyectos/Nuevos/Ideas/Plan", CARPETAS), {
    carpetaId: "Proyectos",
    crearCarpetas: ["Nuevos", "Ideas"],
    titulo: "Plan",
    tipo: "markdown",
  });
  assert.deepEqual(planDeEnlaceRoto("Viajes/Plan", CARPETAS).crearCarpetas, ["Viajes"]);
  assert.equal(planDeEnlaceRoto("Viajes/Plan", CARPETAS).carpetaId, null);
});

test("el nombre se sanea como el de cualquier nota nueva", () => {
  assert.equal(planDeEnlaceRoto('¿Qué: es "esto"?', CARPETAS).titulo, "¿Qué- es -esto--");
  assert.equal(planDeEnlaceRoto("a*b|c<d>e\\f", CARPETAS).titulo, "a-b-c-d-e-f");
  assert.equal(planDeEnlaceRoto("  Espacios   de más  ", CARPETAS).titulo, "Espacios de más");
  assert.equal(planDeEnlaceRoto("???", CARPETAS), null, "si no queda nada, no se crea");
  assert.equal(planDeEnlaceRoto("", CARPETAS), null);
  assert.equal(planDeEnlaceRoto(" / ", CARPETAS), null);
});

test("la extensión decide el tipo; una imagen o un PDF no son notas", () => {
  assert.deepEqual(planDeEnlaceRoto("Plan.md", CARPETAS).titulo, "Plan");
  assert.equal(planDeEnlaceRoto("Mapa.canvas", CARPETAS).tipo, "canvas");
  assert.equal(planDeEnlaceRoto("Mapa.canvas", CARPETAS).titulo, "Mapa");
  assert.equal(planDeEnlaceRoto("Boceto.excalidraw", CARPETAS).tipo, "excalidraw");
  assert.equal(planDeEnlaceRoto("notas.de.ayer", CARPETAS).titulo, "notas.de.ayer");
  assert.equal(planDeEnlaceRoto("foto.png", CARPETAS), null);
  assert.equal(planDeEnlaceRoto("Manual.PDF", CARPETAS), null);
});
