// Test headless (sin navegador ni Tauri) de `DEF-121`: una nota que queda en el
// índice con su fila en `notas` pero SIN la de `contenidos` (ni la de búsqueda).
//
// La app lee el contenido del índice, así que la abría VACÍA —un `.drawio` de
// 6 KB, la página en blanco— y guardar encima pisaba el disco. La causa: el
// indexador escribía la tanda en varias sentencias sueltas, la de `notas` (con
// el `mtime` del archivo) PRIMERO; si algo cortaba la tanda después —una
// sentencia que falla, la ventana que se recarga a mitad— la nota quedaba con
// el `mtime` al día, y el reindexado incremental, que solo compara `mtime`s, la
// salteaba para siempre.
//
//   - un indexado que se corta después de escribir `notas` no deja la nota sin
//     contenido: el siguiente la relee;
//   - un índice YA dañado (sin `contenidos`, sin fila de búsqueda) se repara en
//     el siguiente indexado, aunque el `mtime` no haya cambiado;
//   - `getContenido` de una nota sin contenido en el índice lee el disco (y lo
//     repone), en vez de devolver vacío; un archivo vacío sigue siendo vacío;
//   - guardar sin cambiar lo indexable repone la fila de búsqueda si falta.
//
// Necesita `better-sqlite3`, como `test-enlaces-nota.mjs`: se busca en
// `node_modules` y, si no, en la carpeta que diga `MYCELIUM_BETTER_SQLITE3`;
// sin él, los tests se SALTAN (y lo dicen).
//
//   MYCELIUM_BETTER_SQLITE3=/ruta/a/node_modules/better-sqlite3 node --test scripts/test-indice-sin-contenido.mjs
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

// ── Módulos (la MISMA URL en todos lados: comparten instancia) ───────────────

/** `invoke` de Tauri: delega en `globalThis.__invoke`, que arma cada test. */
const TAURI = aUrl(`export const invoke = (cmd, args) => globalThis.__invoke(cmd, args);`);

const EXTENSIONES = await fuente("../lib/extensionesDeTipo.ts");
const WIKILINKS = await fuente("../lib/wikilinks.ts", { "@/lib/extensionesDeTipo": EXTENSIONES });
const CANVAS = await fuente("../lib/canvas.ts");
const FRONTMATTER = await fuente("../lib/frontmatter.ts");
const SINCODIGO = await fuente("../lib/sinCodigo.ts");
const ENLACES_NOTA = await fuente("../lib/enlacesNota.ts", {
  "@/lib/canvas": CANVAS,
  "@/lib/extensionesDeTipo": EXTENSIONES,
  "@/lib/frontmatter": FRONTMATTER,
  "@/lib/sinCodigo": SINCODIGO,
  "@/lib/wikilinks": WIKILINKS,
});
const ERRORS = await fuente("../lib/db/errors.ts");
const CLIENT = await fuente("../lib/db/client.ts", { "./errors": ERRORS });
const UTIL = await fuente("../lib/db/util.ts");
const NOMBRES = await fuente("../lib/db/nombres.ts");
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
const VAULTFS = await fuente("../lib/db/vaultFs.ts", {
  "@/lib/extensionesDeTipo": EXTENSIONES,
  "@tauri-apps/api/core": TAURI,
  "./client": CLIENT,
  "./enlacesIndice": ENLACES_INDICE,
  "./ftsIndice": FTS,
  "./nombres": NOMBRES,
  "./propiedades": PROPIEDADES,
  "./util": UTIL,
});
const CONTENIDO = await fuente("../lib/db/contenido.ts", {
  "@/lib/arbolVivo": await fuente("../lib/arbolVivo.ts"),
  "@/lib/conflictoExterno": await fuente("../lib/conflictoExterno.ts"),
  "./indexer": INDEXER,
  "@/lib/enlacesNota": ENLACES_NOTA,
  "./client": CLIENT,
  "./enlacesIndice": ENLACES_INDICE,
  "./ftsIndice": FTS,
  "./errors": ERRORS,
  "./propiedades": PROPIEDADES,
  "./util": UTIL,
  "./vaultContext": CONTEXTO,
  "./vaultFs": VAULTFS,
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
const contenidoDb = await import(CONTENIDO);

/**
 * Executor sobre un SQLite en memoria, con las claves foráneas como sqlx.
 * `fallarSi(sql)`: si devuelve true, la sentencia LANZA en vez de correr —el
 * corte de la tanda: un `database is locked`, o la ventana recargándose—.
 */
function executorDe(db) {
  const correr = (sql, params) => {
    const st = db.prepare(sql);
    if (st.reader) return { filas: st.all(...params), cambios: 0 };
    return { filas: [], cambios: st.run(...params).changes };
  };
  return {
    fallarSi: null,
    async select(sql, params = []) {
      return correr(sql, params).filas;
    },
    async execute(sql, params = []) {
      if (this.fallarSi?.(sql)) throw new Error("database is locked");
      return { rowsAffected: correr(sql, params).cambios };
    },
  };
}

const TIPO_POR_EXT = { md: "markdown", excalidraw: "excalidraw", base: "base", canvas: "canvas", drawio: "drawio" };

/** Un vault en memoria detrás de los comandos Rust que usan los repos. */
function vaultEnMemoria(inicial) {
  const archivos = new Map(Object.entries(inicial));
  const mtimes = new Map();
  let reloj = 1_000;
  for (const r of archivos.keys()) mtimes.set(r, ++reloj);
  globalThis.__invoke = async (cmd, a) => {
    switch (cmd) {
      case "recorrer_vault": {
        const rutas = [...archivos.keys()];
        const dirs = new Set();
        for (const r of rutas) {
          const partes = r.split("/").slice(0, -1);
          for (let i = 1; i <= partes.length; i++) dirs.add(partes.slice(0, i).join("/"));
        }
        return {
          archivosMeta: rutas.map((r) => ({
            rutaRelativa: r,
            mtime: mtimes.get(r),
            tipo: TIPO_POR_EXT[r.slice(r.lastIndexOf(".") + 1)] ?? "markdown",
          })),
          otros: [],
          directorios: [...dirs],
        };
      }
      case "leer_archivos":
        return a.rutas.filter((r) => archivos.has(r)).map((r) => ({ ruta_relativa: r, contenido: archivos.get(r) }));
      case "leer_archivo_texto":
        return archivos.get(a.rutaRel) ?? null;
      case "escribir_nota":
        archivos.set(a.rutaRel, a.contenido);
        mtimes.set(a.rutaRel, ++reloj);
        return reloj;
      default:
        throw new Error(`comando inesperado: ${cmd}`);
    }
  };
  return { archivos, mtimes, tocar: (r, texto) => (archivos.set(r, texto), mtimes.set(r, ++reloj)) };
}

const RED =
  '<mxfile><diagram name="Red"><mxGraphModel><root><mxCell id="0"/>' +
  '<mxCell id="1" parent="0"/><mxCell id="2" value="Router" vertex="1" parent="1"/></root></mxGraphModel></diagram></mxfile>';

const VAULT = {
  "Plan.md": "---\nestado: activo\n---\n# Plan\n\nCon [[Idea]].",
  "Idea.md": "Una idea suelta.",
  "Eval/drawio/Red.drawio": RED,
  "Vacia.md": "",
};

/** Abre un índice nuevo sobre el vault, como la apertura de la app. */
async function abrir(vault = VAULT) {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  const ex = executorDe(db);
  client.setExecutor(ex);
  const disco = vaultEnMemoria(vault);
  contexto.setVaultActual("C:/vault");
  await indexer.crearEsquemaIndice();
  await indexer.indexarVault("C:/vault");
  return { db, ex, disco };
}

const contenidoEnIndice = (db, id) =>
  db.prepare("SELECT contenido FROM contenidos WHERE nota_id = ?").get(id)?.contenido;
// El contenido legible y lo que se busca sin mostrarse (los valores de las
// propiedades van a `extra`, `DEF-148`).
const filaDeBusqueda = (db, id) => {
  const fila = db
    .prepare("SELECT t.contenido, t.extra FROM fts_filas f JOIN notas_fts t ON t.rowid = f.fila WHERE f.nota_id = ?")
    .get(id);
  return fila && [fila.contenido, fila.extra].filter((t) => t).join("\n");
};
const sinContenido = (db) =>
  db
    .prepare("SELECT id FROM notas WHERE id NOT IN (SELECT nota_id FROM contenidos) ORDER BY id")
    .all()
    .map((r) => r.id);

test("un indexado que se corta después de escribir `notas` no deja la nota sin contenido", { skip: sinSqlite }, async () => {
  const { db, ex, disco } = await abrir({ "Plan.md": VAULT["Plan.md"] });
  // La IA escribe el diagrama desde la terminal; el watcher reindexa y la tanda
  // se corta en la sentencia de `contenidos`.
  disco.tocar("Eval/drawio/Red.drawio", RED);
  ex.fallarSi = (sql) => /INSERT INTO contenidos/.test(sql);
  await assert.rejects(indexer.indexarVault("C:/vault"), /database is locked/);
  ex.fallarSi = null;

  // El próximo cambio del vault (o la próxima apertura) la relee.
  await indexer.indexarVault("C:/vault");
  assert.equal(contenidoEnIndice(db, "Eval/drawio/Red.drawio"), RED);
  assert.ok(filaDeBusqueda(db, "Eval/drawio/Red.drawio"), "y su fila de búsqueda");
  assert.deepEqual(sinContenido(db), []);
  // Y de ahí en más, nada que releer.
  assert.equal((await indexer.indexarVault("C:/vault")).reindexadas, 0);
  client.setExecutor(null);
});

test("un corte en CUALQUIER sentencia de la tanda se recupera en el indexado siguiente", { skip: sinSqlite }, async () => {
  for (const patron of [/INSERT INTO contenidos/, /notas_fts/, /fts_filas/, /propiedades/, /INSERT INTO enlaces/]) {
    const { db, ex, disco } = await abrir({ "Idea.md": "x" });
    disco.tocar("Plan.md", VAULT["Plan.md"]);
    ex.fallarSi = (sql) => patron.test(sql);
    await indexer.indexarVault("C:/vault").catch(() => {});
    ex.fallarSi = null;
    await indexer.indexarVault("C:/vault");
    assert.equal(contenidoEnIndice(db, "Plan.md"), VAULT["Plan.md"], String(patron));
    assert.match(filaDeBusqueda(db, "Plan.md") ?? "", /activo/, String(patron));
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM propiedades WHERE nota_id = 'Plan.md'").get().n, 1, String(patron));
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM enlaces WHERE desde_id = 'Plan.md'").get().n, 1, String(patron));
    client.setExecutor(null);
  }
});

test("un índice ya dañado (sin `contenidos` ni búsqueda) se repara al indexar, aunque el mtime no cambió", { skip: sinSqlite }, async () => {
  const { db } = await abrir();
  // Como quedó el índice de `DEF-121`: la fila de `notas` sí, lo demás no.
  db.prepare("DELETE FROM contenidos WHERE nota_id = ?").run("Eval/drawio/Red.drawio");
  db.prepare(
    "DELETE FROM notas_fts WHERE rowid IN (SELECT fila FROM fts_filas WHERE nota_id = ?)",
  ).run("Eval/drawio/Red.drawio");
  db.prepare("DELETE FROM fts_filas WHERE nota_id = ?").run("Eval/drawio/Red.drawio");
  // Y una con la fila de `fts_filas` pero sin la de `notas_fts`.
  db.prepare("DELETE FROM notas_fts WHERE rowid IN (SELECT fila FROM fts_filas WHERE nota_id = ?)").run("Idea.md");

  const r = await indexer.indexarVault("C:/vault");
  assert.equal(r.reindexadas, 2);
  assert.equal(contenidoEnIndice(db, "Eval/drawio/Red.drawio"), RED);
  assert.ok(filaDeBusqueda(db, "Eval/drawio/Red.drawio"));
  assert.equal(filaDeBusqueda(db, "Idea.md"), "Una idea suelta.");
  assert.deepEqual(sinContenido(db), []);
  client.setExecutor(null);
});

test("abrir una nota sin contenido en el índice lee el disco y lo repone; un archivo vacío sigue vacío", { skip: sinSqlite }, async () => {
  const { db } = await abrir();
  db.prepare("DELETE FROM contenidos WHERE nota_id = ?").run("Eval/drawio/Red.drawio");

  const leido = await contenidoDb.getContenido("Eval/drawio/Red.drawio");
  assert.equal(leido.contenido, RED, "no vacío: lo que hay en disco");
  assert.equal(contenidoEnIndice(db, "Eval/drawio/Red.drawio"), RED, "y el índice queda reparado");
  // El resto de lo derivado lo repone el próximo indexado: la nota quedó marcada.
  const r = await indexer.indexarVault("C:/vault");
  assert.equal(r.reindexadas, 1);
  assert.ok(filaDeBusqueda(db, "Eval/drawio/Red.drawio"));

  // Un archivo de 0 bytes es vacío de verdad.
  db.prepare("DELETE FROM contenidos WHERE nota_id = ?").run("Vacia.md");
  assert.equal((await contenidoDb.getContenido("Vacia.md")).contenido, "");
  assert.equal(contenidoEnIndice(db, "Vacia.md"), "");
  client.setExecutor(null);
});

test("abrir una nota sin contenido cuyo archivo ya no está devuelve vacío sin reponer nada", { skip: sinSqlite }, async () => {
  const { db, disco } = await abrir();
  db.prepare("DELETE FROM contenidos WHERE nota_id = ?").run("Idea.md");
  disco.archivos.delete("Idea.md");
  assert.equal((await contenidoDb.getContenido("Idea.md")).contenido, "");
  assert.equal(contenidoEnIndice(db, "Idea.md"), undefined);
  client.setExecutor(null);
});

test("guardar sin cambiar lo indexable repone la fila de búsqueda si falta", { skip: sinSqlite }, async () => {
  const { db } = await abrir();
  db.prepare("DELETE FROM notas_fts WHERE rowid IN (SELECT fila FROM fts_filas WHERE nota_id = ?)").run("Idea.md");
  db.prepare("DELETE FROM fts_filas WHERE nota_id = ?").run("Idea.md");
  await contenidoDb.putContenido("Idea.md", VAULT["Idea.md"]);
  assert.equal(filaDeBusqueda(db, "Idea.md"), "Una idea suelta.");
  client.setExecutor(null);
});

test("una fila de búsqueda que nadie anotó en `fts_filas` no queda duplicada al reparar", { skip: sinSqlite }, async () => {
  const { db } = await abrir();
  // Como lo deja una versión anterior a `fts_filas` que abrió el mismo índice:
  // la fila de búsqueda de `Idea.md` con un `rowid` que nadie anotó, y la de
  // `Plan.md` anotada a una fila que ya no existe.
  const filaIdea = db.prepare("SELECT fila FROM fts_filas WHERE nota_id = 'Idea.md'").get().fila;
  const vieja = db.prepare("SELECT nota_id, titulo, contenido FROM notas_fts WHERE rowid = ?").get(filaIdea);
  db.prepare("DELETE FROM notas_fts WHERE rowid = ?").run(filaIdea);
  db.prepare("DELETE FROM fts_filas WHERE nota_id = 'Idea.md'").run();
  db.prepare("INSERT INTO notas_fts (rowid, nota_id, titulo, contenido) VALUES (9000, ?, ?, ?)").run(
    vieja.nota_id,
    vieja.titulo,
    vieja.contenido,
  );
  db.prepare("DELETE FROM notas_fts WHERE rowid IN (SELECT fila FROM fts_filas WHERE nota_id = 'Plan.md')").run();

  assert.equal((await indexer.indexarVault("C:/vault")).reindexadas, 2);
  const filas = (id) => db.prepare("SELECT COUNT(*) AS n FROM notas_fts WHERE nota_id = ?").get(id).n;
  assert.equal(filas("Idea.md"), 1, "sin la fila huérfana");
  assert.equal(filas("Plan.md"), 1);
  assert.equal(filaDeBusqueda(db, "Idea.md"), "Una idea suelta.");
  // Y sano, el siguiente indexado no relee nada.
  assert.equal((await indexer.indexarVault("C:/vault")).reindexadas, 0);
  client.setExecutor(null);
});

test("abrir una nota que el explorador ya muestra y el índice todavía no la indexa a demanda (FUN-M-42)", { skip: sinSqlite }, async () => {
  const { db, disco } = await abrir();
  // Llegó desde fuera: el árbol la muestra con el evento del watcher, y el
  // indexado va unos cientos de milisegundos detrás.
  disco.tocar("Recien/llegada.md", "Recién [[Plan]]");
  assert.equal((await contenidoDb.getContenido("Recien/llegada.md")).contenido, "Recién [[Plan]]");
  assert.equal(contenidoEnIndice(db, "Recien/llegada.md"), "Recién [[Plan]]");
  assert.ok(filaDeBusqueda(db, "Recien/llegada.md"));
  // Lo que no está en disco sigue siendo «no existe».
  await assert.rejects(contenidoDb.getContenido("No/existe.md"), /no existe/);
  await assert.rejects(contenidoDb.getContenido("foto.png"), /no existe/);
  client.setExecutor(null);
});
