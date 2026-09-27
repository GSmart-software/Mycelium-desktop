// Test headless (sin navegador ni Tauri) de `lib/wikilinks.ts`: el partidor de
// `[[wikilinks]]` (`DEF-045`) y el resolutor único que comparten el editor y el
// grafo (`FUN-M-40`, D8). Cada módulo se transpila en el momento y se importa
// vía data: URL, con sus imports reemplazados por los módulos ya transpilados
// (todos puros), igual que `scripts/test-capa-datos.mjs`. Del grafo se prueba
// la resolución de la tabla `enlaces` (`lib/enlacesNota.ts`); sus consultas, en
// `scripts/test-enlaces-nota.mjs`.
//
//   node --test scripts/test-wikilinks.mjs
//   node scripts/test-wikilinks.mjs
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import ts from "typescript";

const aUrl = (codigo) => `data:text/javascript,${encodeURIComponent(codigo)}`;

/** Transpila un `.ts` del repo y reemplaza sus imports según `mapa`. */
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
const ENLACES_NOTA = await fuente("../lib/enlacesNota.ts", {
  "@/lib/canvas": await fuente("../lib/canvas.ts"),
  "@/lib/extensionesDeTipo": EXTENSIONES,
  "@/lib/frontmatter": await fuente("../lib/frontmatter.ts"),
  "@/lib/sinCodigo": await fuente("../lib/sinCodigo.ts"),
  "@/lib/wikilinks": WIKILINKS,
});

const { partirWikilink, resolveWikilink, resolveWikilinkEnIndice, indexarPorTitulo, refUnivoca, EXCALIDRAW_RE } =
  await import(WIKILINKS);
const enlacesNota = await import(ENLACES_NOTA);

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

test("la ruta de carpetas se conserva al partir: es la pista del resolutor", () => {
  assert.equal(partirWikilink("Carpeta/Sub/Nota" + ESC + "x").destino, "Carpeta/Sub/Nota");
  assert.equal(partirWikilink("Carpeta/Sub/Nota|x").destino, "Carpeta/Sub/Nota");
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

// ── Resolutor único (`FUN-M-40`, D8) ──────────────────────────────────────────
//
// Un vault con homónimas: `Plan` en la raíz, en `Proyectos` y en `Archivo/2025`;
// `Idea` en dos carpetas a la misma altura; y un dibujo `Boceto.excalidraw`.

const CARPETAS = [
  { id: "Proyectos", nombre: "Proyectos", padreId: null },
  { id: "Archivo", nombre: "Archivo", padreId: null },
  { id: "Archivo/2025", nombre: "2025", padreId: "Archivo" },
  { id: "Zeta", nombre: "Zeta", padreId: null },
  { id: "Alfa", nombre: "Alfa", padreId: null },
];
// El orden de la lista es a propósito el «malo»: la más profunda primero.
const NOTAS = [
  { id: "Archivo/2025/Plan.md", titulo: "Plan", carpetaId: "Archivo/2025", tipo: "markdown" },
  { id: "Proyectos/Plan.md", titulo: "Plan", carpetaId: "Proyectos", tipo: "markdown" },
  { id: "Plan.md", titulo: "Plan", carpetaId: null, tipo: "markdown" },
  { id: "Zeta/Idea.md", titulo: "Idea", carpetaId: "Zeta", tipo: "markdown" },
  { id: "Alfa/Idea.md", titulo: "Idea", carpetaId: "Alfa", tipo: "markdown" },
  { id: "Proyectos/Boceto.excalidraw", titulo: "Boceto", carpetaId: "Proyectos", tipo: "excalidraw" },
];
const id = (ref, notas = NOTAS) => resolveWikilink(ref, notas, CARPETAS)?.id;

test("sin pista, entre homónimas gana la de ruta más corta", () => {
  assert.equal(id("Plan"), "Plan.md");
  assert.equal(id("plan"), "Plan.md", "sin distinguir mayúsculas");
});

test("la pista de carpeta elige entre homónimas, aunque sea parcial", () => {
  assert.equal(id("Proyectos/Plan"), "Proyectos/Plan.md");
  assert.equal(id("2025/Plan"), "Archivo/2025/Plan.md");
  assert.equal(id("Archivo/2025/Plan"), "Archivo/2025/Plan.md");
  assert.equal(id("proyectos/plan"), "Proyectos/Plan.md");
  assert.equal(id("NoExiste/Plan"), "Plan.md", "una pista que no calza no impide resolver");
});

test("la extensión del archivo no forma parte del título", () => {
  assert.equal(id("Boceto.excalidraw"), "Proyectos/Boceto.excalidraw");
  assert.equal(id("Proyectos/Boceto.excalidraw"), "Proyectos/Boceto.excalidraw");
  assert.equal(id("Plan.md"), "Plan.md");
  assert.equal(id("Plan.de.ayer"), undefined, "`de.ayer` no es una extensión de nota");
});

test("un empate a la misma altura se decide por la ruta, no por el orden de la lista", () => {
  assert.equal(id("Idea"), "Alfa/Idea.md");
  assert.equal(id("Idea", [...NOTAS].reverse()), "Alfa/Idea.md");
});

test("la variante indexada da lo mismo que la de lista", () => {
  const indice = indexarPorTitulo(NOTAS);
  for (const ref of ["Plan", "Proyectos/Plan", "2025/Plan", "Idea", "Boceto.excalidraw", "Nada", ""]) {
    assert.equal(resolveWikilinkEnIndice(ref, indice, CARPETAS)?.id, id(ref), ref);
  }
});

test("refUnivoca: el título solo si nadie más se llama así, y si no la ruta", () => {
  const boceto = NOTAS.find((n) => n.id === "Proyectos/Boceto.excalidraw");
  assert.equal(refUnivoca(boceto, NOTAS, CARPETAS), "Boceto");
  const plan = NOTAS.find((n) => n.id === "Archivo/2025/Plan.md");
  assert.equal(refUnivoca(plan, NOTAS, CARPETAS), "Archivo/2025/Plan");
  // Y lo que devuelve vuelve a la misma nota: es lo que inserta el editor.
  for (const n of NOTAS) assert.equal(id(refUnivoca(n, NOTAS, CARPETAS)), n.id, n.id);
});

test("EXCALIDRAW_RE captura la referencia sin la extensión, con su ruta", () => {
  const refs = [..."![[Boceto.excalidraw]] y ![[Proyectos/Otro.excalidraw]]".matchAll(EXCALIDRAW_RE)];
  assert.deepEqual(refs.map((m) => m[1]), ["Boceto", "Proyectos/Otro"]);
});

// ── El grafo resuelve igual que el editor ─────────────────────────────────────
//
// Desde `FUN-L-25` el grafo lee la tabla `enlaces`, que se llena con
// `derivarEnlaces` + `resolverEnlace` (`lib/enlacesNota.ts`). Lo que se prueba
// acá es esa resolución: la misma que el clic del editor. Las consultas SQL y
// la comparación contra el escaneo de antes están en `test-enlaces-nota.mjs`.

/** Las aristas que saldrían de estas notas: sin lazos y sin repetir. */
function aristasDe(contenidos) {
  const porTitulo = indexarPorTitulo(NOTAS);
  const ids = new Set(NOTAS.map((n) => n.id));
  const vistas = new Set();
  const aristas = [];
  for (const n of NOTAS) {
    for (const e of enlacesNota.derivarEnlaces(contenidos[n.id] ?? "", n.tipo)) {
      const d = enlacesNota.resolverEnlace(e, porTitulo, CARPETAS, ids);
      if (d === null || d === n.id || vistas.has(`${n.id}>${d}`)) continue;
      vistas.add(`${n.id}>${d}`);
      aristas.push({ source: n.id, target: d });
    }
  }
  return aristas;
}

test("con homónimas, la arista va a la misma nota que el clic (criterio de D8)", () => {
  const texto = "[[Plan]] · [[Proyectos/Plan|el de proyectos]] · [[2025/Plan]] · [[Idea]]";
  const salientes = aristasDe({ "Zeta/Idea.md": "nada", "Alfa/Idea.md": texto })
    .filter((a) => a.source === "Alfa/Idea.md")
    .map((a) => a.target)
    .sort();
  const delEditor = ["Plan", "Proyectos/Plan", "2025/Plan"].map((ref) => id(ref)).sort();
  assert.deepEqual(salientes, delEditor);
  // `[[Idea]]` desde `Alfa/Idea` resuelve a sí misma: no es una arista.
  assert.equal(salientes.includes("Alfa/Idea.md"), false);
});

test("un embed ![[x.excalidraw]] cuenta como arista", () => {
  const aristas = aristasDe({ "Plan.md": "# Plan\n\n![[Boceto.excalidraw]]\n" });
  assert.deepEqual(
    aristas.filter((a) => a.source === "Plan.md"),
    [{ source: "Plan.md", target: "Proyectos/Boceto.excalidraw" }],
  );
});
