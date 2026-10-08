// Test headless (sin navegador ni Tauri) del índice de enlaces (`FUN-L-25`,
// Parte A · `DEF-109`): las tablas `enlaces` y `etiquetas` que reemplazan el
// escaneo del vault entero en cada consulta del grafo.
//
//   - `derivarEnlaces` / `derivarEtiquetas` (`lib/enlacesNota.ts`): sin código,
//     alias, ancla, embed, canvas y los tipos que no se escanean;
//   - el grafo que sale de la tabla es el MISMO que armaba el escaneo, arista
//     por arista y etiqueta por etiqueta (la referencia de abajo es el
//     algoritmo de `lib/db/grafo.ts` hasta `FUN-L-25`, copiado);
//   - con SQLite de verdad: el indexador llena las tablas, la migración de un
//     índice anterior, el guardado, y la re-resolución dirigida al crear,
//     renombrar, mover, mandar a la papelera y recuperar.
//
// La parte con SQLite necesita `better-sqlite3`, que el repo no trae (es
// nativo, y la app usa el SQLite del plugin de Tauri). Se busca en
// `node_modules` y, si no, en la carpeta que diga `MYCELIUM_BETTER_SQLITE3`;
// sin él, esos tests se SALTAN (y lo dicen).
//
//   node --test scripts/test-enlaces-nota.mjs
//   MYCELIUM_BETTER_SQLITE3=/ruta/a/node_modules/better-sqlite3 node --test scripts/test-enlaces-nota.mjs
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
const NOTAS_DB = await fuente("../lib/db/notas.ts", {
  "@/lib/enlacesNota": ENLACES_NOTA,
  "@/lib/extensionesDeTipo": EXTENSIONES,
  "./client": CLIENT,
  "./enlacesIndice": ENLACES_INDICE,
  "./ftsIndice": FTS,
  "./errors": ERRORS,
  "./indexer": INDEXER,
  "./propiedades": PROPIEDADES,
  "./util": UTIL,
  "./vaultContext": CONTEXTO,
  "./vaultFs": VAULTFS,
});
const PAPELERA = await fuente("../lib/db/papelera.ts", {
  "./client": CLIENT,
  "./ftsIndice": FTS,
  "./enlacesIndice": ENLACES_INDICE,
  "./estadoVault": await fuente("../lib/db/estadoVault.ts", {
    "@tauri-apps/api/core": TAURI,
    "./client": CLIENT,
    "./vaultContext": CONTEXTO,
  }),
  "./errors": ERRORS,
  "./util": UTIL,
  "./vaultContext": CONTEXTO,
  "./vaultFs": VAULTFS,
});
const GRAFO = await fuente("../lib/db/grafo.ts", { "./client": CLIENT, "./errors": ERRORS });

const { derivarEnlaces, derivarEtiquetas, claveDeEnlace, claveSinAncla, clavesDeTitulo, resolverEnlace } =
  await import(ENLACES_NOTA);
const { partirWikilink, indexarPorTitulo, resolveWikilinkEnIndice } = await import(WIKILINKS);
const { referenciasDe } = await import(CANVAS);
const { etiquetasDe } = await import(FRONTMATTER);
const { sinCodigo } = await import(SINCODIGO);

// ── Extracción pura ───────────────────────────────────────────────────────────

const soloTexto = (lista) => lista.map((e) => `${e.tipo}:${e.texto}×${e.n}`);

test("derivarEnlaces: alias, ruta, ancla, embed y repeticiones", () => {
  const texto = [
    "[[Plan]] y otra vez [[Plan|el plan]] y [[Proyectos/Plan]]",
    "Con ancla: [[Plan#Objetivos]] y bloque [[Idea#^abc123]]; sola: [[#Arriba]]",
    "Embed: ![[Boceto.excalidraw]] y ![[Plan]]",
  ].join("\n");
  assert.deepEqual(soloTexto(derivarEnlaces(texto, "markdown")), [
    "enlace:Plan×2",
    "enlace:Proyectos/Plan×1",
    "enlace:Plan#Objetivos×1",
    "enlace:Idea#^abc123×1",
    "embed:Boceto.excalidraw×1",
    "embed:Plan×1",
  ]);
});

test("el ancla: se resuelve el texto entero y, si no, sin el ancla", () => {
  const notas = [
    { id: "Plan.md", titulo: "Plan", carpetaId: null },
    { id: "Q# y Quantum.md", titulo: "Q# y Quantum", carpetaId: null },
    { id: "C#/Estudio/Nota.md", titulo: "Nota", carpetaId: "C#/Estudio" },
  ];
  const carpetas = [
    { id: "C#", nombre: "C#", padreId: null },
    { id: "C#/Estudio", nombre: "Estudio", padreId: "C#" },
  ];
  const porTitulo = indexarPorTitulo(notas);
  const ids = new Set(notas.map((n) => n.id));
  const r = (texto) => resolverEnlace({ tipo: "enlace", texto }, porTitulo, carpetas, ids);
  assert.equal(r("Plan#Objetivos"), "Plan.md");
  assert.equal(r("Plan#^bloque"), "Plan.md");
  assert.equal(r("Q# y Quantum"), "Q# y Quantum.md", "un título con # resuelve entero");
  assert.equal(r("Q# y Quantum#Sección"), "Q# y Quantum.md");
  assert.equal(r("C#/Estudio/Nota"), "C#/Estudio/Nota.md", "una carpeta con # sigue siendo pista");
  assert.equal(r("C#/Estudio/Nota#Sección"), "C#/Estudio/Nota.md", "el ancla está en el último segmento");
  assert.equal(r("Plan#H1#H2"), "Plan.md", "encabezado anidado");
  assert.equal(r("Nada#x"), null);
  // Y las claves por donde se re-resuelven.
  assert.equal(claveSinAncla("Plan#Objetivos"), "plan");
  assert.equal(claveDeEnlace("C#/Estudio/Nota"), "nota");
  assert.equal(claveSinAncla("C#/Estudio/Nota"), null, "el # de la carpeta no es ancla");
  assert.equal(claveSinAncla("Q# y Quantum#Intro"), "q");
  assert.ok(clavesDeTitulo("Q# y Quantum").includes("q"), "el título con # alcanza esa fila");
  assert.equal(claveSinAncla("Plan"), null);
});

test("derivarEnlaces: la barra escapada de una tabla también es alias (DEF-045)", () => {
  const ESC = String.fromCharCode(92) + "|";
  assert.deepEqual(soloTexto(derivarEnlaces(`| [[Destino${ESC}alias]] | x |`, "markdown")), [
    "enlace:Destino×1",
  ]);
});

test("derivarEnlaces: sin el código (DEF-102), pero con el frontmatter (FUN-M-04)", () => {
  const texto = [
    "---",
    "relacionado: \"[[Madre]]\"",
    "---",
    "Texto con `[[EnLinea]]` y",
    "```",
    "[[EnBloque]]",
    "```",
    "y [[Real]]",
  ].join("\n");
  assert.deepEqual(soloTexto(derivarEnlaces(texto, "markdown")), ["enlace:Madre×1", "enlace:Real×1"]);
});

test("derivarEnlaces: base y drawio no se escanean; excalidraw sí", () => {
  assert.deepEqual(derivarEnlaces("filtro: '[[Algo]]'", "base"), []);
  assert.deepEqual(derivarEnlaces('<mxCell value="[[Algo]]"/>', "drawio"), []);
  assert.deepEqual(soloTexto(derivarEnlaces('{"text":"[[Algo]]"}', "excalidraw")), ["enlace:Algo×1"]);
  assert.deepEqual(derivarEnlaces("", "markdown"), []);
});

test("derivarEnlaces: un canvas aporta sus tarjetas de texto y de nota, no las flechas", () => {
  const canvas = JSON.stringify({
    nodes: [
      { id: "a", type: "text", text: "Ver [[Carpeta/Plan|el plan]] y [[Idea#sec]]", x: 0, y: 0, width: 10, height: 10 },
      { id: "b", type: "file", file: "Proyectos/Boceto.excalidraw", x: 0, y: 0, width: 10, height: 10 },
      { id: "c", type: "text", text: "de nuevo [[Plan]]", x: 0, y: 0, width: 10, height: 10 },
    ],
    edges: [{ id: "e", fromNode: "a", toNode: "b" }],
  });
  assert.deepEqual(soloTexto(derivarEnlaces(canvas, "canvas")), [
    "canvas:Plan×2",
    "canvas:Idea#sec×1",
    "archivo:Proyectos/Boceto.excalidraw×1",
  ]);
  assert.deepEqual(derivarEnlaces("no es json", "canvas"), []);
});

test("derivarEtiquetas: frontmatter + cuerpo, sin código, y nada en lo que no es prosa", () => {
  const texto = "---\ntags: [proyecto, activo]\n---\nUn #tema y `#0F6E56` y #Tema otra vez\n";
  assert.deepEqual(derivarEtiquetas(texto, "markdown"), ["proyecto", "activo", "tema"]);
  assert.deepEqual(derivarEtiquetas("#algo", "base"), []);
  assert.deepEqual(derivarEtiquetas("#algo", "canvas"), []);
  assert.deepEqual(derivarEtiquetas("", "markdown"), []);
});

test("claveDeEnlace y clavesDeTitulo: por dónde se re-resuelve", () => {
  assert.equal(claveDeEnlace("Carpeta/Plan"), "plan");
  assert.equal(claveDeEnlace("Boceto.excalidraw"), "boceto.excalidraw");
  assert.equal(claveDeEnlace("A/B/Árbol.md"), "árbol.md", "minúsculas de JS, no el lower() ASCII de SQLite");
  assert.equal(claveDeEnlace(" Nota / "), "nota");
  assert.equal(claveDeEnlace(""), "");
  const claves = clavesDeTitulo("Árbol");
  assert.ok(claves.includes("árbol") && claves.includes("árbol.md") && claves.includes("árbol.excalidraw"));
  // Toda fila cuya resolución depende de la nota «Árbol» tiene una de esas claves.
  for (const ref of ["Árbol", "árbol.md", "X/ÁRBOL", "Árbol.excalidraw"]) {
    assert.ok(claves.includes(claveDeEnlace(ref)), ref);
  }
});

// ── La referencia: el escaneo de `lib/db/grafo.ts` hasta `FUN-L-25` ──────────

const WIKILINK_RE = /\[\[([^[\]]+)\]\]/g;

/**
 * El grafo como lo armaba `buildVaultGraph`: lee el contenido de cada nota que
 * no está en la papelera y lo escanea. Copiado tal cual (salvo la forma de la
 * entrada), con UNA opción: `sinAncla`, que aplica la única diferencia
 * deliberada del índice (si el texto entero no resuelve, se prueba sin el
 * ancla). Con `false` es el de antes.
 */
function grafoPorEscaneo({ notas, carpetas, papelera }, { sinAncla = false } = {}) {
  const filas = notas.filter((n) => !papelera.has(n.id));
  // Con el `tipo` (`DEF-120`): el resolutor lo necesita para que `x.excalidraw`
  // busque solo entre dibujos, igual que el índice de `crearResolutor`.
  const indice = indexarPorTitulo(
    filas.map((f) => ({ id: f.id, titulo: f.titulo, carpetaId: f.carpeta_id, tipo: f.tipo })),
  );
  const cs = carpetas.map((c) => ({ id: c.id, nombre: c.nombre, padreId: c.padre_id }));
  const resolver = (ref) => {
    const entero = resolveWikilinkEnIndice(ref, indice, cs)?.id;
    if (entero || !sinAncla) return entero;
    // El ancla, en el último segmento: primero el corte más largo.
    const i = ref.lastIndexOf("/");
    const seg = ref.slice(i + 1);
    if (!seg.includes("#")) return undefined;
    for (const corte of [seg.lastIndexOf("#"), seg.indexOf("#")]) {
      const d = resolveWikilinkEnIndice((ref.slice(0, i + 1) + seg.slice(0, corte)).trim(), indice, cs)?.id;
      if (d) return d;
    }
    return undefined;
  };
  const titulos = new Map();
  const contenidos = new Map();
  const canvas = new Map();
  for (const f of filas) {
    titulos.set(f.id, f.titulo);
    if (f.contenido && f.tipo !== "base" && f.tipo !== "canvas" && f.tipo !== "drawio") contenidos.set(f.id, f.contenido);
    if (f.contenido && f.tipo === "canvas") canvas.set(f.id, f.contenido);
  }
  const vistas = new Set();
  const aristas = [];
  const agregar = (desde, hasta) => {
    if (hasta === desde) return;
    const k = `${desde}\u0000${hasta}`;
    if (vistas.has(k)) return;
    vistas.add(k);
    aristas.push({ source: desde, target: hasta });
  };
  for (const [id, json] of canvas) {
    const { titulos: ts, rutas } = referenciasDe(json);
    for (const t of ts) {
      const d = resolver(t);
      if (d) agregar(id, d);
    }
    for (const r of rutas) if (titulos.has(r)) agregar(id, r);
  }
  for (const [id, contenido] of contenidos) {
    const texto = sinCodigo(contenido);
    for (let m = WIKILINK_RE.exec(texto); m !== null; m = WIKILINK_RE.exec(texto)) {
      const d = resolver(partirWikilink(m[1]).destino);
      if (d) agregar(id, d);
    }
  }
  const tags = new Map();
  for (const f of filas) {
    const c = contenidos.get(f.id);
    tags.set(f.id, c ? etiquetasDe(c, sinCodigo) : []);
  }
  return { nodos: filas.map((f) => f.id), aristas, tags, titulos, contenidos };
}

/** Compara dos grafos arista por arista y etiqueta por etiqueta. */
function diferencias(nuevo, viejo) {
  const clave = (a) => `${a.source} → ${a.target}`;
  const an = new Set(nuevo.aristas.map(clave));
  const av = new Set(viejo.aristas.map(clave));
  const tagsNuevo = new Map(nuevo.nodos.map((n) => [n.id, n.tags ?? []]));
  return {
    nodos: {
      sobran: nuevo.nodos.map((n) => n.id).filter((id) => !viejo.nodos.includes(id)),
      faltan: viejo.nodos.filter((id) => !tagsNuevo.has(id)),
    },
    aristas: {
      sobran: [...an].filter((k) => !av.has(k)),
      faltan: [...av].filter((k) => !an.has(k)),
    },
    etiquetas: [...viejo.tags].filter(([id, t]) => JSON.stringify(t) !== JSON.stringify(tagsNuevo.get(id))),
    conexiones: nuevo.nodos.filter((n) => {
      const grado = viejo.aristas.filter((a) => a.source === n.id || a.target === n.id).length;
      return grado !== n.conexiones;
    }),
  };
}

// ── Con SQLite ────────────────────────────────────────────────────────────────

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
const notasDb = await import(NOTAS_DB);
const papeleraDb = await import(PAPELERA);
const grafoDb = await import(GRAFO);

/** Executor sobre un SQLite en memoria, con las claves foráneas como sqlx. */
function executorDe(db) {
  const correr = (sql, params) => {
    const st = db.prepare(sql);
    if (st.reader) return { filas: st.all(...params), cambios: 0 };
    return { filas: [], cambios: st.run(...params).changes };
  };
  return {
    sentencias: [],
    async select(sql, params = []) {
      this.sentencias.push(sql);
      return correr(sql, params).filas;
    },
    async execute(sql, params = []) {
      this.sentencias.push(sql);
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
  const estado = new Map();
  const esDelVault = (r) => !r.startsWith(".mycelium/");
  globalThis.__invoke = async (cmd, a) => {
    switch (cmd) {
      case "recorrer_vault": {
        const rutas = [...archivos.keys()].filter(esDelVault);
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
      case "escribir_nota":
        archivos.set(a.rutaRel, a.contenido);
        mtimes.set(a.rutaRel, ++reloj);
        return reloj;
      case "mover_ruta":
        archivos.set(a.destinoRel, archivos.get(a.origenRel));
        mtimes.set(a.destinoRel, mtimes.get(a.origenRel));
        archivos.delete(a.origenRel);
        return null;
      case "copiar_archivo":
        archivos.set(a.destinoRel, archivos.get(a.origenRel));
        mtimes.set(a.destinoRel, ++reloj);
        return null;
      case "borrar_a_papelera": {
        const destino = `.mycelium/.trash/${a.rutaRel.replace(/\//g, "_")}`;
        archivos.set(destino, archivos.get(a.rutaRel));
        archivos.delete(a.rutaRel);
        return destino;
      }
      case "restaurar_de_papelera":
        archivos.set(a.destinoRel, archivos.get(a.rutaPapeleraRel));
        mtimes.set(a.destinoRel, ++reloj);
        archivos.delete(a.rutaPapeleraRel);
        return null;
      case "leer_estado_vault":
        return estado.get(a.nombre) ?? null;
      case "escribir_estado_vault":
        estado.set(a.nombre, a.contenido);
        return null;
      default:
        throw new Error(`comando inesperado: ${cmd}`);
    }
  };
  return archivos;
}

const CANVAS_DE_PRUEBA = JSON.stringify({
  nodes: [
    { id: "a", type: "text", text: "[[Idea]] y [[Futura]]", x: 0, y: 0, width: 10, height: 10 },
    { id: "b", type: "file", file: "Proyectos/Plan.md", x: 0, y: 0, width: 10, height: 10 },
  ],
  edges: [],
});

/** Un vault chico con cada caso: homónimas, embeds, canvas, base, código, tags. */
const VAULT = {
  "Plan.md": "---\ntags: [raiz]\n---\n# Plan\n\n[[Idea]] · [[Proyectos/Plan|el otro]] · ![[Boceto.excalidraw]] #plan",
  "Proyectos/Plan.md": "[[Plan]] y [[Plan]] otra vez, y a mí mismo: [[Proyectos/Plan]]\n```\n[[Idea]] #no\n```",
  "Proyectos/Boceto.excalidraw": '{"type":"excalidraw","elements":[{"text":"[[Árbol]]"}]}',
  "Zeta/Idea.md": "Una idea con [[Plan#Objetivos]] y un roto [[Futura]] y [[árbol]] #idea/sub",
  "Alfa/Idea.md": "---\nrelacionado: \"[[Zeta/Idea]]\"\ntags:\n  - alfa\n---\n#alfa #Beta",
  "Árbol.md": "Sin enlaces. #árbol",
  "C#/Q# y Quantum.md": "En una carpeta con # y con # en el título: [[Árbol#Raíces]] y [[#Arriba]]",
  "Índice.md": "[[Q# y Quantum]] · [[C#/Q# y Quantum#Intro]] · [[Q#]] · [[Plan#H1#H2]]",
  "Tablero.canvas": CANVAS_DE_PRUEBA,
  "Consulta.base": "filters: '[[Plan]]'",
  "Diagrama.drawio": '<mxCell value="[[Plan]]"/>',
};

/** Todo el índice, como lo leería el escaneo de antes. */
function indiceParaEscaneo(db) {
  return {
    notas: db
      .prepare("SELECT n.id, n.titulo, n.carpeta_id, n.tipo, c.contenido FROM notas n LEFT JOIN contenidos c ON c.nota_id = n.id")
      .all(),
    carpetas: db.prepare("SELECT id, nombre, padre_id FROM carpetas").all(),
    papelera: new Set(db.prepare("SELECT nota_id FROM papelera").all().map((r) => r.nota_id)),
  };
}

/** Abre un índice nuevo sobre el vault, como la apertura de la app. */
async function abrir(vault = VAULT) {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  const ex = executorDe(db);
  client.setExecutor(ex);
  const archivos = vaultEnMemoria(vault);
  contexto.setVaultActual("C:/vault");
  // El orden de la app (`vaultSessionStore`): el esquema ANTES del indexador.
  await indexer.crearEsquemaIndice();
  await indexer.indexarVault("C:/vault");
  return { db, ex, archivos };
}

const aristasDesde = (g, id) => g.aristas.filter((a) => a.source === id).map((a) => a.target).sort();
const aristasHacia = (g, id) => g.aristas.filter((a) => a.target === id).map((a) => a.source).sort();

test("el grafo por tabla es el del escaneo, arista por arista y etiqueta por etiqueta", { skip: sinSqlite }, async () => {
  const { db } = await abrir();
  const nuevo = await grafoDb.grafo(contexto.LOCAL_VAULT_ID);
  const d = diferencias(nuevo, grafoPorEscaneo(indiceParaEscaneo(db), { sinAncla: true }));
  assert.deepEqual(d, { nodos: { sobran: [], faltan: [] }, aristas: { sobran: [], faltan: [] }, etiquetas: [], conexiones: [] });
  // Contra el escaneo de ANTES, la única diferencia es el ancla: `[[Plan#Objetivos]]`.
  const antes = diferencias(nuevo, grafoPorEscaneo(indiceParaEscaneo(db)));
  assert.deepEqual(antes.aristas.sobran.sort(), ["C#/Q# y Quantum.md → Árbol.md", "Zeta/Idea.md → Plan.md", "Índice.md → Plan.md"]);
  assert.deepEqual(antes.aristas.faltan, []);
  assert.deepEqual(antes.etiquetas, []);
  // Y los casos, uno por uno.
  assert.deepEqual(aristasDesde(nuevo, "Plan.md"), ["Alfa/Idea.md", "Proyectos/Boceto.excalidraw", "Proyectos/Plan.md"]);
  assert.deepEqual(aristasDesde(nuevo, "Proyectos/Plan.md"), ["Plan.md"], "sin lazo ni lo del código");
  assert.deepEqual(aristasDesde(nuevo, "Tablero.canvas"), ["Alfa/Idea.md", "Proyectos/Plan.md"]);
  assert.deepEqual(aristasDesde(nuevo, "Consulta.base"), []);
  assert.deepEqual(aristasDesde(nuevo, "Diagrama.drawio"), []);
  assert.deepEqual(aristasDesde(nuevo, "Proyectos/Boceto.excalidraw"), ["Árbol.md"]);
  assert.deepEqual(aristasDesde(nuevo, "Índice.md"), ["C#/Q# y Quantum.md", "Plan.md"], "títulos y carpetas con #");
  assert.deepEqual(aristasDesde(nuevo, "C#/Q# y Quantum.md"), ["Árbol.md"]);
  const tags = Object.fromEntries(nuevo.nodos.map((n) => [n.id, n.tags]));
  assert.deepEqual(tags["Alfa/Idea.md"], ["alfa", "Beta"]);
  assert.deepEqual(tags["Proyectos/Plan.md"], []);
  assert.deepEqual(tags["Zeta/Idea.md"], ["idea/sub"]);
  client.setExecutor(null);
});

test("el grafo no lee contenido; las conexiones, solo el de quien cita", { skip: sinSqlite }, async () => {
  const { db, ex } = await abrir();
  ex.sentencias.length = 0;
  await grafoDb.grafo(contexto.LOCAL_VAULT_ID);
  assert.equal(ex.sentencias.filter((s) => /contenidos/.test(s)).length, 0);

  ex.sentencias.length = 0;
  const con = await grafoDb.conexiones("Plan.md");
  assert.deepEqual(con.salientes.map((s) => s.id), ["Alfa/Idea.md", "Proyectos/Plan.md", "Proyectos/Boceto.excalidraw"]);
  assert.deepEqual(con.retro.map((r) => r.id), ["Proyectos/Plan.md", "Zeta/Idea.md", "Índice.md"]);
  assert.match(con.retro[0].fragmento, /\[\[Plan\]\]/);
  // Una sola consulta de contenido, con los tres que citan (ninguno es canvas).
  const deContenido = ex.sentencias.filter((s) => /FROM contenidos/.test(s));
  assert.equal(deContenido.length, 1);

  // El mini-grafo y los grados coinciden con el escaneo.
  const ref = grafoPorEscaneo(indiceParaEscaneo(db), { sinAncla: true });
  const grado = (id) => ref.aristas.filter((a) => a.source === id || a.target === id).length;
  for (const n of con.grafo.nodos) assert.equal(n.conexiones, grado(n.id), n.id);
  const vecinas = ref.aristas.filter((a) => a.source === "Plan.md" || a.target === "Plan.md");
  assert.deepEqual(
    con.grafo.aristas.map((a) => `${a.source}>${a.target}`).sort(),
    vecinas.map((a) => `${a.source}>${a.target}`).sort(),
  );
  // Un canvas que cita: está en el retro, sin fragmento.
  const conPlanP = await grafoDb.conexiones("Proyectos/Plan.md");
  assert.deepEqual(conPlanP.retro.map((r) => [r.id, r.fragmento]), [
    ["Tablero.canvas", ""],
    ["Plan.md", conPlanP.retro[1].fragmento],
  ]);
  client.setExecutor(null);
});

test("un índice de la versión anterior abre, migra y queda con `enlaces` completa", { skip: sinSqlite }, async () => {
  const { db } = await abrir();
  const completo = await grafoDb.grafo(contexto.LOCAL_VAULT_ID);
  // Como lo dejaba la 2.1.0: sin las tablas, sin la columna, y user_version 0.
  db.exec("DROP TABLE enlaces; DROP TABLE etiquetas; PRAGMA user_version = 0;");
  db.exec("ALTER TABLE notas DROP COLUMN hash_enlaces");
  await indexer.crearEsquemaIndice();
  const r = await indexer.indexarVault("C:/vault");
  assert.equal(r.reindexadas, Object.keys(VAULT).length, "pasada completa aunque ningún mtime cambió");
  assert.equal(db.pragma("user_version", { simple: true }), 1);
  const migrado = await grafoDb.grafo(contexto.LOCAL_VAULT_ID);
  assert.deepEqual(migrado, completo);
  // Y la siguiente apertura ya no fuerza nada.
  assert.equal((await indexer.indexarVault("C:/vault")).reindexadas, 0);
  client.setExecutor(null);
});

test("guardar un [[enlace]] nuevo lo muestra sin reindexar; guardar prosa no toca `enlaces`", { skip: sinSqlite }, async () => {
  const { ex } = await abrir();
  const texto = VAULT["Árbol.md"] + "\nAhora con [[Plan]] y #nuevo";
  await contenidoDb.putContenido("Árbol.md", texto);
  const g = await grafoDb.grafo(contexto.LOCAL_VAULT_ID);
  assert.deepEqual(aristasDesde(g, "Árbol.md"), ["Plan.md"]);
  assert.deepEqual(g.nodos.find((n) => n.id === "Árbol.md").tags, ["árbol", "nuevo"]);
  const con = await grafoDb.conexiones("Plan.md");
  assert.ok(con.retro.some((r) => r.id === "Árbol.md"));

  ex.sentencias.length = 0;
  await contenidoDb.putContenido("Árbol.md", texto + "\nUna frase más, sin enlaces.");
  assert.equal(ex.sentencias.filter((s) => /enlaces|etiquetas/.test(s) && !/hash_enlaces/.test(s)).length, 0);
  client.setExecutor(null);
});

test("un enlace roto pasa a resolver cuando aparece la nota (crear y duplicar)", { skip: sinSqlite }, async () => {
  const { db } = await abrir();
  let g = await grafoDb.grafo(contexto.LOCAL_VAULT_ID);
  assert.equal(g.aristas.some((a) => a.target.startsWith("Futura")), false);
  const { id } = await notasDb.crearNota(contexto.LOCAL_VAULT_ID, null, "Futura", "markdown");
  g = await grafoDb.grafo(contexto.LOCAL_VAULT_ID);
  assert.deepEqual(aristasHacia(g, id), ["Tablero.canvas", "Zeta/Idea.md"]);
  // Duplicar: la copia enlaza a lo mismo que el original.
  const copia = await notasDb.duplicarNota("Zeta/Idea.md");
  g = await grafoDb.grafo(contexto.LOCAL_VAULT_ID);
  assert.deepEqual(aristasDesde(g, copia.id), aristasDesde(g, "Zeta/Idea.md"));
  assert.deepEqual(diferencias(g, grafoPorEscaneo(indiceParaEscaneo(db), { sinAncla: true })).aristas, { sobran: [], faltan: [] });
  client.setExecutor(null);
});

test("renombrar y mover: re-resolución dirigida, sin escanear", { skip: sinSqlite }, async () => {
  const { db, ex } = await abrir();
  const comparar = async () => {
    const g = await grafoDb.grafo(contexto.LOCAL_VAULT_ID);
    const d = diferencias(g, grafoPorEscaneo(indiceParaEscaneo(db), { sinAncla: true }));
    assert.deepEqual(d.aristas, { sobran: [], faltan: [] });
    assert.deepEqual(d.etiquetas, []);
    return g;
  };

  // Mover a otra carpeta: el título no cambia; las aristas se conservan.
  const movida = await notasDb.moverNota("Zeta/Idea.md", "Proyectos");
  let g = await comparar();
  assert.deepEqual(aristasDesde(g, movida.id), ["Plan.md", "Árbol.md"]);

  // Renombrar la raíz «Plan»: `[[Plan]]` pasa a la homónima que queda.
  ex.sentencias.length = 0;
  const { id: nuevoId } = await notasDb.renombrarNota("Plan.md", "Plan maestro");
  const lecturasDeContenido = ex.sentencias.filter((s) => /FROM contenidos/.test(s) && !/WHERE nota_id = \?/.test(s));
  assert.equal(lecturasDeContenido.length, 0, "no se escanea el vault");
  g = await comparar();
  assert.deepEqual(aristasDesde(g, "Proyectos/Plan.md"), [], "[[Plan]] desde sí misma ahora es un lazo");
  assert.ok(aristasDesde(g, nuevoId).includes("Proyectos/Plan.md"), "sus salientes siguen");

  // La app reescribe después los enlaces entrantes (`vaultStore`): al guardarlos
  // vuelven a resolver a la nota renombrada.
  const texto = db.prepare("SELECT contenido FROM contenidos WHERE nota_id = ?").get("Proyectos/Plan.md").contenido;
  await contenidoDb.putContenido("Proyectos/Plan.md", texto.replaceAll("[[Plan]]", "[[Plan maestro]]"));
  g = await comparar();
  assert.deepEqual(aristasDesde(g, "Proyectos/Plan.md"), [nuevoId]);
  client.setExecutor(null);
});

test("papelera: los enlaces pasan a la homónima o a rotos, y vuelven al recuperar", { skip: sinSqlite }, async () => {
  const { db } = await abrir();
  const comparar = async () => {
    const g = await grafoDb.grafo(contexto.LOCAL_VAULT_ID);
    assert.deepEqual(diferencias(g, grafoPorEscaneo(indiceParaEscaneo(db), { sinAncla: true })).aristas, { sobran: [], faltan: [] });
    return g;
  };
  await papeleraDb.borrarNota("Plan.md");
  let g = await comparar();
  assert.equal(g.nodos.some((n) => n.id === "Plan.md"), false);
  // `[[Plan]]` desde Zeta/Idea pasa a la homónima.
  assert.ok(aristasDesde(g, "Zeta/Idea.md").includes("Proyectos/Plan.md"));
  await papeleraDb.recuperarNota("Plan.md");
  g = await comparar();
  assert.ok(aristasDesde(g, "Zeta/Idea.md").includes("Plan.md"));
  client.setExecutor(null);
});
