// Test headless (sin navegador ni Tauri) de la búsqueda global con filtros
// `clave:valor` (`FUN-M-04`) contra un índice SQLite de verdad (`DEF-144`):
//
//   - el filtro ignora tildes y mayúsculas, en la clave y en el valor, igual que
//     el texto («familia:solanaceas» encuentra `familia: solanáceas`);
//   - `tag:` (que resuelve el FTS) también, con la etiqueta escrita con o sin tilde;
//   - un índice creado antes de las columnas plegadas se migra al abrirlo, sin
//     releer archivos;
//   - el filtro se resuelve por el índice `idx_propiedades_plegado`, no
//     recorriendo las propiedades de cada nota.
//
// Necesita `better-sqlite3`, como `test-indexado-dirigido.mjs`: se busca en
// `node_modules` y, si no, en la carpeta que diga `MYCELIUM_BETTER_SQLITE3`;
// sin él, los tests se SALTAN (y lo dicen).
//
//   MYCELIUM_BETTER_SQLITE3=/ruta/a/node_modules/better-sqlite3 node --test scripts/test-busqueda-propiedades.mjs
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
  "./ftsIndice": FTS_INDICE,
  "./util": UTIL,
});
const PROPIEDADES = await fuente("../lib/db/propiedades.ts", {
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
const { buscar, condicionFiltros } = await import(BUSCAR);
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

/** Los comandos Rust del indexado, sobre un vault en memoria. */
function vaultEnMemoria(archivos) {
  globalThis.__invoke = async (cmd, a) => {
    switch (cmd) {
      case "recorrer_vault":
        return {
          archivosMeta: Object.keys(archivos).map((r, i) => ({ rutaRelativa: r, mtime: 1000 + i, tipo: "markdown" })),
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

const HUERTA = {
  "Tomate.md": "---\nfamilia: solanáceas\nestado: Plantado\n---\nRojo, de verano. Cuidado con el pulgón.\n",
  "Ají.md": "---\nfamilia: Solanáceas\ntags: [picante, huerta]\n---\nPicante. #solanaceas\n",
  "Zapallo.md": "---\nfamilia: cucurbitáceas\n---\nRastrero.\n",
  "Pulgón.md": "Plaga. #plaga\n",
};

/** Abre un índice nuevo sobre el vault, como la apertura de la app. */
async function abrir(archivos = HUERTA) {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  client.setExecutor(executorDe(db));
  contexto.setVaultActual("C:/vault");
  vaultEnMemoria(archivos);
  await indexer.crearEsquemaIndice();
  await indexer.indexarVault("C:/vault");
  return db;
}

const titulos = async (q) =>
  (await buscar(LOCAL_VAULT_ID, q)).resultados.map((r) => r.titulo).sort();

test("clave:valor sin tilde encuentra el valor con tilde (DEF-144)", { skip: sinSqlite }, async () => {
  await abrir();
  assert.deepEqual(await titulos("familia:solanaceas"), ["Ají", "Tomate"]);
  assert.deepEqual(await titulos("familia:solanáceas"), ["Ají", "Tomate"]);
  assert.deepEqual(await titulos("familia:SOLANACEAS"), ["Ají", "Tomate"]);
  assert.deepEqual(await titulos("familia:cucurbitaceas"), ["Zapallo"]);
});

test("la clave también se compara sin tildes ni mayúsculas", { skip: sinSqlite }, async () => {
  await abrir({ "Papa.md": "---\nfamília: Solanáceas\n---\nTubérculo.\n" });
  assert.deepEqual(await titulos("familia:solanaceas"), ["Papa"]);
  assert.deepEqual(await titulos("FAMÍLIA:solanaceas"), ["Papa"]);
});

test("el filtro sigue exigiendo el valor entero, no un prefijo", { skip: sinSqlite }, async () => {
  await abrir();
  assert.deepEqual(await titulos("familia:solan"), []);
  assert.deepEqual(await titulos("estado:plantado"), ["Tomate"]);
});

test("filtro + texto: el texto ignora tildes y el filtro también", { skip: sinSqlite }, async () => {
  await abrir();
  assert.deepEqual(await titulos("familia:solanaceas pulgon"), ["Tomate"]);
  assert.deepEqual(await titulos("Familia:Solanáceas picante"), ["Ají"]);
});

test("el fragmento de un filtro solo muestra la propiedad que coincidió", { skip: sinSqlite }, async () => {
  await abrir();
  const { resultados } = await buscar(LOCAL_VAULT_ID, "tags:HUERTA");
  assert.deepEqual(resultados.map((r) => [r.titulo, r.fragmento]), [["Ají", "tags: «huerta»"]]);
});

test("tag: encuentra la etiqueta escrita con o sin tilde", { skip: sinSqlite }, async () => {
  await abrir();
  // OJO: `tag:x` se resuelve como el término «#x» en el FTS, y el tokenizador
  // descarta el `#`: hoy encuentra también la palabra suelta y los valores de
  // las propiedades (Tomate tiene `familia: solanáceas`, sin etiqueta). Eso es
  // otro problema; acá solo importa que la tilde no cambie el resultado.
  const sin = await titulos("tag:solanaceas");
  assert.ok(sin.includes("Ají"), sin.join(", "));
  assert.deepEqual(await titulos("tag:solanáceas"), sin);
  assert.deepEqual(await titulos("tag:Plaga"), ["Pulgón"]);
});

test("un índice anterior a las columnas plegadas se migra al abrirlo", { skip: sinSqlite }, async () => {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  // El esquema de `propiedades` como era antes de DEF-144, con una fila ya indexada.
  db.exec(`
    CREATE TABLE notas (id TEXT PRIMARY KEY, vault_id TEXT NOT NULL, carpeta_id TEXT, titulo TEXT NOT NULL,
      tipo TEXT NOT NULL DEFAULT 'markdown', tamano_bytes INTEGER NOT NULL DEFAULT 0, mtime INTEGER NOT NULL DEFAULT 0,
      creado_en TEXT NOT NULL, actualizado_en TEXT NOT NULL);
    CREATE TABLE propiedades (nota_id TEXT NOT NULL REFERENCES notas(id) ON DELETE CASCADE,
      clave TEXT NOT NULL, valor TEXT NOT NULL, tipo TEXT NOT NULL, orden INTEGER NOT NULL);
    INSERT INTO notas VALUES ('Tomate.md', '${LOCAL_VAULT_ID}', NULL, 'Tomate', 'markdown', 0, 0, 'x', 'x');
    INSERT INTO propiedades VALUES ('Tomate.md', 'Família', 'Solanáceas', 'texto', 0);
  `);
  client.setExecutor(executorDe(db));
  contexto.setVaultActual("C:/vault-viejo");
  await indexer.crearEsquemaIndice();
  assert.deepEqual(db.prepare("SELECT clave_plegada, valor_plegado FROM propiedades").all(), [
    { clave_plegada: "familia", valor_plegado: "solanaceas" },
  ]);
  // Sin reindexar nada: la búsqueda ya la encuentra.
  assert.deepEqual(await titulos("familia:solanaceas"), ["Tomate"]);
});

test("el filtro usa el índice de las columnas plegadas", { skip: sinSqlite }, async () => {
  const db = await abrir();
  const { sql, params } = condicionFiltros([{ clave: "familia", valor: "solanaceas" }]);
  const plan = db
    .prepare(`EXPLAIN QUERY PLAN SELECT n.id FROM notas n WHERE n.vault_id = ?${sql}`)
    .all(LOCAL_VAULT_ID, ...params)
    .map((f) => f.detail)
    .join("\n");
  assert.match(plan, /idx_propiedades_plegado/, plan);
});
