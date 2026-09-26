// Test headless (sin navegador ni Tauri) de `lib/wikilinks.ts`: el partidor de
// `[[wikilinks]]` (`DEF-045`) y el resolutor único que comparten el editor y el
// grafo (`FUN-M-40`, D8). Cada módulo se transpila en el momento y se importa
// vía data: URL, con sus imports reemplazados por los módulos ya transpilados
// (todos puros), igual que `scripts/test-capa-datos.mjs`. El grafo
// (`lib/db/grafo.ts`) se prueba entero, con un doble del executor SQL.
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
const ERRORS = await fuente("../lib/db/errors.ts");
const CLIENT = await fuente("../lib/db/client.ts", { "./errors": ERRORS });
const GRAFO = await fuente("../lib/db/grafo.ts", {
  "@/lib/canvas": await fuente("../lib/canvas.ts"),
  "@/lib/frontmatter": await fuente("../lib/frontmatter.ts"),
  "@/lib/sinCodigo": await fuente("../lib/sinCodigo.ts"),
  "@/lib/wikilinks": WIKILINKS,
  "./client": CLIENT,
  "./errors": ERRORS,
});

const { partirWikilink, resolveWikilink, resolveWikilinkEnIndice, indexarPorTitulo, refUnivoca, EXCALIDRAW_RE } =
  await import(WIKILINKS);
const client = await import(CLIENT);
const grafoDb = await import(GRAFO);

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

/** Executor SQL de mentira: responde las consultas de `lib/db/grafo.ts`. */
function indiceDelVault(contenidos) {
  return {
    async select(sql, params = []) {
      if (sql.includes("FROM notas n LEFT JOIN contenidos")) {
        return NOTAS.map((n) => ({
          id: n.id,
          titulo: n.titulo,
          carpeta_id: n.carpetaId,
          creado_en: "2026-09-26",
          tipo: n.tipo,
          contenido: contenidos[n.id] ?? null,
        }));
      }
      if (sql.includes("FROM carpetas")) {
        return CARPETAS.map((c) => ({ id: c.id, nombre: c.nombre, padre_id: c.padreId }));
      }
      if (sql.includes("FROM notas WHERE id = ?")) {
        const n = NOTAS.find((x) => x.id === params[0]);
        return n
          ? [{ id: n.id, vault_id: "v", titulo: n.titulo, carpeta_id: n.carpetaId, creado_en: "", actualizado_en: "", tamano_bytes: 0 }]
          : [];
      }
      throw new Error(`consulta inesperada: ${sql}`);
    },
    async execute() {
      throw new Error("el grafo no escribe");
    },
  };
}

test("con homónimas, la arista va a la misma nota que el clic (criterio de D8)", async () => {
  const texto = "[[Plan]] · [[Proyectos/Plan|el de proyectos]] · [[2025/Plan]] · [[Idea]]";
  client.setExecutor(indiceDelVault({ "Zeta/Idea.md": "nada", "Alfa/Idea.md": texto }));
  const { aristas } = await grafoDb.grafo("v");
  const salientes = aristas
    .filter((a) => a.source === "Alfa/Idea.md")
    .map((a) => a.target)
    .sort();
  const delEditor = ["Plan", "Proyectos/Plan", "2025/Plan"].map((ref) => id(ref)).sort();
  assert.deepEqual(salientes, delEditor);
  // `[[Idea]]` desde `Alfa/Idea` resuelve a sí misma: no es una arista.
  assert.equal(salientes.includes("Alfa/Idea.md"), false);
  client.setExecutor(null);
});

test("un embed ![[x.excalidraw]] cuenta como arista y como conexión", async () => {
  client.setExecutor(indiceDelVault({ "Plan.md": "# Plan\n\n![[Boceto.excalidraw]]\n" }));
  const { aristas } = await grafoDb.grafo("v");
  assert.deepEqual(
    aristas.filter((a) => a.source === "Plan.md"),
    [{ source: "Plan.md", target: "Proyectos/Boceto.excalidraw" }],
  );
  const con = await grafoDb.conexiones("Proyectos/Boceto.excalidraw");
  assert.deepEqual(con.retro.map((r) => r.id), ["Plan.md"]);
  client.setExecutor(null);
});
