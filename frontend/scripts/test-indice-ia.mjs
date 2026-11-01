// Test headless de las lecturas del índice que usan el MCP (`FUN-M-45`) y la
// salud del vault (`FUN-L-30`), contra un SQLite de verdad indexado por el
// indexador de la app: las filas de `enlaces` tal como quedan (`lib/db/indiceIa.ts`)
// y la búsqueda paginada (`lib/db/buscar.ts`, página dos = continuación exacta
// de la uno).
//
// Necesita `better-sqlite3`, como `test-busqueda-propiedades.mjs`: se busca en
// `node_modules` y, si no, en la carpeta que diga `MYCELIUM_BETTER_SQLITE3`;
// sin él, los tests se SALTAN (y lo dicen).
//
//   MYCELIUM_BETTER_SQLITE3=/ruta/a/node_modules/better-sqlite3 node --test scripts/test-indice-ia.mjs
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import ts from "typescript";

const aUrl = (codigo) => `data:text/javascript,${encodeURIComponent(codigo)}`;

/** Transpila un `.ts` del repo y reemplaza sus imports según `mapa`. */
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

const TAURI = aUrl(`export const invoke = (cmd, args) => globalThis.__invoke(cmd, args);`);
const EXTENSIONES = await fuente("../lib/extensionesDeTipo.ts");
const WIKILINKS = await fuente("../lib/wikilinks.ts", { "@/lib/extensionesDeTipo": EXTENSIONES });
const FRONTMATTER = await fuente("../lib/frontmatter.ts");
const ENLACES_NOTA = await fuente("../lib/enlacesNota.ts", {
  "@/lib/canvas": await fuente("../lib/canvas.ts"),
  "@/lib/extensionesDeTipo": EXTENSIONES,
  "@/lib/frontmatter": FRONTMATTER,
  "@/lib/sinCodigo": await fuente("../lib/sinCodigo.ts"),
  "@/lib/wikilinks": WIKILINKS,
});
const ERRORS = await fuente("../lib/db/errors.ts");
const CLIENT = await fuente("../lib/db/client.ts", { "./errors": ERRORS });
const UTIL = await fuente("../lib/db/util.ts");
const CONTEXTO = await fuente("../lib/db/vaultContext.ts", { "./errors": ERRORS });
const FTS = await fuente("../lib/db/fts.ts");
const FTS_INDICE = await fuente("../lib/db/ftsIndice.ts", { "./client": CLIENT });
const ENLACES_INDICE = await fuente("../lib/db/enlacesIndice.ts", {
  "@/lib/enlacesNota": ENLACES_NOTA,
  "@/lib/wikilinks": WIKILINKS,
  "./client": CLIENT,
  "./fts": FTS,
  "./ftsIndice": FTS_INDICE,
  "./util": UTIL,
});
const PROPIEDADES = await fuente("../lib/db/propiedades.ts", {
  "@/lib/textoBuscable": await fuente("../lib/textoBuscable.ts", { "@/lib/canvas": await fuente("../lib/canvas.ts") }),
  "@/lib/frontmatter": FRONTMATTER,
  "./client": CLIENT,
  "./fts": FTS,
  "./util": UTIL,
});
const INDEXER = await fuente("../lib/db/indexer.ts", {
  "@/lib/enlacesNota": ENLACES_NOTA,
  "@/lib/otrosArchivos": await fuente("../lib/otrosArchivos.ts", {
    "@tauri-apps/api/core": TAURI,
    "@/lib/imagenes": await fuente("../lib/imagenes.ts"),
  }),
  "@tauri-apps/api/core": TAURI,
  "./client": CLIENT,
  "./enlacesIndice": ENLACES_INDICE,
  "./ftsIndice": FTS_INDICE,
  "./propiedades": PROPIEDADES,
  "./util": UTIL,
  "./vaultContext": CONTEXTO,
});
const BUSCAR = await fuente("../lib/db/buscar.ts", { "./client": CLIENT, "./fts": FTS });
const INDICE_IA = await fuente("../lib/db/indiceIa.ts", { "./client": CLIENT });

let Database = null;
try {
  Database = createRequire(import.meta.url)("better-sqlite3");
} catch {
  const ruta = process.env.MYCELIUM_BETTER_SQLITE3;
  if (ruta) Database = createRequire(import.meta.url)(ruta);
}
const sinSqlite = Database === null ? "falta better-sqlite3 (ver la cabecera)" : false;

const client = await import(CLIENT);
const contexto = await import(CONTEXTO);
const indexer = await import(INDEXER);
const { buscar } = await import(BUSCAR);
const indiceIa = await import(INDICE_IA);
const { LOCAL_VAULT_ID } = contexto;

/** Executor sobre un SQLite en memoria. */
function executorDe(db) {
  return {
    async select(sql, params = []) {
      return db.prepare(sql).all(...params);
    },
    async execute(sql, params = []) {
      const st = db.prepare(sql);
      if (st.reader) return (st.all(...params), { rowsAffected: 0 });
      return { rowsAffected: st.run(...params).changes };
    },
  };
}

/** El tipo de un archivo por su extensión, como lo reporta `recorrer_vault`. */
const tipoDe = (ruta) => /\.(canvas|excalidraw|drawio|base)$/.exec(ruta)?.[1] ?? "markdown";

/** Los comandos Rust del indexado, sobre un vault en memoria. */
function vaultEnMemoria(archivos) {
  globalThis.__invoke = async (cmd, a) => {
    switch (cmd) {
      case "recorrer_vault":
        return {
          archivosMeta: Object.keys(archivos).map((r, i) => ({ rutaRelativa: r, mtime: 1000 + i, tipo: tipoDe(r) })),
          otros: [],
          directorios: [],
        };
      case "leer_archivos":
        return a.rutas.map((r) => ({ ruta_relativa: r, contenido: archivos[r] }));
      default:
        throw new Error(`comando inesperado: ${cmd}`);
    }
  };
}

/** Abre un índice nuevo sobre el vault, como la apertura de la app. */
async function abrir(archivos) {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  client.setExecutor(executorDe(db));
  contexto.setVaultActual("C:/vault");
  vaultEnMemoria(archivos);
  await indexer.crearEsquemaIndice();
  await indexer.indexarVault("C:/vault");
  return db;
}

const VAULT = {
  "Plan.md": "# Plan\n\nVer [[Idea]] y [[Idea|la idea]].\n```\n[[EnCodigo]]\n```\n![[Falta.excalidraw]] y [[Nada#sec]]\n",
  "Idea.md": "Una idea. [[Plan#Objetivos]]\n",
  "docs/Plan.md": "El otro plan.\n",
  "Suelta.md": "Nadie me enlaza.\n",
  "L.canvas": JSON.stringify({ nodes: [{ id: "a", type: "file", file: "Suelta.md", x: 0, y: 0, width: 1, height: 1 }] }),
};

test("filasDelIndice y filasHacia: las filas del indexador, resueltas, sin el código", { skip: sinSqlite }, async () => {
  await abrir(VAULT);
  const notas = await indiceIa.notasDelIndice();
  assert.deepEqual(notas.map((n) => n.id), ["Idea.md", "L.canvas", "Plan.md", "Suelta.md", "docs/Plan.md"]);
  const plan = await indiceIa.filasDelIndice("Plan.md");
  assert.deepEqual(
    plan.map((f) => `${f.tipo}:${f.texto}→${f.destino}×${f.n}`),
    ["enlace:Idea→Idea.md×2", "embed:Falta.excalidraw→null×1", "enlace:Nada#sec→null×1"],
  );
  const haciaSuelta = await indiceIa.filasHacia("Suelta.md");
  assert.deepEqual(haciaSuelta.map((f) => `${f.desde}:${f.tipo}`), ["L.canvas:archivo"], "el lienzo la enlaza");
  const haciaPlan = await indiceIa.filasHacia("Plan.md");
  assert.deepEqual(haciaPlan.map((f) => `${f.desde}:${f.texto}`), ["Idea.md:Plan#Objetivos"], "con ancla, a la de la raíz");
  const todas = await indiceIa.filasDelIndice();
  assert.ok(todas.length >= 5);
  const contenidos = await indiceIa.contenidosDe(["Plan.md", "Plan.md", "No existe.md"]);
  assert.deepEqual([...contenidos.keys()], ["Plan.md"]);
});

test("buscar pagina: la página dos sigue exactamente a la uno", { skip: sinSqlite }, async () => {
  const archivos = {};
  for (let i = 0; i < 12; i++) archivos[`Nota ${String(i).padStart(2, "0")}.md`] = `Habla del riego ${"riego ".repeat(i)}\n`;
  await abrir(archivos);
  const todas = (await buscar(LOCAL_VAULT_ID, "riego", false, "ambos")).resultados.map((r) => r.nota_id);
  assert.equal(todas.length, 12);
  const pagina = async (desde) =>
    (await buscar(LOCAL_VAULT_ID, "riego", false, "ambos", { limite: 5, desde })).resultados.map((r) => r.nota_id);
  assert.deepEqual([...(await pagina(0)), ...(await pagina(5)), ...(await pagina(10))], todas);
  // También solo con filtros (otra consulta, el mismo LIMIT/OFFSET).
  await abrir({ "A.md": "#t", "B.md": "#t", "C.md": "#t" });
  const t = async (desde) =>
    (await buscar(LOCAL_VAULT_ID, "tag:t", false, "ambos", { limite: 2, desde })).resultados.map((r) => r.titulo);
  assert.deepEqual([...(await t(0)), ...(await t(2))], ["A", "B", "C"]);
});

// ── La salud del vault sobre el índice de verdad (`FUN-L-30`) ───────────────

const SALUD = await import(
  await fuente("../lib/salud.ts", {
    "@/lib/enlacesNota": ENLACES_NOTA,
    "@/lib/wikilinks": WIKILINKS,
    "@/lib/mcpIndiceLogica": await fuente("../lib/mcpIndiceLogica.ts", {
      "@/lib/bases": await fuente("../lib/bases.ts"),
      "@/lib/enlacesNota": ENLACES_NOTA,
    }),
  })
);

const VAULT_SALUD = {
  "Mapa.md": "Ver [[Idea|la idea]] y [[Idea#Origen]].\n```\n[[EnBloque]]\n```\n[[Fantasma]] ![[Falta.excalidraw]] [[Plan]]\n",
  "Idea.md": "## Origen\n",
  "Plan.md": "[[Mapa]]\n",
  "proyectos/Plan.md": "Otro plan.\n",
  "Esporas/Reunión.md": "[[{{fecha}}]]\n",
  "Suelta.md": "Sola.\n",
};

test("la salud sobre las filas del índice es la misma que sobre derivarEnlaces + resolverEnlace", { skip: sinSqlite }, async () => {
  await abrir(VAULT_SALUD);
  const [notas, carpetas, filas] = await Promise.all([
    indiceIa.notasDelIndice(),
    indiceIa.carpetasDelIndice(),
    indiceIa.filasDelIndice(),
  ]);
  const entrada = { notas, carpetas, otros: [], carpetaEsporas: "Esporas" };
  const delIndice = SALUD.calcularSalud({ ...entrada, filas });
  const conContenido = notas.map((n) => ({ ...n, contenido: VAULT_SALUD[n.id] }));
  const aMano = SALUD.calcularSalud({ ...entrada, filas: SALUD.filasComoElIndice(conContenido, carpetas) });
  assert.deepEqual(delIndice, aMano);
  assert.deepEqual(delIndice.rotos.map((p) => p.texto), ["Fantasma"]);
  assert.deepEqual(delIndice.embedsRotos.map((p) => p.texto), ["Falta.excalidraw"]);
  assert.deepEqual(delIndice.huerfanas.map((n) => n.ruta), ["proyectos/Plan.md", "Suelta.md"].sort());
  assert.deepEqual(delIndice.duplicados.map((d) => d.ambiguos.map((a) => a.texto)), [["Plan"]]);
  // Y las líneas, con el contenido del índice.
  const contenidos = await indiceIa.contenidosDe(SALUD.notasConProblemas(delIndice));
  SALUD.ponerLineas(delIndice, contenidos, new Map(notas.map((n) => [n.id, n.tipo])));
  assert.deepEqual(delIndice.rotos[0].lineas, [5]);
  assert.deepEqual(delIndice.duplicados[0].ambiguos[0].lineas, [5]);
});
