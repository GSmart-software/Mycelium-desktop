// Test headless de las estadísticas del dashboard de salud (`FUN-L-32`, parte
// B): la lógica pura de `lib/estadisticas.ts` con datos sintéticos (grupos,
// extensiones raras, sin extensión, vault vacío, cubos, componentes, fechas no
// confiables, sumas coherentes) y, contra un SQLite de verdad indexado por el
// indexador de la app, que las cifras coinciden con las de las otras vistas:
// conexiones = `conteoConexiones` de la barra de estado, huérfanas = las de
// `calcularSalud`, etiquetas = las filas de `etiquetas`.
//
// La parte de SQLite necesita `better-sqlite3`, como `test-indice-ia.mjs`; sin
// él se SALTA (y lo dice).
//
//   MYCELIUM_BETTER_SQLITE3=/ruta/a/node_modules/better-sqlite3 node --test scripts/test-estadisticas.mjs
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
const PROPIEDADES = await fuente("../lib/db/propiedades.ts", {
  "@/lib/textoBuscable": await fuente("../lib/textoBuscable.ts", { "@/lib/canvas": await fuente("../lib/canvas.ts") }),
  "@/lib/frontmatter": FRONTMATTER,
  "./client": CLIENT,
  "./fts": FTS,
  "./ftsIndice": FTS_INDICE,
  "./util": UTIL,
});
const ENLACES_INDICE = await fuente("../lib/db/enlacesIndice.ts", {
  "./propiedades": PROPIEDADES,
  "@/lib/enlacesNota": ENLACES_NOTA,
  "@/lib/wikilinks": WIKILINKS,
  "./client": CLIENT,
  "./fts": FTS,
  "./ftsIndice": FTS_INDICE,
  "./util": UTIL,
});
const EVENTOS = await fuente("../lib/eventos.ts");
const INDEXER = await fuente("../lib/db/indexer.ts", {
  "@/lib/eventos": EVENTOS,
  "@/lib/arbolVivo": await fuente("../lib/arbolVivo.ts"),
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
const INDICE_IA = await fuente("../lib/db/indiceIa.ts", { "./client": CLIENT, "./propiedades": PROPIEDADES });
const GRAFO = await fuente("../lib/db/grafo.ts", { "./client": CLIENT, "./errors": ERRORS, "./propiedades": PROPIEDADES });

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
const E = await import(await fuente("../lib/estadisticas.ts"));

// ── Composición ─────────────────────────────────────────────────────────────

test("grupos y extensiones: mayúsculas, sin extensión, archivos con punto, .base en Otros", () => {
  assert.equal(E.extensionDe("a/b/Foto.JPG"), "jpg");
  assert.equal(E.extensionDe(".gitignore"), "");
  assert.equal(E.extensionDe("carpeta.con.punto/LEEME"), "");
  assert.equal(E.extensionDe("x/archivo.tar.gz"), "gz");
  assert.equal(E.grupoDeExtension("md"), "notas");
  assert.equal(E.grupoDeExtension("SVG"), "imagenes");
  assert.equal(E.grupoDeExtension("pdf"), "pdf");
  for (const v of ["excalidraw", "drawio", "canvas"]) assert.equal(E.grupoDeExtension(v), "visuales");
  for (const o of ["base", "", "txt", "gz", "markdown"]) assert.equal(E.grupoDeExtension(o), "otros");
});

const ARCHIVOS = [
  { ruta: "Inicio.md", bytes: 100 },
  { ruta: "LEEME", bytes: 7 },
  { ruta: ".gitignore", bytes: 3 },
  { ruta: "Tablas.base", bytes: 50 },
  { ruta: "notas/a.md", bytes: 200 },
  { ruta: "notas/sub/b.md", bytes: 300 },
  { ruta: "notas/plano.drawio", bytes: 1000 },
  { ruta: "adjuntos/foto.PNG", bytes: 5000 },
  { ruta: "adjuntos/doc.pdf", bytes: 9000 },
  { ruta: "adjuntos/raro.xyz", bytes: 1 },
  { ruta: "adjuntos/vacio.txt", bytes: 0 },
];

test("composición: totales, grupos, tipos, carpetas y los más pesados suman lo mismo", () => {
  const c = E.calcularComposicion(ARCHIVOS);
  assert.deepEqual(c.total, { cantidad: 11, bytes: 15661 });
  assert.deepEqual(c.porGrupo, {
    notas: { cantidad: 3, bytes: 600 },
    imagenes: { cantidad: 1, bytes: 5000 },
    pdf: { cantidad: 1, bytes: 9000 },
    visuales: { cantidad: 1, bytes: 1000 },
    otros: { cantidad: 5, bytes: 61 },
  });
  const sinExt = c.porTipo.find((t) => t.extension === "");
  assert.deepEqual(sinExt, { extension: "", grupo: "otros", cantidad: 2, bytes: 10 });
  // Un tipo conocido con cero archivos está, con 0 (para la tabla del informe).
  assert.deepEqual(c.porTipo.find((t) => t.extension === "webp"), { extension: "webp", grupo: "imagenes", cantidad: 0, bytes: 0 });
  assert.equal(c.porTipo[0].extension, "pdf", "por bytes descendente");
  assert.deepEqual(c.carpetas.map((x) => x.carpeta), ["adjuntos", "notas", E.RAIZ]);
  const raiz = c.carpetas.find((x) => x.carpeta === E.RAIZ);
  assert.deepEqual({ cantidad: raiz.cantidad, bytes: raiz.bytes }, { cantidad: 4, bytes: 160 });
  assert.equal(raiz.grupoMayor, "notas");
  assert.equal(c.carpetas[0].grupoMayor, "pdf");
  assert.equal(c.carpetas[1].grupoMayor, "visuales", "el drawio pesa más que las dos notas");
  assert.deepEqual(c.masPesados.map((p) => p.ruta), ["adjuntos/doc.pdf", "adjuntos/foto.PNG", "notas/plano.drawio", "notas/sub/b.md", "notas/a.md"]);
  assert.equal(c.masPesados[1].grupo, "imagenes");
  assert.deepEqual(E.incoherencias({ archivos: c, red: E.calcularRed({ notas: [], aristas: [], excluida: () => false }) }), []);
});

test("composición de un vault vacío: todo en cero, sin carpetas ni pesados", () => {
  const c = E.calcularComposicion([]);
  assert.deepEqual(c.total, { cantidad: 0, bytes: 0 });
  for (const g of E.GRUPOS) assert.deepEqual(c.porGrupo[g], { cantidad: 0, bytes: 0 });
  assert.deepEqual(c.carpetas, []);
  assert.deepEqual(c.masPesados, []);
  assert.equal(c.porTipo.length, E.EXTENSIONES_CONOCIDAS.length);
  assert.ok(c.porTipo.every((t) => t.cantidad === 0));
});

test("un tamaño que no llegó (binario sin `bytes`) cuenta como 0, no como NaN", () => {
  const c = E.calcularComposicion([{ ruta: "a.md", bytes: undefined }, { ruta: "b.png", bytes: Number.NaN }]);
  assert.deepEqual(c.total, { cantidad: 2, bytes: 0 });
});

// ── La red ──────────────────────────────────────────────────────────────────

const n = (id, tipo = "markdown") => {
  const b = id.lastIndexOf("/");
  return { id, titulo: id.slice(b + 1).replace(/\.[^.]+$/, ""), carpetaId: b < 0 ? null : id.slice(0, b), tipo };
};
const fuera = (nota) => SALUD.excluida(nota, "Esporas");

test("aristas: pares distintos, sin lazos, sin destino nulo ni fuera del índice", () => {
  const ids = new Set(["A.md", "B.md"]);
  const filas = [
    { desde: "A.md", destino: "B.md" },
    { desde: "A.md", destino: "B.md" },
    { desde: "A.md", destino: "A.md" },
    { desde: "A.md", destino: null },
    { desde: "A.md", destino: "Borrada.md" },
    { desde: "B.md", destino: "A.md" },
  ];
  assert.deepEqual(E.aristasDe(filas, ids), [["A.md", "B.md"], ["B.md", "A.md"]]);
});

test("red: cubos, huérfanas, componentes con lienzos que unen, Esporas fuera", () => {
  const notas = [
    n("Hub.md"), n("A.md"), n("B.md"), n("C.md"), // red principal
    n("X.md"), n("Y.md"), // una isla
    n("L.canvas", "canvas"), n("P.md"), n("Q.md"), // otra isla, unida por un lienzo
    n("Suelta.md"), n("Sale.md"), // sin conexiones / huérfana que enlaza
    n("Esporas/Molde.md"), n("CLAUDE.md"),
  ];
  const filas = [
    ["Hub.md", "A.md"], ["Hub.md", "B.md"], ["Hub.md", "C.md"], ["A.md", "Hub.md"],
    ["X.md", "Y.md"],
    ["L.canvas", "P.md"], ["L.canvas", "Q.md"],
    ["Sale.md", "Hub.md"],
    ["CLAUDE.md", "Hub.md"],
    ["Esporas/Molde.md", "X.md"],
  ].map(([desde, destino]) => ({ desde, destino }));
  const aristas = E.aristasDe(filas, new Set(notas.map((x) => x.id)));
  const red = E.calcularRed({ notas, aristas, excluida: fuera });
  // Población: los markdown sin Esporas ni CLAUDE.md = 10.
  assert.equal(red.notas, 10);
  assert.equal(red.sinConexiones, 1, "Suelta");
  assert.equal(red.conectadas, 9);
  assert.equal(red.porcentajeConectadas, 90);
  // Hub: salen 3, llegan A, Sale y CLAUDE = 6.
  assert.deepEqual(red.masConectadas[0], { ruta: "Hub.md", titulo: "Hub", conexiones: 6, salientes: 3, entrantes: 3 });
  // Componentes: {Hub,A,B,C,Sale,CLAUDE}, {X,Y,Molde}, {L,P,Q}.
  assert.equal(red.componentes, 3);
  assert.equal(red.islas, 2);
  assert.equal(red.redPrincipal, 5);
  // Huérfanas: nadie llega a Sale ni a Suelta (L no es población). A X llega la Espora, como en calcularSalud.
  assert.equal(red.huerfanas, 2);
  const porCubo = Object.fromEntries(red.histograma.map((c) => [c.etiqueta, [c.notas, c.huerfanas]]));
  assert.deepEqual(porCubo, { "0": [1, 1], "1": [6, 1], "2": [2, 0], "3–5": [0, 0], "6–10": [1, 0], "11–20": [0, 0], "21+": [0, 0] });
  // Y coincide con las huérfanas del informe de salud.
  const informe = SALUD.calcularSalud({
    notas, carpetas: [], otros: [], carpetaEsporas: "Esporas",
    filas: filas.map((f) => ({ ...f, texto: f.destino, tipo: "enlace", n: 1 })),
  });
  assert.equal(informe.huerfanas.length, red.huerfanas);
});

test("cubos: los bordes de cada rango", () => {
  const casos = { 0: "0", 1: "1", 2: "2", 3: "3–5", 5: "3–5", 6: "6–10", 10: "6–10", 11: "11–20", 20: "11–20", 21: "21+", 500: "21+" };
  for (const [k, v] of Object.entries(casos)) assert.equal(E.CUBOS_CONEXIONES[E.cuboDe(Number(k))].etiqueta, v, k);
});

test("red vacía: sin notas no hay división por cero", () => {
  const red = E.calcularRed({ notas: [], aristas: [], excluida: fuera });
  assert.equal(red.porcentajeConectadas, 0);
  assert.equal(red.componentes, 0);
  assert.equal(red.redPrincipal, 0);
  assert.equal(red.islas, 0);
});

// ── Crecimiento ─────────────────────────────────────────────────────────────

const local = (a, m, d = 15, h = 12) => new Date(a, m - 1, d, h).toISOString();

test("crecimiento: 12 meses en hora local, fuera de ventana no cuenta, fechas ilegibles tampoco", () => {
  const ahora = new Date(2026, 10, 2, 10); // 2026-11-02
  const fechas = [local(2026, 11, 1, 0), local(2026, 10, 31, 23), local(2025, 12), local(2025, 12, 1), local(2025, 11, 30), local(2025, 10), "no es fecha"];
  const c = E.calcularCrecimiento(fechas, ahora);
  assert.equal(c.meses.length, 12);
  assert.equal(c.meses[0].mes, "2025-12");
  assert.equal(c.meses[11].mes, "2026-11");
  assert.equal(c.meses[11].notas, 1, "el 1 de noviembre a las 0 h es noviembre aunque en UTC no lo sea");
  assert.equal(c.meses[10].notas, 1);
  assert.equal(c.meses[0].notas, 2);
  assert.equal(c.total, 4);
  assert.equal(c.confiable, true);
});

test("crecimiento: una indexación inicial que se lleva casi todo no es confiable; una tanda chica sí", () => {
  const ahora = new Date(2026, 10, 2);
  const inicial = local(2026, 7, 21);
  const todas = [...Array(40).fill(inicial), ...Array.from({ length: 5 }, (_, i) => local(2026, 8 + i, 3))];
  const c = E.calcularCrecimiento(todas, ahora);
  assert.equal(c.confiable, false);
  assert.deepEqual(c.lote, { fecha: inicial, notas: 40 });
  // 19 iguales (menos que el mínimo) en 20: confiable igual.
  assert.equal(E.calcularCrecimiento([...Array(19).fill(inicial), local(2026, 9)], ahora).confiable, true);
  // 25 iguales en 200 (12,5 %): confiable.
  const muchas = [...Array(25).fill(inicial), ...Array.from({ length: 175 }, (_, i) => new Date(2026, 0, 1 + i).toISOString())];
  assert.equal(E.calcularCrecimiento(muchas, ahora).confiable, true);
  // Vault vacío: confiable (nada que decir), todo en cero.
  const vacio = E.calcularCrecimiento([], ahora);
  assert.equal(vacio.confiable, true);
  assert.equal(vacio.lote, null);
  assert.equal(vacio.total, 0);
});

// ── Todo junto ──────────────────────────────────────────────────────────────

test("calcularEstadisticas: coherente, enlaces y promedio, crecimiento de la población", () => {
  const notas = [n("A.md"), n("B.md"), n("L.canvas", "canvas"), n("Esporas/M.md")];
  const e = E.calcularEstadisticas({
    archivos: ARCHIVOS,
    notas,
    filas: [{ desde: "A.md", destino: "B.md" }, { desde: "L.canvas", destino: "A.md" }],
    excluida: fuera,
    creacion: notas.map((x) => ({ id: x.id, creadoEn: local(2026, 10) })),
    etiquetas: { distintas: 0, notasConEtiqueta: 0, masUsadas: [] },
    ahora: new Date(2026, 10, 2),
  });
  assert.deepEqual(E.incoherencias(e), []);
  assert.deepEqual(e.enlaces, { total: 2, promedioPorNota: 0.5, notasIndice: 4 });
  assert.equal(e.crecimiento.total, 2, "solo A y B: ni el lienzo ni la Espora");
  assert.equal(e.red.notas, 2);
});

// ── Contra el índice de verdad ──────────────────────────────────────────────

const VAULT = {
  "Mapa.md": "Ver [[Idea|la idea]] y [[Idea#Origen]] y [[Idea]].\n[[Fantasma]] [[Plan]] #proyecto #Proyecto\n",
  "Idea.md": "## Origen\n[[Mapa]] #idea\n",
  "Plan.md": "---\ntags: [proyecto, idea]\n---\n[[Mapa]] [[Plan]] #proyecto\n",
  "proyectos/Plan.md": "Otro plan. #proyécto\n",
  "Esporas/Reunión.md": "#plantilla [[Idea]]\n",
  "Suelta.md": "Sola.\n",
  "Borrada.md": "[[Idea]] #idea\n",
  "L.canvas": JSON.stringify({ nodes: [{ id: "a", type: "file", file: "Suelta.md", x: 0, y: 0, width: 1, height: 1 }] }),
  "CLAUDE.md": "[[Plan]] #instrucciones\n",
};

test("sobre el índice: conexiones = conteoConexiones, huérfanas = calcularSalud, etiquetas agregadas en SQL", { skip: sinSqlite }, async () => {
  const db = await abrir(VAULT);
  // Una nota en la papelera: no cuenta en ninguna punta.
  db.prepare(
    "INSERT INTO papelera (id, nota_id, ruta_original, carpeta_original_id, eliminado_en) VALUES ('p1', 'Borrada.md', 'Borrada.md', NULL, '2026-11-01')",
  ).run();
  const grafo = await import(GRAFO);
  const [notas, carpetas, filas, creacion] = await Promise.all([
    indiceIa.notasDelIndice(),
    indiceIa.carpetasDelIndice(),
    indiceIa.filasDelIndice(),
    indiceIa.fechasDeCreacion(),
  ]);
  const excluidas = notas.filter(fuera).map((x) => x.id);
  assert.deepEqual(excluidas.sort(), ["CLAUDE.md", "Esporas/Reunión.md"]);
  const etiquetas = await indiceIa.etiquetasDelIndice(excluidas, E.TOPE_ETIQUETAS);
  const e = E.calcularEstadisticas({
    archivos: Object.entries(VAULT).map(([ruta, t]) => ({ ruta, bytes: Buffer.byteLength(t) })),
    notas, filas, excluida: fuera, creacion, etiquetas, ahora: new Date(),
  });
  assert.deepEqual(E.incoherencias(e), []);

  // Cada nota: la cifra de la barra de estado.
  const ids = new Set(notas.map((x) => x.id));
  const grados = E.gradosDe(E.aristasDe(filas, ids));
  for (const nota of notas) {
    const barra = await grafo.conteoConexiones(nota.id);
    const g = grados.get(nota.id) ?? { salientes: 0, entrantes: 0 };
    assert.deepEqual({ s: g.salientes, r: g.entrantes }, { s: barra.salientes, r: barra.retro }, nota.id);
  }
  // Y las aristas, las del grafo global (que no tiene el JOIN, pero acá no hay destinos fuera de `notas`).
  assert.equal(e.enlaces.total, (await grafo.grafo(LOCAL_VAULT_ID)).aristas.length);

  const informe = SALUD.calcularSalud({ notas, carpetas, filas, otros: [], carpetaEsporas: "Esporas" });
  assert.equal(e.red.huerfanas, informe.huerfanas.length);
  assert.deepEqual(
    informe.huerfanas.map((h) => h.ruta).sort(),
    notas.filter((x) => x.tipo === "markdown" && !fuera(x) && !(grados.get(x.id)?.entrantes > 0)).map((x) => x.id).sort(),
  );

  // Etiquetas: sin la Espora, sin CLAUDE.md, sin la papelera; `#Proyecto`, `#proyecto` y `#proyécto` son una.
  const filasTag = db.prepare("SELECT nota_id, tag_plegado FROM etiquetas").all()
    .filter((f) => f.nota_id !== "Borrada.md" && !excluidas.includes(f.nota_id));
  assert.equal(new Set(filasTag.map((f) => f.tag_plegado)).size, etiquetas.distintas);
  assert.equal(new Set(filasTag.map((f) => f.nota_id)).size, etiquetas.notasConEtiqueta);
  assert.deepEqual(etiquetas.masUsadas.map((t) => t.notas), [3, 2]);
  assert.equal(etiquetas.masUsadas[0].etiqueta.toLowerCase().normalize("NFD").replace(/\p{M}/gu, ""), "proyecto");
});

test("etiquetas de un índice sin ninguna: ceros, en una sentencia", { skip: sinSqlite }, async () => {
  await abrir({ "A.md": "nada" });
  assert.deepEqual(await indiceIa.etiquetasDelIndice([], 8), { distintas: 0, notasConEtiqueta: 0, masUsadas: [] });
});
