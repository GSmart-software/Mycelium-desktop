// Test headless (sin navegador ni Tauri) del indexado DIRIGIDO (`indexarRutas`,
// FUN-M-14 / FUN-M-42): poner el índice al día solo con las rutas que avisó el
// watcher, sin recorrer el vault. La vara es el indexado completo: después de
// cada cambio, el índice que deja `indexarRutas` tiene que ser el mismo que
// dejaría `indexarVault` sobre el mismo disco.
//
//   - nota nueva, nota tocada, nota renombrada, carpeta borrada con su subárbol;
//   - lo que está en la papelera no se borra (`DEF-046`);
//   - los enlaces se re-resuelven: una nota nueva arregla los rotos que la nombraban;
//   - una ruta con `%` o `_` no borra de más (no se usa `LIKE`);
//   - el esquema se crea una vez por sesión, no en cada indexado.
//
// Necesita `better-sqlite3`, como `test-indice-sin-contenido.mjs`: se busca en
// `node_modules` y, si no, en la carpeta que diga `MYCELIUM_BETTER_SQLITE3`;
// sin él, los tests se SALTAN (y lo dicen).
//
//   MYCELIUM_BETTER_SQLITE3=/ruta/a/node_modules/better-sqlite3 node --test scripts/test-indexado-dirigido.mjs
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
const FTS = await fuente("../lib/db/ftsIndice.ts", { "./client": CLIENT });
const ENLACES_INDICE = await fuente("../lib/db/enlacesIndice.ts", {
  "@/lib/enlacesNota": ENLACES_NOTA,
  "@/lib/wikilinks": WIKILINKS,
  "./client": CLIENT,
  "./ftsIndice": FTS,
  "./util": UTIL,
});
const PROPIEDADES = await fuente("../lib/db/propiedades.ts", {
  "@/lib/textoBuscable": await fuente("../lib/textoBuscable.ts", { "@/lib/canvas": await fuente("../lib/canvas.ts") }),
  "@/lib/frontmatter": FRONTMATTER,
  "./client": CLIENT,
  "./fts": await fuente("../lib/db/fts.ts"),
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
  "./ftsIndice": FTS,
  "./propiedades": PROPIEDADES,
  "./util": UTIL,
  "./vaultContext": CONTEXTO,
});

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

/** Executor sobre un SQLite en memoria; `sentencias` cuenta lo que se le pide. */
function executorDe(db) {
  const ex = {
    sentencias: [],
    async select(sql, params = []) {
      ex.sentencias.push(sql);
      return db.prepare(sql).all(...params);
    },
    async execute(sql, params = []) {
      ex.sentencias.push(sql);
      const st = db.prepare(sql);
      if (st.reader) return (st.all(...params), { rowsAffected: 0 });
      return { rowsAffected: st.run(...params).changes };
    },
  };
  return ex;
}

const TIPO_POR_EXT = { md: "markdown", excalidraw: "excalidraw", base: "base", canvas: "canvas", drawio: "drawio" };
const tipoDe = (r) => TIPO_POR_EXT[r.slice(r.lastIndexOf(".") + 1)];

/** Un vault en memoria (archivos y carpetas vacías) detrás de los comandos Rust. */
function vaultEnMemoria(inicial, vacias = []) {
  const archivos = new Map(Object.entries(inicial));
  const dirsVacios = new Set(vacias);
  const mtimes = new Map();
  let reloj = 1_000;
  for (const r of archivos.keys()) mtimes.set(r, ++reloj);
  globalThis.__invoke = async (cmd, a) => {
    switch (cmd) {
      case "recorrer_vault": {
        const dirs = new Set(dirsVacios);
        for (const r of archivos.keys()) {
          const partes = r.split("/").slice(0, -1);
          for (let i = 1; i <= partes.length; i++) dirs.add(partes.slice(0, i).join("/"));
        }
        const notas = [...archivos.keys()].filter((r) => tipoDe(r));
        const otros = [...archivos.keys()].filter((r) => !tipoDe(r));
        return {
          archivosMeta: notas.map((r) => ({ rutaRelativa: r, mtime: mtimes.get(r), tipo: tipoDe(r) })),
          otros: otros.map((r) => ({ rutaRelativa: r, mtime: mtimes.get(r), tipo: r.slice(r.lastIndexOf(".") + 1) })),
          directorios: [...dirs],
        };
      }
      case "leer_archivos":
        return a.rutas.filter((r) => archivos.has(r)).map((r) => ({ ruta_relativa: r, contenido: archivos.get(r) }));
      default:
        throw new Error(`comando inesperado: ${cmd}`);
    }
  };
  const d = {
    archivos,
    mtimes,
    dirsVacios,
    /** Escribe un archivo y devuelve el cambio que mandaría el watcher. */
    escribir(r, texto) {
      archivos.set(r, texto);
      mtimes.set(r, ++reloj);
      return { ruta: r, mtime: reloj, estado: tipoDe(r) ? "nota" : "otro", tipo: tipoDe(r) ?? r.slice(r.lastIndexOf(".") + 1) };
    },
    borrar(r) {
      for (const k of [...archivos.keys()]) if (k === r || k.startsWith(`${r}/`)) archivos.delete(k);
      for (const k of [...dirsVacios]) if (k === r || k.startsWith(`${r}/`)) dirsVacios.delete(k);
      return { ruta: r, mtime: 0, estado: "ausente", tipo: "" };
    },
  };
  return d;
}

/** Abre un índice nuevo sobre el vault, como la apertura de la app. */
async function abrir(disco) {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  const ex = executorDe(db);
  client.setExecutor(ex);
  contexto.setVaultActual("C:/vault");
  await indexer.crearEsquemaIndice();
  await indexer.indexarVault("C:/vault");
  return { db, ex };
}

/** Lo que importa del índice, ordenado: para comparar dirigido contra completo. */
function volcado(db) {
  const q = (sql) => db.prepare(sql).all();
  return {
    notas: q("SELECT id, carpeta_id, titulo, tipo, mtime, hash_indexable, hash_enlaces FROM notas ORDER BY id"),
    carpetas: q("SELECT id, padre_id, nombre FROM carpetas ORDER BY id"),
    contenidos: q("SELECT nota_id, contenido FROM contenidos ORDER BY nota_id"),
    fts: q("SELECT nota_id, titulo, contenido FROM notas_fts ORDER BY nota_id"),
    propiedades: q("SELECT nota_id, clave, valor, tipo, orden FROM propiedades ORDER BY nota_id, clave, orden"),
    enlaces: q("SELECT desde_id, destino_texto, destino_id, tipo, n FROM enlaces ORDER BY desde_id, destino_texto, tipo"),
    etiquetas: q("SELECT nota_id, tag FROM etiquetas ORDER BY nota_id, tag"),
  };
}

/**
 * Corre el cambio por el camino dirigido y verifica que el índice queda igual
 * que si se hubiera indexado completo un índice nuevo sobre el mismo disco.
 */
async function igualQueCompleto(disco, { db, ex }, cambios) {
  const r = await indexer.indexarRutas("C:/vault", cambios);
  const dirigido = volcado(db);
  const ref = new Database(":memory:");
  ref.pragma("foreign_keys = ON");
  client.setExecutor(executorDe(ref));
  await indexer.crearEsquemaIndice();
  await indexer.indexarVault("C:/vault");
  const completo = volcado(ref);
  // De vuelta al índice del test, para el cambio siguiente.
  client.setExecutor(ex);
  // El `mtime` y las huellas coinciden porque salen del mismo disco.
  assert.deepEqual(dirigido, completo);
  return r;
}

const VAULT = {
  "Plan.md": "---\nestado: activo\ntags: [a]\n---\n# Plan\n\nCon [[Idea]] y [[Futura]]. #proyecto",
  "Idea.md": "Una idea suelta.",
  "Area/Notas/uno.md": "Ver [[Plan]]",
  "Area/Notas/dos.md": "Ver [[uno]]",
  "Area/foto.png": "png",
  "Otra%_rara/tres.md": "x",
  "Otra/cuatro.md": "y",
};

test("una nota nueva y una tocada dejan el índice igual que el completo, y la nueva arregla un enlace roto", { skip: sinSqlite }, async () => {
  const disco = vaultEnMemoria(VAULT);
  const abierto = await abrir(disco);
  const { db, ex } = abierto;
  assert.equal(db.prepare("SELECT destino_id FROM enlaces WHERE destino_texto = 'Futura'").get().destino_id, null);
  ex.sentencias.length = 0;
  const cambios = [disco.escribir("Nuevas/Sub/Futura.md", "# Futura\n\nVuelve a [[Plan]]"), disco.escribir("Idea.md", "Otra idea, ahora con [[Plan]]")];
  const r = await igualQueCompleto(disco, abierto, cambios);
  assert.equal(r.reindexadas, 2);
  assert.deepEqual(r.rutas.sort(), ["Idea.md", "Nuevas/Sub/Futura.md"]);
  assert.equal(
    db.prepare("SELECT destino_id FROM enlaces WHERE destino_texto = 'Futura'").get().destino_id,
    "Nuevas/Sub/Futura.md",
  );
  client.setExecutor(null);
});

test("sin recorrer el vault, sin leer lo que no cambió y sin recrear el esquema", { skip: sinSqlite }, async () => {
  const disco = vaultEnMemoria(VAULT);
  const { ex } = await abrir(disco);
  const invocados = [];
  const original = globalThis.__invoke;
  globalThis.__invoke = (cmd, a) => (invocados.push([cmd, a?.rutas]), original(cmd, a));
  ex.sentencias.length = 0;
  await indexer.indexarRutas("C:/vault", [disco.escribir("Idea.md", "cambiada")]);
  assert.deepEqual(invocados, [["leer_archivos", ["Idea.md"]]], "ni `recorrer_vault` ni otras notas");
  assert.equal(ex.sentencias.filter((s) => /CREATE|ALTER/.test(s)).length, 0, "el esquema ya estaba");
  assert.ok(!ex.sentencias.some((s) => /FROM notas n\s+LEFT JOIN/.test(s) && !/WHERE n\.id IN/.test(s)), "el estado se pide solo de esa nota");

  // Una nota con el `mtime` que el índice ya tiene (un guardado propio que se
  // coló) no se relee.
  invocados.length = 0;
  const igual = { ruta: "Plan.md", mtime: disco.mtimes.get("Plan.md"), estado: "nota", tipo: "markdown" };
  const r = await indexer.indexarRutas("C:/vault", [igual]);
  assert.equal(r.reindexadas, 0);
  assert.deepEqual(invocados, []);

  // Y el completo, tampoco recrea el esquema en la misma sesión.
  ex.sentencias.length = 0;
  globalThis.__invoke = original;
  await indexer.indexarVault("C:/vault");
  assert.equal(ex.sentencias.filter((s) => /CREATE|ALTER/.test(s)).length, 0);
  client.setExecutor(null);
});

test("una carpeta que se va se lleva sus notas y subcarpetas, salvo lo que está en la papelera", { skip: sinSqlite }, async () => {
  const disco = vaultEnMemoria(VAULT);
  const { db } = await abrir(disco);
  // `uno.md` está en la papelera: su archivo ya no está en la ruta, pero la fila sigue.
  db.prepare(
    "INSERT INTO papelera (id, nota_id, ruta_original, carpeta_original_id, eliminado_en) VALUES ('p1', 'Area/Notas/uno.md', 'Area/Notas/uno.md', 'Area/Notas', 'x')",
  ).run();
  const r = await indexer.indexarRutas("C:/vault", [disco.borrar("Area")]);
  assert.deepEqual(r.rutas, ["Area/Notas/dos.md"]);
  const ids = db.prepare("SELECT id FROM notas ORDER BY id").all().map((f) => f.id);
  assert.deepEqual(ids, ["Area/Notas/uno.md", "Idea.md", "Otra%_rara/tres.md", "Otra/cuatro.md", "Plan.md"]);
  const carpetas = db.prepare("SELECT id FROM carpetas ORDER BY id").all().map((f) => f.id);
  assert.deepEqual(carpetas, ["Otra", "Otra%_rara"]);
  // El enlace a `uno` (desde `dos`, que se fue) no queda; el de `Plan` hacia `uno`… no había.
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM enlaces WHERE desde_id = 'Area/Notas/dos.md'").get().n, 0);
  client.setExecutor(null);
});

test("borrar una carpeta con `%` o `_` en el nombre no se lleva a sus parecidas", { skip: sinSqlite }, async () => {
  const disco = vaultEnMemoria(VAULT);
  const abierto = await abrir(disco);
  const { db } = abierto;
  await igualQueCompleto(disco, abierto, [disco.borrar("Otra%_rara")]);
  assert.ok(db.prepare("SELECT 1 FROM notas WHERE id = 'Otra/cuatro.md'").get());
  // Y al revés: `Otra` no se lleva a `Otra%_rara`.
  const disco2 = vaultEnMemoria(VAULT);
  const abierto2 = await abrir(disco2);
  const db2 = abierto2.db;
  await igualQueCompleto(disco2, abierto2, [disco2.borrar("Otra")]);
  assert.ok(db2.prepare("SELECT 1 FROM notas WHERE id = 'Otra%_rara/tres.md'").get());
  client.setExecutor(null);
});

test("un renombrado (origen ausente, destino nota) y una carpeta movida con su contenido", { skip: sinSqlite }, async () => {
  const disco = vaultEnMemoria(VAULT);
  const abierto = await abrir(disco);
  const { db } = abierto;
  const texto = disco.archivos.get("Idea.md");
  const origen = disco.borrar("Idea.md");
  await igualQueCompleto(disco, abierto, [origen, disco.escribir("Ideas/Idea.md", texto)]);
  // `Plan` enlaza a [[Idea]]: sigue resolviendo, ahora a la ruta nueva.
  assert.equal(db.prepare("SELECT destino_id FROM enlaces WHERE destino_texto = 'Idea'").get().destino_id, "Ideas/Idea.md");

  // La carpeta entera: el watcher manda el origen ausente y el destino expandido.
  const uno = disco.archivos.get("Area/Notas/uno.md");
  const dos = disco.archivos.get("Area/Notas/dos.md");
  const cambios = [
    disco.borrar("Area/Notas"),
    { ruta: "Archivo", mtime: 0, estado: "carpeta", tipo: "" },
    disco.escribir("Archivo/uno.md", uno),
    disco.escribir("Archivo/dos.md", dos),
  ];
  await igualQueCompleto(disco, abierto, cambios);
  client.setExecutor(null);
});

test("una carpeta vacía nueva entra al índice, y un archivo que no es nota solo asegura sus carpetas", { skip: sinSqlite }, async () => {
  const disco = vaultEnMemoria(VAULT);
  const abierto = await abrir(disco);
  const { db } = abierto;
  disco.dirsVacios.add("Vacia/Honda");
  await igualQueCompleto(disco, abierto, [
    { ruta: "Vacia/Honda", mtime: 0, estado: "carpeta", tipo: "" },
    disco.escribir("Adjuntos/2026/plano.pdf", "%PDF"),
  ]);
  const carpetas = db.prepare("SELECT id FROM carpetas ORDER BY id").all().map((f) => f.id);
  assert.ok(carpetas.includes("Vacia") && carpetas.includes("Vacia/Honda") && carpetas.includes("Adjuntos/2026"));
  client.setExecutor(null);
});

test("indexar a demanda una nota que el árbol ya muestra y el índice no", { skip: sinSqlite }, async () => {
  const disco = vaultEnMemoria(VAULT);
  const { db } = await abrir(disco);
  disco.escribir("Recien.md", "Recién llegada");
  assert.equal(await indexer.indexarNotaADemanda("C:/vault", "Recien.md", "markdown"), true);
  assert.equal(db.prepare("SELECT contenido FROM contenidos WHERE nota_id = 'Recien.md'").get().contenido, "Recién llegada");
  // Entró con `mtime` 0: el indexado del watcher la relee con el real.
  assert.equal(db.prepare("SELECT mtime FROM notas WHERE id = 'Recien.md'").get().mtime, 0);
  const r = await indexer.indexarRutas("C:/vault", [{ ruta: "Recien.md", mtime: disco.mtimes.get("Recien.md"), estado: "nota", tipo: "markdown" }]);
  assert.equal(r.reindexadas, 1);
  // Lo que no está en disco no se inventa.
  assert.equal(await indexer.indexarNotaADemanda("C:/vault", "No/existe.md", "markdown"), false);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM notas WHERE id = 'No/existe.md'").get().n, 0);
  client.setExecutor(null);
});
