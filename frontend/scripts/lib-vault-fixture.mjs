// Utilidades compartidas por los scripts de las skills de IA (`FUN-L-26`):
// transpilar un módulo puro de `lib/` para importarlo sin build, y recorrer un
// vault de disco con las mismas reglas de visibilidad que Mycelium
// (`.mycignore`), para armar las filas que ve una base.
//
// No es parte de la app: sirve para probar las skills contra vaults de
// fixtures (`scripts/fixtures/ia/`) y contra el vault real del usuario.
import { readFile, readdir, stat } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const FRONTEND = fileURLToPath(new URL("..", import.meta.url));

/**
 * Transpila `lib/<modulo>.ts` y lo importa vía `data:` URL. Solo sirve para
 * módulos **puros y sin imports** (`bases.ts`, `frontmatter.ts`,
 * `recordatorios.ts`, `esporas.ts`, `sinCodigo.ts`), que es el patrón de
 * `scripts/test-bases.mjs`. `extra` se agrega al final del fuente antes de
 * transpilar: permite exportar funciones internas sin tocar el módulo.
 */
export async function importarTs(rutaRelativa, extra = "") {
  const fuente = await readFile(join(FRONTEND, rutaRelativa), "utf8");
  const { outputText } = ts.transpileModule(`${fuente}\n${extra}`, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  });
  return import(`data:text/javascript,${encodeURIComponent(outputText)}`);
}

// ── .mycignore ────────────────────────────────────────────────────────────────

/** El default de Mycelium (`src-tauri/src/mycignore.rs`, `DEFAULT`). */
const MYCIGNORE_DEFAULT = ".*/\nnode_modules/\ntarget/\ndist/\nout/";

function comodinARegex(patron) {
  const cuerpo = patron
    .split("")
    .map((c) => (c === "*" ? "[^/]*" : c === "?" ? "[^/]" : c.replace(/[.+^${}()|[\]\\]/g, "\\$&")))
    .join("");
  return new RegExp(`^${cuerpo}$`);
}

/** Reglas de un `.mycignore`: sintaxis tipo `.gitignore` sin negaciones. */
export function reglasMycignore(texto) {
  return texto
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l !== "" && !l.startsWith("#"))
    .map((l) => {
      const soloDir = l.endsWith("/");
      const limpio = l.replace(/\/+$/, "").replace(/^\/+/, "");
      const anclado = limpio.includes("/");
      return { soloDir, anclado, re: anclado ? null : comodinARegex(limpio), ruta: limpio };
    });
}

/** ¿Se ignora `rel` (ruta POSIX relativa al vault)? `.mycelium/` siempre. */
export function ignorado(rel, esDir, reglas) {
  const segs = rel.split("/");
  if (segs[0] === ".mycelium") return true;
  for (const r of reglas) {
    if (r.soloDir && !esDir) continue;
    if (r.anclado) {
      if (rel === r.ruta || rel.startsWith(`${r.ruta}/`)) return true;
    } else if (r.re.test(segs[segs.length - 1])) {
      return true;
    }
  }
  return false;
}

async function leerMycignore(vault) {
  try {
    return reglasMycignore(await readFile(join(vault, ".mycignore"), "utf8"));
  } catch {
    return reglasMycignore(MYCIGNORE_DEFAULT);
  }
}

/** Todos los archivos visibles del vault: `[{ rel, abs }]`, rutas POSIX. */
export async function archivosVisibles(vault) {
  const reglas = await leerMycignore(vault);
  const salida = [];
  async function recorrer(dir) {
    for (const e of await readdir(dir, { withFileTypes: true })) {
      const abs = join(dir, e.name);
      const rel = relative(vault, abs).split(sep).join("/");
      if (ignorado(rel, e.isDirectory(), reglas)) continue;
      if (e.isDirectory()) await recorrer(abs);
      else salida.push({ rel, abs });
    }
  }
  await recorrer(vault);
  return salida.sort((a, b) => (a.rel < b.rel ? -1 : 1));
}

// ── Las filas de una base ─────────────────────────────────────────────────────

let modulos = null;
async function modulosNotas() {
  if (!modulos) {
    const [fm, sc] = await Promise.all([importarTs("lib/frontmatter.ts"), importarTs("lib/sinCodigo.ts")]);
    modulos = { fm, sc };
  }
  return modulos;
}

/**
 * Las notas del vault tal como las ve una base (`lib/db/tabla.ts`): solo `.md`,
 * visibles según `.mycignore`, con sus propiedades (una fila por elemento de
 * lista) y sus etiquetas (frontmatter + `#tag` del cuerpo, sin código).
 *
 * > [!warning] `ctime`/`mtime` son aproximados
 * > En la app salen del índice: `ctime` es cuándo Mycelium indexó la nota por
 * > primera vez y `mtime` cuándo registró su último cambio, en ISO UTC. Acá se
 * > usan las fechas del sistema de archivos, que es lo más parecido que hay
 * > fuera de la app.
 */
export async function notasDelVault(vault) {
  const { fm, sc } = await modulosNotas();
  const notas = [];
  for (const { rel, abs } of await archivosVisibles(vault)) {
    if (!rel.toLowerCase().endsWith(".md")) continue;
    const texto = await readFile(abs, "utf8");
    const info = await stat(abs);
    const barra = rel.lastIndexOf("/");
    const carpeta = barra === -1 ? "" : rel.slice(0, barra);
    const nombre = rel.slice(barra + 1, -3);
    const f = fm.separarFrontmatter(texto);
    const props = [];
    if (f.hay && f.soportado) {
      for (const p of f.props) {
        const valores = Array.isArray(p.valor) ? p.valor.map(String) : [typeof p.valor === "boolean" ? String(p.valor) : String(p.valor)];
        for (const v of valores) props.push({ clave: p.clave, valor: v, tipo: p.tipo });
      }
    }
    notas.push({
      id: rel,
      nombre,
      ruta: carpeta ? `${carpeta}/${nombre}` : nombre,
      carpeta,
      ext: "md",
      ctime: info.birthtime.toISOString(),
      mtime: info.mtime.toISOString(),
      size: info.size,
      tags: fm.etiquetasDe(texto, sc.sinCodigo),
      props,
    });
  }
  return notas;
}

/** Las carpetas visibles del vault (rutas POSIX), para comprobar `inFolder`. */
export async function carpetasDelVault(vault) {
  const carpetas = new Set();
  for (const { rel } of await archivosVisibles(vault)) {
    const segs = rel.split("/").slice(0, -1);
    for (let i = 1; i <= segs.length; i++) carpetas.add(segs.slice(0, i).join("/"));
  }
  return carpetas;
}
