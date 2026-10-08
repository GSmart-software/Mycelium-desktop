// Test headless (sin navegador ni Tauri) de la búsqueda global con filtros
// `clave:valor` (`FUN-M-04`) contra un índice SQLite de verdad (`DEF-144`):
//
//   - el filtro ignora tildes y mayúsculas, en la clave y en el valor, igual que
//     el texto («familia:solanaceas» encuentra `familia: solanáceas`);
//   - `tag:` (que resuelve el FTS) también, con la etiqueta escrita con o sin tilde;
//   - un índice creado antes de las columnas plegadas se migra al abrirlo, sin
//     releer archivos;
//   - el filtro se resuelve por el índice `idx_propiedades_plegado`, no
//     recorriendo las propiedades de cada nota;
//   - `clave:"valor con espacios"` pide el valor entero, y sin comillas alcanza
//     con una palabra del valor que empiece así (`DEF-145`);
//   - el título que coincide con la consulta sale primero, antes que las notas
//     que solo la mencionan (`DEF-146`).
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

const titulos = async (q, exacto = false) =>
  (await buscar(LOCAL_VAULT_ID, q, exacto)).resultados.map((r) => r.titulo).sort();

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

// DEF-144 exigía el valor entero; DEF-145 lo cambió por «una palabra del valor
// que empiece así», como el texto. Con «Búsqueda exacta», la palabra completa.
test("sin comillas, el filtro coincide con el principio de una palabra del valor", { skip: sinSqlite }, async () => {
  await abrir();
  assert.deepEqual(await titulos("familia:solan"), ["Ají", "Tomate"]);
  assert.deepEqual(await titulos("familia:solan", true), []);
  assert.deepEqual(await titulos("familia:solanaceas", true), ["Ají", "Tomate"]);
  assert.deepEqual(await titulos("estado:plantado"), ["Tomate"]);
  // Solo al principio de una palabra: «anaceas» está adentro, no al principio.
  assert.deepEqual(await titulos("familia:anaceas"), []);
});

const CULTIVOS = {
  "Tomate.md": "---\nbancal: Bancal 1\nestado: creciendo\nluz: semi-sombra\n---\nRiego diario.\n",
  "Ají.md": "---\nbancal: Bancal 1\nestado: inactivo\n---\nPicante.\n",
  "Caléndula.md": "---\nbancal: bancal 1\nestado: activo\n---\nFlor.\n",
  "Lechuga.md": "---\nbancal: Bancal 10\nestado: Activo\n---\nHoja. Riego diario.\n",
  "Porcentaje.md": "---\navance: 50%\ncodigo: a_b\n---\n",
};

test("clave:\"valor con espacios\" filtra por el valor entero (DEF-145)", { skip: sinSqlite }, async () => {
  await abrir(CULTIVOS);
  assert.deepEqual(await titulos('bancal:"Bancal 1"'), ["Ají", "Caléndula", "Tomate"]);
  assert.deepEqual(await titulos('bancal:"bancal 10"'), ["Lechuga"]);
  assert.deepEqual(await titulos('bancal:"Bancal"'), [], "entre comillas no hay coincidencia parcial");
  assert.deepEqual(await titulos('bancal:"Bancal 1" riego'), ["Tomate"]);
  // El fragmento de solo-filtros usa la misma condición.
  const { resultados } = await buscar(LOCAL_VAULT_ID, 'bancal:"bancal 1"');
  assert.ok(resultados.every((r) => /^bancal: «[Bb]ancal 1»$/.test(r.fragmento)), JSON.stringify(resultados));
});

test("sin comillas: una palabra del valor, sin falsos positivos a mitad de palabra", { skip: sinSqlite }, async () => {
  await abrir(CULTIVOS);
  assert.deepEqual(await titulos("bancal:Bancal"), ["Ají", "Caléndula", "Lechuga", "Tomate"]);
  assert.deepEqual(await titulos("bancal:1"), ["Ají", "Caléndula", "Lechuga", "Tomate"]);
  assert.deepEqual(await titulos("bancal:1", true), ["Ají", "Caléndula", "Tomate"]);
  assert.deepEqual(await titulos("estado:crec"), ["Tomate"]);
  assert.deepEqual(await titulos("estado:activo"), ["Caléndula", "Lechuga"], "«inactivo» no");
  assert.deepEqual(await titulos("luz:sombra"), ["Tomate"], "la puntuación separa palabras");
  // `%` y `_` del usuario no son comodines del LIKE.
  assert.deepEqual(await titulos("avance:50%"), ["Porcentaje"]);
  assert.deepEqual(await titulos("avance:5%"), []);
  assert.deepEqual(await titulos("codigo:a_b"), ["Porcentaje"]);
});

test("las listas se siguen filtrando elemento a elemento", { skip: sinSqlite }, async () => {
  await abrir({
    "A.md": "---\ntags: [huerta urbana, picante]\n---\n",
    "B.md": "---\ntags:\n  - huerta\n---\n",
  });
  assert.deepEqual(await titulos('tags:"huerta urbana"'), ["A"]);
  assert.deepEqual(await titulos('tags:"huerta"'), ["B"]);
  assert.deepEqual(await titulos("tags:huerta"), ["A", "B"]);
  assert.deepEqual(await titulos("tags:picante"), ["A"]);
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
  for (const entero of [true, false]) {
    const { sql, params } = condicionFiltros([{ clave: "familia", valor: "solanaceas", entero }]);
    const plan = db
      .prepare(`EXPLAIN QUERY PLAN SELECT n.id FROM notas n WHERE n.vault_id = ?${sql}`)
      .all(LOCAL_VAULT_ID, ...params)
      .map((f) => f.detail)
      .join("\n");
    // Con o sin comillas, la clave acota por el índice (sin comillas, el LIKE
    // del valor se evalúa solo sobre las filas de esa clave).
    assert.match(plan, /idx_propiedades_plegado \(clave_plegada=/, plan);
  }
});

// --- Orden de los resultados (`DEF-146`) -----------------------------------
// Buscar el título de una nota la pone primera: antes, el orden era solo bm25
// sobre el documento entero, y la nota «Tomate» salía detrás de todas las que
// mencionaban el tomate varias veces.

/** Los títulos en el orden en que vuelven (sin ordenar). */
const enOrden = async (q, exacto = false, campo = "ambos") =>
  (await buscar(LOCAL_VAULT_ID, q, exacto, campo)).resultados.map((r) => r.titulo);

/** Un vault con la nota «Tomate» y muchas que hablan del tomate en el cuerpo. */
function huertaConTomates(cuantas = 17) {
  const archivos = {
    // Cuerpo largo y sin repetir la palabra: lo peor para bm25.
    "Tomate.md": "---\nfamilia: solanáceas\n---\n" + "Planta de verano que pide sol y riego. ".repeat(40),
    "Tomates cherry.md": "Variedad chica.\n",
    "Riego del tomate.md": "Cada dos días.\n",
    "Tómate un respiro.md": "Una pausa.\n",
  };
  for (let i = 0; i < cuantas; i++) {
    archivos[`Nota ${i}.md`] = `---\nfamilia: solanáceas\n---\nEl tomate, tomate y más tomate ${i}.\n`;
  }
  return archivos;
}

test("el título idéntico a la consulta sale primero, sin tildes ni mayúsculas", { skip: sinSqlite }, async () => {
  await abrir(huertaConTomates());
  for (const q of ["Tomate", "tomate", "TOMATE", "tomaté"]) {
    assert.equal((await enOrden(q))[0], "Tomate", q);
  }
  assert.equal((await enOrden("tomate", true))[0], "Tomate", "con Búsqueda exacta");
  assert.equal((await enOrden("tomate", false, "nombre"))[0], "Tomate", "solo por nombre");
});

test("después, los títulos que empiezan con la consulta y los que la contienen; al final, el contenido", { skip: sinSqlite }, async () => {
  await abrir(huertaConTomates());
  const r = await enOrden("tomate");
  // Empiezan con «tomate», del más corto al más largo (prefijo: también «Tomates»).
  assert.deepEqual(r.slice(0, 4), ["Tomate", "Tomates cherry", "Tómate un respiro", "Riego del tomate"]);
  assert.ok(r.slice(4).every((t) => t.startsWith("Nota ")), r.join(", "));
  // Con «Búsqueda exacta», «Tomates» ya no coincide.
  assert.deepEqual((await enOrden("tomate", true)).slice(0, 3), ["Tomate", "Tómate un respiro", "Riego del tomate"]);
});

test("una consulta de varias palabras: primero el título que empieza con la frase", { skip: sinSqlite }, async () => {
  await abrir({
    ...huertaConTomates(3),
    "Plan de riego.md": "Riego del tomate y del ají.\n",
  });
  assert.equal((await enOrden("riego del tomate"))[0], "Riego del tomate");
  assert.equal((await enOrden('"riego del"'))[0], "Riego del tomate");
});

test("con más de 50 coincidencias, la nota del título no se queda afuera del límite", { skip: sinSqlite }, async () => {
  await abrir(huertaConTomates(80));
  const r = await enOrden("tomate");
  assert.equal(r.length, 50);
  assert.equal(r[0], "Tomate");
});

test("con filtros, el texto libre ordena igual", { skip: sinSqlite }, async () => {
  await abrir(huertaConTomates());
  const r = await enOrden("familia:solanaceas tomate");
  assert.equal(r[0], "Tomate");
  assert.ok(!r.includes("Tomates cherry"), "el filtro sigue filtrando");
  // `tag:` no es texto libre: no ordena por título (ni rompe la consulta).
  assert.ok(Array.isArray(await enOrden("tag:tomate")));
  // Puntuación suelta junto al texto tampoco rompe el orden.
  assert.equal((await enOrden("tomate -"))[0], "Tomate");
});
