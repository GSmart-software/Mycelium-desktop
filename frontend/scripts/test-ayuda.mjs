// Test de la ayuda integrada (`FUN-L-27`): que el contenido que viaja con la app
// esté al día, bien formado, enlazado y completo, y que sus ejemplos funcionen.
//
// La ayuda tiene el riesgo de la plantilla de snippets (`DEF-123`) multiplicado:
// envejecer sin que nadie lo note. Este test es la defensa que no depende de que
// alguien se acuerde:
//
// - `lib/ayuda/paginasGeneradas.ts` es exactamente lo que genera el script.
// - Cada página tiene frontmatter válido, título e id únicos.
// - Cada enlace `ayuda:` lleva a una página que existe en la misma versión.
// - Cada tipo de archivo de `lib/extensionesDeTipo` tiene su página.
// - Cada bloque ```ejemplo renderiza con el motor real sin lanzar, y los de las
//   páginas de muestra producen lo que la página dice que producen.
//
// Mismo arnés que `scripts/test-estados-tarea.mjs`: los módulos se transpilan a
// una carpeta temporal DENTRO de `frontend/` para que resuelvan `node_modules`.
//
//   node --test scripts/test-ayuda.mjs
import assert from "node:assert/strict";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { after, test } from "node:test";
import ts from "typescript";
import { generarModulo, leerAyuda } from "./generar-ayuda.mjs";

const AQUI = dirname(fileURLToPath(import.meta.url));
const FRONTEND = join(AQUI, "..");
const TMP = join(FRONTEND, ".tmp-test-ayuda");

const MODULOS = [
  "lib/ayuda/paginasGeneradas.ts",
  "lib/ayuda/ejemplos.ts",
  "lib/ayuda/render.ts",
  "lib/ayuda/indice.ts",
  "lib/markdown.ts",
  "lib/estadosTarea.ts",
  "lib/frontmatter.ts",
  "lib/wikilinks.ts",
  "lib/drawio.ts",
  "lib/extensionesDeTipo.ts",
  "lib/editor/wikilink.ts",
  "lib/video.ts",
  "lib/imagenes.ts",
];

await rm(TMP, { recursive: true, force: true });
await mkdir(TMP, { recursive: true });
await writeFile(
  join(TMP, "vaultStore.mjs"),
  "export const useVaultStore = { getState: () => ({ notas: [], carpetas: [] }) };\n",
);
for (const rel of MODULOS) {
  const fuente = await readFile(join(FRONTEND, rel), "utf8");
  const { outputText } = ts.transpileModule(fuente, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  });
  const js = outputText
    .replace(/(["'])@\/lib\/(?:[A-Za-z0-9_-]+\/)*([A-Za-z0-9_-]+)\1/g, '"./$2.mjs"')
    .replace(/(["'])@\/stores\/([A-Za-z0-9_-]+)\1/g, '"./$2.mjs"');
  await writeFile(join(TMP, `${rel.split("/").pop().replace(/\.ts$/, "")}.mjs`), js);
}

after(async () => {
  await rm(TMP, { recursive: true, force: true });
});

const cargar = (nombre) => import(pathToFileURL(join(TMP, `${nombre}.mjs`)).href);
const { TEMAS_AYUDA } = await cargar("paginasGeneradas");
const { partirEjemplos } = await cargar("ejemplos");
const { htmlDePagina } = await cargar("render");
const indice = await cargar("indice");
const { EXTENSION_POR_TIPO } = await cargar("extensionesDeTipo");

const TODAS = TEMAS_AYUDA.flatMap((t) => t.paginas);
const ESCRITAS = TODAS.filter((p) => !p.pendiente);
const porId = new Map(TODAS.map((p) => [p.id, p]));

// ── El circuito del contenido ───────────────────────────────────────────────

test("paginasGeneradas.ts está al día con ayuda/*.md", async () => {
  const enDisco = (await readFile(join(FRONTEND, "lib/ayuda/paginasGeneradas.ts"), "utf8")).replace(/\r\n/g, "\n");
  assert.ok(enDisco === generarModulo(), "lib/ayuda/paginasGeneradas.ts está desactualizado: corré `npm run generar-ayuda`");
});

test("cada página tiene frontmatter válido, y títulos, ids y archivos únicos", () => {
  const temas = leerAyuda(); // lanza con el motivo si algo no se entiende
  const paginas = temas.flatMap((t) => t.paginas);
  assert.ok(paginas.length > 0);
  const repetidos = (lista) => lista.filter((x, i) => lista.indexOf(x) !== i);
  assert.deepEqual(repetidos(paginas.map((p) => p.id)), [], "ids repetidos");
  assert.deepEqual(repetidos(paginas.map((p) => p.titulo)), [], "títulos repetidos");
  assert.deepEqual(repetidos(temas.map((t) => t.titulo)), [], "temas repetidos");
  // El repo es además un vault: dos notas con el mismo nombre rompen sus enlaces.
  const nombres = paginas.map((p) => p.archivo.split("/").pop());
  assert.deepEqual(repetidos(nombres), [], "nombres de archivo repetidos entre temas");
});

test("las páginas escritas no llevan HTML crudo (el motor lo descarta y el texto desaparece)", () => {
  for (const p of ESCRITAS) {
    const sinCodigo = p.cuerpo
      .replace(/^ {0,3}(`{3,}|~{3,})[^\n]*\n[\s\S]*?\n {0,3}\1[^\n]*$/gm, "")
      .replace(/`[^`\n]*`/g, "");
    const etiqueta = /<\/?[a-z][a-z0-9-]*(\s[^>]*)?>/i.exec(sinCodigo);
    assert.equal(etiqueta, null, `${p.id}: HTML crudo ${etiqueta?.[0]} — se pierde al renderizar; usá Markdown`);
  }
});

// ── Enlaces y cobertura ─────────────────────────────────────────────────────

test("cada enlace ayuda: lleva a una página que existe en la misma versión", () => {
  for (const p of ESCRITAS) {
    for (const destino of indice.enlacesDeAyuda(p.cuerpo)) {
      const q = porId.get(destino);
      assert.ok(q, `${p.id} enlaza a ayuda:${destino}, que no existe`);
      // Desde una página de las dos versiones no se puede mandar a una de una sola.
      if (q.solo !== null) {
        assert.equal(p.solo, q.solo, `${p.id} (en las dos versiones) enlaza a ${destino}, que es solo de ${q.solo}`);
      }
    }
  }
});

test("cada tipo de archivo de lib/extensionesDeTipo tiene su página en el índice", () => {
  for (const tipo of Object.keys(EXTENSION_POR_TIPO)) {
    const pagina = TODAS.find((p) => p.cubre.includes(tipo));
    assert.ok(pagina, `ninguna página de la ayuda cubre el tipo «${tipo}» (frontmatter cubre: [${tipo}])`);
  }
  for (const p of TODAS) {
    for (const tipo of p.cubre) {
      assert.ok(tipo in EXTENSION_POR_TIPO, `${p.id}: cubre «${tipo}», que no es un tipo de lib/extensionesDeTipo`);
    }
  }
});

test(
  "ninguna página del índice está pendiente",
  { todo: "parte B de FUN-L-27: escribir las páginas marcadas «estado: pendiente» y quitar este todo" },
  () => {
    const pendientes = TODAS.filter((p) => p.pendiente).map((p) => p.id);
    assert.deepEqual(pendientes, []);
  },
);

test("la página inicial existe y está escrita", () => {
  const p = indice.paginaPorId(indice.PAGINA_INICIAL);
  assert.ok(p && !p.pendiente);
});

// ── Ejemplos: el motor real ─────────────────────────────────────────────────

test("cada página escrita y cada ejemplo renderizan sin lanzar", () => {
  let ejemplos = 0;
  for (const p of ESCRITAS) {
    const html = htmlDePagina(p.cuerpo);
    assert.ok(html.length > 0, `${p.id} renderiza vacía`);
    for (const t of partirEjemplos(p.cuerpo)) {
      if (t.tipo !== "ejemplo") continue;
      ejemplos++;
      assert.ok(t.fuente.trim(), `${p.id}: un ejemplo vacío`);
    }
    // Cada ejemplo sale como figura con su fuente y su render.
    const figuras = html.match(/class="mic-ayuda-ejemplo"/g)?.length ?? 0;
    assert.equal(figuras, partirEjemplos(p.cuerpo).filter((t) => t.tipo === "ejemplo").length, p.id);
  }
  assert.ok(ejemplos > 0, "ninguna página tiene ejemplos");
});

/** El render de los ejemplos de una página, concatenado. */
function renderDeEjemplos(id) {
  const html = htmlDePagina(porId.get(id).cuerpo);
  return [...html.matchAll(/<div class="mic-ayuda-ejemplo-render">([\s\S]*?)<\/div><\/figure>/g)].map((m) => m[1]).join("");
}

test("Énfasis: los ejemplos producen los seis estilos que la página describe", () => {
  const html = renderDeEjemplos("escribir-notas/enfasis");
  assert.match(html, /<em>cursiva<\/em>/);
  assert.match(html, /<em class="mic-em-us">cursiva con brillo<\/em>/);
  assert.match(html, /<strong>negrita<\/strong>/);
  assert.match(html, /<strong class="mic-strong-us">negrita con acento<\/strong>/);
  assert.match(html, /<em><strong>negrita y cursiva<\/strong><\/em>/);
  assert.match(html, /<em class="mic-em-us-tri-outer"><strong class="mic-em-us-tri">negrita con degradado<\/strong><\/em>/);
  assert.match(html, /<del>tachado<\/del>/);
  // El guion bajo dentro de una palabra no estiliza; el asterisco sí.
  assert.match(html, /nombre_de_archivo/);
  assert.match(html, /super<em>cali<\/em>fragilístico/);
});

test("Tareas: el ejemplo muestra los nueve estados con su casilla", () => {
  const html = renderDeEjemplos("escribir-notas/tareas");
  for (const estado of ["pendiente", "hecha", "en-curso", "cancelada", "pospuesta", "destacada", "importante", "pregunta", "agregada"]) {
    assert.match(html, new RegExp(`class="mic-task-check" data-task="[^"]+" data-estado="${estado}"`), `falta la casilla «${estado}»`);
  }
});

// ── Piezas sueltas ──────────────────────────────────────────────────────────

test("partirEjemplos: vallas largas, ejemplos dentro de código común y texto alrededor", () => {
  const md = [
    "Antes",
    "````ejemplo",
    "```js",
    "x",
    "```",
    "````",
    "Medio",
    "```md",
    "```ejemplo",
    "no es ejemplo",
    "```",
    "~~~ejemplo",
    "**b**",
    "~~~",
  ].join("\n");
  const trozos = partirEjemplos(md);
  assert.deepEqual(
    trozos.map((t) => t.tipo),
    ["md", "ejemplo", "md", "ejemplo"],
  );
  assert.equal(trozos[1].fuente, "```js\nx\n```");
  assert.match(trozos[2].texto, /no es ejemplo/);
  assert.equal(trozos[3].fuente, "**b**");
});

test("buscador: tolera tildes, encuentra por sinónimo y por contenido", () => {
  assert.equal(indice.buscarEnAyuda("enfasis")[0].pagina.id, "escribir-notas/enfasis");
  assert.equal(indice.buscarEnAyuda("ÉNFASIS")[0].pagina.id, "escribir-notas/enfasis");
  assert.ok(indice.buscarEnAyuda("guion bajo").some((h) => h.pagina.id === "escribir-notas/enfasis"));
  const porContenido = indice.buscarEnAyuda("corchetes").find((h) => h.pagina.id === "escribir-notas/tareas");
  assert.ok(porContenido?.fragmento?.toLowerCase().includes("corchetes"));
  assert.deepEqual(indice.buscarEnAyuda("   "), []);
  assert.deepEqual(indice.buscarEnAyuda("zzzxxyy"), []);
});

test("enlaces ayuda: y vecinas", () => {
  assert.equal(indice.idDeEnlace("ayuda:escribir-notas/tareas"), "escribir-notas/tareas");
  assert.equal(indice.idDeEnlace("https://example.com"), null);
  assert.equal(indice.idDeEnlace("#wikilink:x"), null);
  const { anterior, siguiente } = indice.vecinas("escribir-notas/enfasis");
  assert.ok(anterior === null || !anterior.pendiente);
  assert.ok(siguiente === null || !siguiente.pendiente);
});
