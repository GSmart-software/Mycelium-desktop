// Prueba de equivalencia entre los parsers de la app (TypeScript) y los del
// crate `mycelium-vault` (Rust) — plan del MCP § 3: mientras convivan dos
// implementaciones de «qué es un enlace», «qué es una propiedad» y «qué es una
// etiqueta», tiene que haber una prueba de que dicen lo mismo, o derivan.
//
//   node scripts/equivalencia-indice.mjs [carpeta]      (por defecto ../docs)
//
// Necesita el binario: `cd src-tauri && cargo build -p mycelium-mcp` (o
// MYCELIUM_MCP_BIN apuntando a otro). Qué compara, archivo por archivo:
//
//   - ENLACES: el conjunto de destinos, con la clave que usa el grafo de la app
//     (`destinoDeWikilink(inner).toLowerCase()` sobre `WIKILINK_RE`).
//   - PROPIEDADES: las filas `(clave, valor, tipo, orden)` que escribe
//     `reindexarPropiedades`, y si el frontmatter es soportado o no.
//   - ETIQUETAS: `etiquetasDe` (frontmatter + `#tag` del cuerpo).
//
// Las diferencias INTENCIONALES se listan como esperadas, no se esconden:
//   - lo que está dentro de código (en línea o en bloque) no es enlace ni
//     etiqueta para Rust, y sí para la app (plan § 3.1);
//   - un `.excalidraw` la app lo escanea como prosa; el índice del MCP no;
//   - `[[Nota#Sección]]`: los dos lo extraen igual, pero la app no lo resuelve
//     (conserva el ancla) y el MCP sí. Se cuenta aparte, como informativo.
// Cualquier otra diferencia es INESPERADA y la prueba termina con código 1.
import { execFileSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const aqui = dirname(fileURLToPath(import.meta.url));
const frontend = resolve(aqui, "..");

async function importarTs(rel) {
  const { outputText } = ts.transpileModule(readFileSync(join(frontend, rel), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 },
  });
  return import(`data:text/javascript,${encodeURIComponent(outputText)}`);
}

// Los módulos puros de la app, tal cual (sin imports a propósito).
const { destinoDeWikilink } = await importarTs("lib/wikilinks.ts");
const { separarFrontmatter, etiquetasDe } = await importarTs("lib/frontmatter.ts");

// `WIKILINK_RE` de lib/db/grafo.ts (no se puede importar: grafo.ts toca la base).
const fuenteGrafo = readFileSync(join(frontend, "lib/db/grafo.ts"), "utf8");
const reGrafo = /const WIKILINK_RE = \/(.+)\/g;/.exec(fuenteGrafo);
if (!reGrafo) throw new Error("No encontré WIKILINK_RE en lib/db/grafo.ts: ¿cambió?");
const WIKILINK_RE = new RegExp(reGrafo[1], "g");

// `valoresDe` + `escalarATexto` de lib/db/propiedades.ts (el archivo importa el
// cliente de la base, así que se replica: son cuatro líneas y se comprueba abajo
// que sigan siendo esas).
const fuenteProps = readFileSync(join(frontend, "lib/db/propiedades.ts"), "utf8");
if (!fuenteProps.includes('typeof valor === "boolean" ? (valor ? "true" : "false") : String(valor)')) {
  throw new Error("Cambió escalarATexto en lib/db/propiedades.ts: actualizá esta prueba.");
}
const escalarATexto = (v) => (typeof v === "boolean" ? (v ? "true" : "false") : String(v));
const valoresDe = (p) => (Array.isArray(p.valor) ? p.valor.map((v) => String(v)) : [escalarATexto(p.valor)]);

/** Lo que la app ve en un archivo. */
function vistaApp(texto, tipo) {
  const enlaces = new Set();
  // grafo.ts escanea como prosa todo lo que no es base, canvas ni drawio.
  if (tipo !== "base" && tipo !== "canvas" && tipo !== "drawio") {
    for (const m of texto.matchAll(WIKILINK_RE)) enlaces.add(destinoDeWikilink(m[1]).toLowerCase());
  }
  const fm = separarFrontmatter(texto);
  const estado = !fm.hay ? "no" : fm.soportado ? "soportado" : "no_soportado";
  const props = [];
  if (fm.hay && fm.soportado) {
    for (const p of fm.props) valoresDe(p).forEach((v, i) => props.push([p.clave, v, p.tipo, i]));
  }
  return { enlaces, estado, props, tags: etiquetasDe(texto) };
}

// ── Correr ──────────────────────────────────────────────────────────────────

const vault = resolve(process.argv[2] ?? join(frontend, "..", "docs"));
const exe = process.platform === "win32" ? "mycelium-mcp.exe" : "mycelium-mcp";
const bin = process.env.MYCELIUM_MCP_BIN ?? join(frontend, "src-tauri", "target", "debug", exe);
if (!existsSync(bin)) {
  console.error(`No está el binario (${bin}). Compilalo: cd src-tauri && cargo build -p mycelium-mcp`);
  process.exit(2);
}
const volcado = JSON.parse(execFileSync(bin, ["volcar", vault], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 }));

const esperadas = { codigo: [], excalidraw: [], tagsCodigo: [] };
const inesperadas = [];
const info = { anclas: 0, archivos: 0, enlaces: 0, props: 0, tags: 0, secciones: 0, parciales: 0 };
const titulos = new Set();
for (const a of volcado.archivos) titulos.add(a.ruta.slice(a.ruta.lastIndexOf("/") + 1).replace(/\.[^.]+$/, "").toLowerCase());

for (const a of volcado.archivos) {
  info.archivos++;
  const texto = readFileSync(join(vault, a.ruta), "utf8");
  const app = vistaApp(texto, a.tipo);

  if (a.tipo !== "markdown") {
    for (const k of app.enlaces) esperadas.excalidraw.push(`${a.ruta} → [[${k}]]`);
    continue;
  }
  info.secciones += a.secciones;
  info.parciales += a.secciones_parciales;

  // Enlaces.
  const rust = new Set(a.enlaces.map((e) => e.clave));
  const enCodigo = new Map(a.enlaces_en_codigo.map((e) => [e.clave, e.linea]));
  info.enlaces += rust.size;
  for (const k of app.enlaces) {
    if (rust.has(k)) continue;
    if (enCodigo.has(k)) esperadas.codigo.push(`${a.ruta}:${enCodigo.get(k)} → [[${k}]]`);
    else inesperadas.push(`ENLACE solo en la app: ${a.ruta} → [[${k}]]`);
  }
  for (const k of rust) if (!app.enlaces.has(k)) inesperadas.push(`ENLACE solo en Rust: ${a.ruta} → [[${k}]]`);
  for (const k of rust) {
    const i = k.indexOf("#");
    if (i > 0 && titulos.has(k.slice(0, i).trim())) info.anclas++;
  }

  // Propiedades.
  if (app.estado !== a.frontmatter) {
    inesperadas.push(`FRONTMATTER ${a.ruta}: app=${app.estado} rust=${a.frontmatter}`);
  }
  const pa = JSON.stringify(app.props);
  const pr = JSON.stringify(a.propiedades);
  info.props += a.propiedades.length;
  if (pa !== pr) inesperadas.push(`PROPIEDADES ${a.ruta}:\n    app  ${pa}\n    rust ${pr}`);

  // Etiquetas.
  const tr = new Set(a.tags.map((t) => t.toLowerCase()));
  const tc = new Set(a.tags_en_codigo.map((t) => t.toLowerCase()));
  info.tags += tr.size;
  for (const t of app.tags) {
    const k = t.toLowerCase();
    if (tr.has(k)) continue;
    if (tc.has(k)) esperadas.tagsCodigo.push(`${a.ruta} → #${t}`);
    else inesperadas.push(`ETIQUETA solo en la app: ${a.ruta} → #${t}`);
  }
  const ta = new Set(app.tags.map((t) => t.toLowerCase()));
  for (const t of tr) if (!ta.has(t)) inesperadas.push(`ETIQUETA solo en Rust: ${a.ruta} → #${t}`);
}

const lista = (titulo, xs) => {
  console.log(`\n${titulo}: ${xs.length}`);
  for (const x of xs) console.log(`  ${x}`);
};
console.log(`Vault: ${vault}`);
console.log(
  `${info.archivos} archivos · ${info.secciones} secciones (${info.parciales} trozos de secciones > 4 KB) · ` +
    `${info.enlaces} destinos de enlace distintos por nota · ${info.props} filas de propiedades · ${info.tags} etiquetas`,
);
console.log("\n== Diferencias ESPERADAS (intencionales) ==");
lista("Enlaces que la app cuenta y están dentro de código (plan § 3.1)", esperadas.codigo);
lista("Etiquetas que la app cuenta y están dentro de código", esperadas.tagsCodigo);
lista("Enlaces de .excalidraw que la app escanea como prosa y el MCP no", esperadas.excalidraw);
console.log(
  `\nInformativo: ${info.anclas} enlaces [[Nota#Sección]] a notas que existen — los dos los extraen, ` +
    "pero la app no los resuelve (conserva el ancla) y el MCP sí.",
);
console.log("\n== Diferencias INESPERADAS ==");
if (inesperadas.length === 0) console.log("  ninguna");
for (const x of inesperadas) console.log(`  ${x}`);
process.exit(inesperadas.length === 0 ? 0 : 1);
