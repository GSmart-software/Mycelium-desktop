#!/usr/bin/env node
/**
 * Genera `public/THIRD-PARTY-NOTICES.txt`: los avisos de licencia de todo lo de
 * terceros que viaja dentro de Mycelium. Configuración → «Licencias de terceros»
 * lo muestra dentro de la app, y como está en `public/` va en el export estático
 * que Tauri empaqueta en el binario.
 *
 * Hace falta porque casi todas esas licencias (MIT, BSD, Apache-2.0, ISC, OFL)
 * piden que cada copia lleve el aviso de copyright y la licencia, y el
 * minificado del bundle los borra. Junta, en este orden:
 *
 *   1. draw.io (`public/drawio/LICENSE` y las licencias de sus bibliotecas
 *      internas que vienen en el `.war`), lo deja `preparar-drawio`;
 *   2. las fuentes de Excalidraw (`public/excalidraw-assets/LICENCIAS-FUENTES.txt`),
 *      lo deja `preparar-excalidraw`;
 *   3. los paquetes de npm de producción, según `package-lock.json` (sin los de
 *      desarrollo ni los binarios de una plataforma —el compilador de Next, sharp—,
 *      que se usan para compilar y no viajan);
 *   4. los crates de Rust que se compilan en el binario: las dependencias
 *      normales (no las de build ni las de desarrollo) alcanzables desde `app`
 *      según `cargo metadata`, para cualquier plataforma.
 *
 * Los textos de licencia salen de los archivos del propio paquete (`LICENSE*`,
 * `LICENCE*`, `COPYING*`, `NOTICE*`, `AUTHORS*`), sin herramientas nuevas, y se
 * agrupan: los paquetes con exactamente el mismo texto lo comparten, así que el
 * archivo no repite cien veces la misma MIT con el mismo autor. Un paquete sin
 * archivo de licencia figura igual, con la licencia que declara.
 *
 * Es determinista (todo ordenado, sin fechas) e idempotente: si no cambiaron los
 * lockfiles, las licencias de draw.io y de las fuentes ni este script, no hace
 * nada. Lo corre `npm run build` (y por él, `tauri build`) después de los
 * `preparar-*`.
 *
 * Uso:  node scripts/generar-avisos-terceros.mjs [--forzar]
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const AQUI = dirname(fileURLToPath(import.meta.url));
const FRONTEND = resolve(AQUI, "..");
const TAURI = join(FRONTEND, "src-tauri");
const SALIDA = join(FRONTEND, "public", "THIRD-PARTY-NOTICES.txt");
const SELLO = join(FRONTEND, ".avisos-terceros.json");
const DRAWIO = join(FRONTEND, "public", "drawio");
const FUENTES = join(FRONTEND, "public", "excalidraw-assets", "LICENCIAS-FUENTES.txt");
const FORZAR = process.argv.includes("--forzar");
const log = (...m) => console.log("[avisos]", ...m);

/** Archivos que cuentan como texto de licencia en la raíz de un paquete. */
const ES_LICENCIA = /^(licen[cs]e|copying|notice|authors|unlicense)([-._].*)?$/i;

/**
 * Paquetes de producción que solo usa `next build` y no viajan: sharp y sus
 * binarios (`@img/*`) son la optimización de imágenes por servidor, que el
 * export estático tiene apagada (`images.unoptimized`).
 */
const SOLO_COMPILACION = /^(sharp|@img\/.*)$/;

const SEPARADOR = "=".repeat(78);
const FILETE = "-".repeat(78);

function leer(ruta) {
  return readFileSync(ruta, "utf8").replace(/^﻿/, "").replace(/\r\n?/g, "\n").trim();
}

/** Textos de licencia de la carpeta de un paquete, ordenados por nombre. */
function textosDe(carpeta, extra = []) {
  const nombres = existsSync(carpeta)
    ? readdirSync(carpeta).filter((n) => ES_LICENCIA.test(n) && statSync(join(carpeta, n)).isFile())
    : [];
  const rutas = [...new Set([...nombres.map((n) => join(carpeta, n)), ...extra.filter((r) => existsSync(r))])];
  return rutas.sort().map((r) => ({ archivo: relative(carpeta, r).replaceAll("\\", "/"), texto: leer(r) }));
}

/** Huella de lo que determina la salida, para no rehacerla si nada cambió. */
function huella() {
  const h = createHash("sha256");
  for (const r of [
    join(FRONTEND, "package-lock.json"),
    join(TAURI, "Cargo.lock"),
    join(TAURI, "Cargo.toml"),
    join(DRAWIO, ".preparado.json"),
    join(DRAWIO, "LICENSE"),
    FUENTES,
    fileURLToPath(import.meta.url),
  ]) {
    h.update(r).update(existsSync(r) ? readFileSync(r) : "");
  }
  return h.digest("hex");
}

// ── npm ─────────────────────────────────────────────────────────────────────

function paquetesNpm() {
  const lock = JSON.parse(readFileSync(join(FRONTEND, "package-lock.json"), "utf8"));
  const salida = new Map();
  for (const [ruta, datos] of Object.entries(lock.packages)) {
    if (!ruta || datos.dev || datos.os || datos.cpu) continue;
    const carpeta = join(FRONTEND, ruta);
    const pkg = existsSync(join(carpeta, "package.json"))
      ? JSON.parse(readFileSync(join(carpeta, "package.json"), "utf8"))
      : {};
    const nombre = pkg.name ?? ruta.replace(/^.*node_modules\//, "");
    const version = pkg.version ?? datos.version;
    const clave = `${nombre}@${version}`;
    if (salida.has(clave) || SOLO_COMPILACION.test(nombre)) continue;
    const licencia = typeof pkg.license === "string"
      ? pkg.license
      : pkg.license?.type ?? (Array.isArray(pkg.licenses) ? pkg.licenses.map((l) => l.type ?? l).join(" OR ") : datos.license);
    salida.set(clave, {
      nombre,
      version,
      licencia: licencia ?? "(no declara licencia)",
      origen: typeof pkg.repository === "string" ? pkg.repository : pkg.repository?.url ?? pkg.homepage ?? "",
      textos: textosDe(carpeta),
    });
  }
  return [...salida.values()];
}

// ── Rust ────────────────────────────────────────────────────────────────────

function cratesRust() {
  let metadata;
  try {
    metadata = JSON.parse(
      execFileSync("cargo", ["metadata", "--format-version", "1", "--locked"], {
        cwd: TAURI,
        encoding: "utf8",
        maxBuffer: 256 * 1024 * 1024,
        stdio: ["ignore", "pipe", "inherit"],
      }),
    );
  } catch (e) {
    throw new Error(`no se pudo correr \`cargo metadata\` en src-tauri/: ${e.message.split("\n")[0]}`);
  }
  const paquetes = new Map(metadata.packages.map((p) => [p.id, p]));
  const nodos = new Map(metadata.resolve.nodes.map((n) => [n.id, n]));
  const propios = new Set(metadata.workspace_members);
  const raiz = metadata.packages.find((p) => p.name === "app" && propios.has(p.id))?.id ?? metadata.resolve.root;

  // Dependencias normales (kind null) alcanzables desde `app`: lo que se enlaza
  // en el binario. Las de build (`build.rs`) y las de desarrollo no viajan.
  const visitados = new Set();
  const pendientes = [raiz];
  while (pendientes.length > 0) {
    const id = pendientes.pop();
    if (visitados.has(id)) continue;
    visitados.add(id);
    for (const dep of nodos.get(id)?.deps ?? []) {
      if (dep.dep_kinds.some((k) => k.kind === null)) pendientes.push(dep.pkg);
    }
  }
  return [...visitados]
    .filter((id) => !propios.has(id))
    .map((id) => paquetes.get(id))
    .map((p) => {
      const carpeta = dirname(p.manifest_path);
      return {
        nombre: p.name,
        version: p.version,
        licencia: p.license ?? (p.license_file ? `ver ${p.license_file}` : "(no declara licencia)"),
        origen: p.repository ?? p.homepage ?? "",
        textos: textosDe(carpeta, p.license_file ? [join(carpeta, p.license_file)] : []),
      };
    });
}

// ── Armado ──────────────────────────────────────────────────────────────────

/**
 * Agrupa los paquetes por texto de licencia idéntico. Devuelve las secciones
 * ordenadas por el primer paquete de cada grupo.
 */
function agrupar(paquetes) {
  const grupos = new Map();
  for (const p of paquetes) {
    const textos = p.textos.map((t) => `--- ${t.archivo} ---\n\n${t.texto}`).join("\n\n");
    const clave = textos ? createHash("sha256").update(textos).digest("hex") : `sin-texto:${p.licencia}`;
    if (!grupos.has(clave)) grupos.set(clave, { textos, licencia: p.licencia, paquetes: [] });
    grupos.get(clave).paquetes.push(p);
  }
  const orden = (a, b) => (a.nombre === b.nombre ? a.version.localeCompare(b.version) : a.nombre.localeCompare(b.nombre));
  const lista = [...grupos.values()];
  for (const g of lista) g.paquetes.sort(orden);
  return lista.sort((a, b) => orden(a.paquetes[0], b.paquetes[0]));
}

function seccion(titulo, paquetes) {
  const partes = [SEPARADOR, titulo, SEPARADOR, ""];
  for (const g of agrupar(paquetes)) {
    for (const p of g.paquetes) {
      partes.push(`${p.nombre} ${p.version} — ${p.licencia}${p.origen ? ` — ${p.origen}` : ""}`);
    }
    partes.push("");
    partes.push(g.textos || `(El paquete no incluye archivo de licencia; declara: ${g.licencia}.)`);
    partes.push("", FILETE, "");
  }
  return partes.join("\n");
}

function seccionDrawio() {
  if (!existsSync(join(DRAWIO, "LICENSE"))) {
    throw new Error("falta public/drawio/LICENSE: corré antes `npm run preparar-drawio`");
  }
  const sello = existsSync(join(DRAWIO, ".preparado.json"))
    ? JSON.parse(readFileSync(join(DRAWIO, ".preparado.json"), "utf8"))
    : {};
  const partes = [
    SEPARADOR,
    `draw.io ${sello.version ?? ""} (public/drawio/) — Apache-2.0 — https://github.com/jgraph/drawio`,
    SEPARADOR,
    "",
    "Copyright (c) JGraph Ltd. Se distribuye recortada: sin el andamiaje Java del .war,",
    "las traducciones que no se usan y las fuentes sin minificar.",
    "",
    leer(join(DRAWIO, "LICENSE")),
    "",
  ];
  // Las bibliotecas internas que el `.war` trae con su propia licencia.
  const internas = [];
  const recorrer = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const ruta = join(dir, e.name);
      if (e.isDirectory()) recorrer(ruta);
      else if (ES_LICENCIA.test(e.name) && ruta !== join(DRAWIO, "LICENSE")) internas.push(ruta);
    }
  };
  recorrer(DRAWIO);
  for (const ruta of internas.sort()) {
    partes.push(FILETE, `draw.io: ${relative(DRAWIO, ruta).replaceAll("\\", "/")}`, FILETE, "", leer(ruta), "");
  }
  return partes.join("\n");
}

function seccionFuentes() {
  if (!existsSync(FUENTES)) {
    throw new Error("falta public/excalidraw-assets/LICENCIAS-FUENTES.txt: corré antes `npm run preparar-excalidraw`");
  }
  return [SEPARADOR, "Fuentes de los dibujos de Excalidraw", SEPARADOR, "", leer(FUENTES), ""].join("\n");
}

function main() {
  const firma = huella();
  if (!FORZAR && existsSync(SALIDA) && existsSync(SELLO)) {
    try {
      if (JSON.parse(readFileSync(SELLO, "utf8")).huella === firma) {
        log("ya generado: public/THIRD-PARTY-NOTICES.txt — nada que hacer");
        return;
      }
    } catch {
      // sello ilegible: se rehace
    }
  }
  const npm = paquetesNpm();
  const rust = cratesRust();
  const texto = [
    "Mycelium — avisos de licencia de terceros",
    "",
    "Mycelium incluye software y fuentes de terceros. Cada componente se distribuye",
    "bajo su propia licencia, cuyo texto completo figura abajo tal como lo publica",
    "su autor. Los paquetes que comparten exactamente el mismo texto van juntos.",
    "",
    `Contenido: draw.io, las fuentes de Excalidraw, ${npm.length} paquetes de npm y ${rust.length} crates de Rust.`,
    "",
    seccionDrawio(),
    seccionFuentes(),
    seccion("Paquetes de npm (la interfaz)", npm),
    seccion("Crates de Rust (el programa)", rust),
  ].join("\n");
  writeFileSync(SALIDA, `${texto.trimEnd()}\n`);
  writeFileSync(SELLO, `${JSON.stringify({ huella: firma }, null, 2)}\n`);
  log(
    `public/THIRD-PARTY-NOTICES.txt: ${npm.length} paquetes de npm, ${rust.length} crates ` +
      `(${(Buffer.byteLength(texto) / 1024).toFixed(0)} KB)`,
  );
}

try {
  main();
} catch (e) {
  console.error("[avisos] ERROR:", e.message);
  process.exitCode = 1;
}
