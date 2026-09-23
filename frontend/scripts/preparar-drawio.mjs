#!/usr/bin/env node
/**
 * Prepara la webapp de draw.io dentro de `public/drawio/` (`FUN-L-20`).
 *
 * La webapp **no entra a git** (son ~50 MB): la baja este script desde una
 * release **fijada** de jgraph/drawio, la verifica por SHA-256, la extrae y le
 * saca lo que Mycelium no usa. Así el build es reproducible y el repo no carga
 * con un binario enorme que además habría que actualizar a mano.
 *
 * Se sirve desde `public/` —o sea, desde el mismo origen que la app— para que
 * el iframe del editor no obligue a abrir la CSP ni a sumar rutas al protocolo
 * de assets de Tauri, y para que el `postMessage` entre la app y el iframe sea
 * directo. Ver `docs/features/drawio.md` § 7.
 *
 * Es **idempotente**: si ya está extraída la misma versión con el mismo recorte,
 * no vuelve a bajar ni a extraer nada. El `.war` bajado queda cacheado en
 * `.drawio-cache/` para que un cambio de recorte no cueste otra descarga.
 *
 * Uso:  npm run preparar-drawio
 *       npm run preparar-drawio -- --forzar     (rehace la extracción)
 *       npm run preparar-drawio -- --sin-recorte (extrae la webapp entera)
 */

import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const AQUI = dirname(fileURLToPath(import.meta.url));
const FRONTEND = resolve(AQUI, "..");

/** Release fijada. Subir esto es una decisión, no un `npm update`. */
const VERSION = "31.4.6";
const URL_WAR = `https://github.com/jgraph/drawio/releases/download/v${VERSION}/draw.war`;

/**
 * SHA-256 del `draw.war` de la release fijada. Si la descarga no coincide, el
 * script aborta: o cambiaron el asset debajo de la etiqueta, o la bajada se
 * cortó. En ninguno de los dos casos queremos seguir.
 */
const SHA256_ESPERADO =
  "f7798104da17d7e9494ab348c3ba9b2a65640096bd54f704d7a0fa2fab283938";

const DESTINO = join(FRONTEND, "public", "drawio");
const CACHE = join(FRONTEND, ".drawio-cache");
const WAR_CACHEADO = join(CACHE, `draw-${VERSION}.war`);
const SELLO = join(DESTINO, ".preparado.json");

/**
 * Lo que se saca de la webapp tras extraerla (§ 3 de la spec: el recorte se
 * decide **probando**, y lo que queda fuera se anota ahí).
 *
 * Cada entrada es un prefijo de ruta dentro del `.war`. Un prefijo que termina
 * en `/` borra la carpeta entera.
 */
const RECORTE = [
  // Andamiaje de la app Java del `.war`: Mycelium sirve los estáticos, no hay
  // servlet container. Nada de esto se referencia desde `index.html`.
  "META-INF/",
  "WEB-INF/",

  // El bundle del modo «integrate» (22 MB), el que usa `embed.diagrams.net`.
  // No lo referencia **ningún** archivo del paquete: `index.html` carga
  // `js/app.min.js` por `bootstrap.js`. Es la quita más grande y la más barata.
  "js/integrate.min.js",

  // Las traducciones que no se usan. La UI va en español y el fallback de
  // draw.io es el inglés, así que sobreviven `dia.txt` y `dia_es.txt` (abajo).
  "resources/",

  // Las fuentes SIN minificar, que solo se cargan con `dev=1` (`bootstrap.js`
  // las pide en la rama de desarrollo). En producción manda `js/app.min.js`,
  // que ya las trae adentro: son 14 MB de copia duplicada.
  "js/diagramly/",
  "js/grapheditor/",
];

/**
 * Prefijos que el recorte **nunca** puede tocar, pase lo que pase. Son el
 * corazón de lo que la spec manda probar después de cada quita: las bibliotecas
 * de formas, las plantillas y la exportación.
 */
const INTOCABLE = [
  "index.html",
  "js/app.min.js",
  "js/bootstrap.js",
  "js/main.js",
  "js/extensions.min.js",
  "js/stencils.min.js",
  "js/shapes-14-6-5.min.js",
  // Los dos viewers se quedan: `js/PreConfig.js` referencia a `viewer.min.js`, y
  // `viewer-static.min.js` lo referencian `app.min.js` y `EditorUi.js` (es el
  // que sostiene la exportación a HTML). Sacarlos rompería en silencio, que es
  // justo lo que la spec pide no hacer.
  "js/viewer.min.js",
  "js/viewer-static.min.js",
  // Las bibliotecas de formas y las plantillas: lo que hay que volver a probar
  // después de cada quita, y por eso mismo lo que nunca se quita.
  "shapes/",
  "stencils/",
  "templates/",
  "styles/",
  "images/",
  "img/",
  "mxgraph/",
  // El inglés es el fallback de draw.io y el español es la UI de Mycelium.
  "resources/dia.txt",
  "resources/dia_es.txt",

  // > [!warning] MathJax se queda, aunque la spec lo daba por descartado
  // > Se probó sacarlo y **se revirtió**. draw.io lo pide al arrancar
  // > (`js/PreConfig.js` → `DRAW_MATH_URL`), así que sin él quedaba un 404 en
  // > cada apertura del editor, y las fórmulas dentro de las figuras dejaban de
  // > dibujarse en silencio. A cambio, ahorraba ~1 MB comprimido sobre 32: el
  // > peso real está en `stencils/`, que no se toca. La regla de la spec —«si
  // > algo se rompe, revertí esa quita»— manda sobre la lista de candidatos.
  "math4/",
];

const args = new Set(process.argv.slice(2));
const FORZAR = args.has("--forzar");
const SIN_RECORTE = args.has("--sin-recorte");

const log = (...m) => console.log("[drawio]", ...m);

function mb(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** Tamaño total y cantidad de archivos de un árbol de directorios. */
async function medir(dir) {
  let bytes = 0;
  let archivos = 0;
  const pendientes = [dir];
  while (pendientes.length > 0) {
    const actual = pendientes.pop();
    for (const entrada of await readdir(actual, { withFileTypes: true })) {
      const ruta = join(actual, entrada.name);
      if (entrada.isDirectory()) pendientes.push(ruta);
      else {
        bytes += (await stat(ruta)).size;
        archivos += 1;
      }
    }
  }
  return { bytes, archivos };
}

/** Huella de la configuración actual: si cambia, hay que rehacer la extracción. */
function huellaDeRecorte() {
  const cfg = JSON.stringify({ VERSION, SIN_RECORTE, RECORTE });
  return createHash("sha256").update(cfg).digest("hex").slice(0, 16);
}

async function sha256De(buf) {
  return createHash("sha256").update(buf).digest("hex");
}

/** ¿Ya está preparado lo mismo que pide esta corrida? */
async function yaEstaPreparado() {
  if (FORZAR || !existsSync(SELLO)) return false;
  try {
    const sello = JSON.parse(await readFile(SELLO, "utf8"));
    return sello.version === VERSION && sello.recorte === huellaDeRecorte();
  } catch {
    return false;
  }
}

/** Baja el `.war`, usando la copia cacheada si su hash ya coincide. */
async function obtenerWar() {
  if (existsSync(WAR_CACHEADO)) {
    const buf = await readFile(WAR_CACHEADO);
    const hash = await sha256De(buf);
    if (hash === SHA256_ESPERADO) {
      log(`usando la copia cacheada (${mb(buf.length)}, SHA-256 verificado)`);
      return buf;
    }
    log("la copia cacheada no coincide con el hash esperado; se vuelve a bajar");
  }

  log(`bajando ${URL_WAR}`);
  const res = await fetch(URL_WAR, { redirect: "follow" });
  if (!res.ok) {
    throw new Error(`la descarga falló con HTTP ${res.status} ${res.statusText}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  log(`bajados ${mb(buf.length)}`);

  const hash = await sha256De(buf);
  if (SHA256_ESPERADO && hash !== SHA256_ESPERADO) {
    throw new Error(
      `SHA-256 inesperado.\n  esperado: ${SHA256_ESPERADO}\n  obtenido: ${hash}\n` +
        "O cambiaron el asset debajo de la etiqueta, o la bajada se cortó. " +
        "Si el cambio es legítimo, actualizá SHA256_ESPERADO a mano tras revisarlo.",
    );
  }
  log(`SHA-256 verificado: ${hash}`);

  await mkdir(CACHE, { recursive: true });
  await writeFile(WAR_CACHEADO, buf);
  return buf;
}

/** ¿Esta ruta del `.war` sobrevive al recorte? */
function sobrevive(ruta) {
  if (SIN_RECORTE) return true;
  if (INTOCABLE.some((p) => ruta === p || ruta.startsWith(p))) return true;
  return !RECORTE.some((p) => ruta === p || ruta.startsWith(p));
}

async function main() {
  if (await yaEstaPreparado()) {
    const { bytes, archivos } = await medir(DESTINO);
    log(`ya preparado: draw.io v${VERSION} en public/drawio/`);
    log(`  ${archivos} archivos, ${mb(bytes)} — nada que hacer`);
    return;
  }

  const war = await obtenerWar();

  // JSZip viene de `jszip`, que ya es dependencia del proyecto (se usa para
  // exportar el vault). Un `.war` es un zip, así que no hace falta nada más.
  const { default: JSZip } = await import("jszip");
  log("extrayendo…");
  const zip = await JSZip.loadAsync(war);

  await rm(DESTINO, { recursive: true, force: true });
  await mkdir(DESTINO, { recursive: true });

  let escritos = 0;
  let omitidos = 0;
  // Se escribe de a un archivo por vez, a propósito: la webapp entera
  // descomprimida no cabe cómoda en memoria en una máquina justa.
  for (const [ruta, entrada] of Object.entries(zip.files)) {
    if (entrada.dir) continue;
    if (!sobrevive(ruta)) {
      omitidos += 1;
      continue;
    }
    const destino = join(DESTINO, ruta);
    await mkdir(dirname(destino), { recursive: true });
    await writeFile(destino, await entrada.async("nodebuffer"));
    escritos += 1;
  }

  const { bytes, archivos } = await medir(DESTINO);
  await writeFile(
    SELLO,
    `${JSON.stringify(
      {
        version: VERSION,
        url: URL_WAR,
        sha256: SHA256_ESPERADO,
        recorte: huellaDeRecorte(),
        sinRecorte: SIN_RECORTE,
        omitidos,
        archivos,
        bytes,
        preparadoEl: new Date().toISOString(),
      },
      null,
      2,
    )}\n`,
  );

  log(`extraídos ${escritos} archivos (${omitidos} omitidos por el recorte)`);
  log(`public/drawio/ ocupa ${mb(bytes)} en ${archivos} archivos`);

  if (!existsSync(join(DESTINO, "index.html"))) {
    throw new Error(
      "no quedó public/drawio/index.html: la webapp no se serviría. Revisá el recorte.",
    );
  }
}

main().catch((err) => {
  console.error("[drawio] ERROR:", err.message);
  process.exitCode = 1;
});
