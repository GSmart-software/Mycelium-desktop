#!/usr/bin/env node
/**
 * Copia las fuentes de Excalidraw a `public/excalidraw-assets/fonts/` (`DEF-153`).
 *
 * Excalidraw 0.18 pide las fuentes de los dibujos (Excalifont, Virgil, Cascadia,
 * Nunito, Lilita, Comic Shanns, Liberation, Xiaolai para CJK…) en tiempo de
 * ejecución, a `window.EXCALIDRAW_ASSET_PATH` y, si no está definido o falla, a
 * `https://esm.sh/@excalidraw/excalidraw@<versión>/dist/prod/`. Sin este paso la
 * app de escritorio dependía de la red (sin conexión, el texto salía con la
 * fuente del sistema) y le avisaba a un tercero cada vez que se abría un dibujo.
 * `lib/excalidraw.ts` (`cargarExcalidraw`) apunta la ruta a esta carpeta.
 *
 * **No entra a git**: son ~13 MB de `.woff2` que ya vienen en
 * `node_modules/@excalidraw/excalidraw`, con la versión fijada por
 * `package-lock.json`. Copiarlas en cada `dev`/`build` las mantiene siempre
 * alineadas con el paquete instalado (un `npm update` de Excalidraw cambia los
 * nombres con hash de los archivos), cosa que una copia versionada no garantiza.
 *
 * Es **idempotente**: si ya están copiadas las de la misma versión del paquete,
 * no hace nada.
 *
 * Uso:  npm run preparar-excalidraw
 *       npm run preparar-excalidraw -- --forzar
 */

import { existsSync } from "node:fs";
import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const AQUI = dirname(fileURLToPath(import.meta.url));
const FRONTEND = resolve(AQUI, "..");
const PAQUETE = join(FRONTEND, "node_modules", "@excalidraw", "excalidraw");
const ORIGEN = join(PAQUETE, "dist", "prod", "fonts");
const DESTINO_BASE = join(FRONTEND, "public", "excalidraw-assets");
const DESTINO = join(DESTINO_BASE, "fonts");
const SELLO = join(DESTINO_BASE, ".preparado.json");

const FORZAR = process.argv.includes("--forzar");
const log = (...m) => console.log("[excalidraw]", ...m);

/** Archivos (rutas relativas) y bytes de un árbol de directorios. */
async function listar(dir, base = dir) {
  const archivos = [];
  let bytes = 0;
  for (const entrada of await readdir(dir, { withFileTypes: true })) {
    const ruta = join(dir, entrada.name);
    if (entrada.isDirectory()) {
      const sub = await listar(ruta, base);
      archivos.push(...sub.archivos);
      bytes += sub.bytes;
    } else {
      archivos.push(ruta.slice(base.length + 1).replaceAll("\\", "/"));
      bytes += (await stat(ruta)).size;
    }
  }
  return { archivos, bytes };
}

async function main() {
  if (!existsSync(ORIGEN)) {
    throw new Error(
      `no está ${ORIGEN}. ¿Falta \`npm ci\`, o cambió la estructura del paquete?`,
    );
  }
  const { version } = JSON.parse(await readFile(join(PAQUETE, "package.json"), "utf8"));
  const origen = await listar(ORIGEN);

  if (!FORZAR && existsSync(SELLO) && existsSync(DESTINO)) {
    try {
      const sello = JSON.parse(await readFile(SELLO, "utf8"));
      if (sello.version === version && sello.archivos === origen.archivos.length) {
        log(`ya preparado: fuentes de Excalidraw ${version} en public/excalidraw-assets/ — nada que hacer`);
        return;
      }
    } catch {
      // sello ilegible: se rehace
    }
  }

  await rm(DESTINO_BASE, { recursive: true, force: true });
  await mkdir(DESTINO_BASE, { recursive: true });
  await cp(ORIGEN, DESTINO, { recursive: true });

  const copia = await listar(DESTINO);
  if (copia.archivos.length !== origen.archivos.length) {
    throw new Error(
      `se copiaron ${copia.archivos.length} archivos de ${origen.archivos.length}`,
    );
  }
  await writeFile(
    SELLO,
    `${JSON.stringify({ version, archivos: copia.archivos.length, bytes: copia.bytes }, null, 2)}\n`,
  );
  log(
    `copiadas ${copia.archivos.length} fuentes de Excalidraw ${version} ` +
      `(${(copia.bytes / 1024 / 1024).toFixed(1)} MB) a public/excalidraw-assets/fonts/`,
  );
}

main().catch((err) => {
  console.error("[excalidraw] ERROR:", err.message);
  process.exitCode = 1;
});
