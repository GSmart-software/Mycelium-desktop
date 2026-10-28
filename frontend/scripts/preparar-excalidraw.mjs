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
 * Además escribe `public/excalidraw-assets/LICENCIAS-FUENTES.txt`: las fuentes
 * son de terceros (casi todas OFL-1.1, que exige que cada copia lleve el aviso
 * de copyright y la licencia) y el paquete no trae ninguna licencia. El
 * copyright y la versión salen de la tabla `name` de cada `.woff2`; la licencia,
 * de `LICENCIAS` (abajo). Una familia nueva sin licencia anotada hace fallar el
 * script: no se distribuye una fuente sin saber bajo qué licencia.
 *
 * Uso:  npm run preparar-excalidraw
 *       npm run preparar-excalidraw -- --forzar
 */

import { existsSync } from "node:fs";
import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { nombresWoff2 } from "./nombres-woff2.mjs";

const AQUI = dirname(fileURLToPath(import.meta.url));
const FRONTEND = resolve(AQUI, "..");
const PAQUETE = join(FRONTEND, "node_modules", "@excalidraw", "excalidraw");
const ORIGEN = join(PAQUETE, "dist", "prod", "fonts");
const DESTINO_BASE = join(FRONTEND, "public", "excalidraw-assets");
const DESTINO = join(DESTINO_BASE, "fonts");
const SELLO = join(DESTINO_BASE, ".preparado.json");
const AVISO = join(DESTINO_BASE, "LICENCIAS-FUENTES.txt");
const TEXTOS = join(AQUI, "licencias");

/**
 * Licencia de cada familia de `dist/prod/fonts/`, revisada a mano contra la
 * propia fuente y su repositorio. `texto`: `"OFL-1.1"` (se adjunta la licencia
 * entera una vez), `"propio"` (la fuente trae la licencia completa en su tabla
 * `name` y se copia de ahí) o `"Liberation-1"` (GPL-2.0 con la excepción de
 * fuentes, que es como se publicaron las Liberation 1.x).
 */
const LICENCIAS = {
  Assistant: { licencia: "SIL Open Font License 1.1", texto: "OFL-1.1", origen: "https://github.com/hafontia/Assistant" },
  Cascadia: { licencia: "SIL Open Font License 1.1", texto: "propio", origen: "https://github.com/microsoft/cascadia-code" },
  ComicShanns: { licencia: "MIT", texto: "propio", origen: "https://github.com/shannpersand/comic-shanns" },
  Excalifont: { licencia: "SIL Open Font License 1.1", texto: "OFL-1.1", origen: "https://github.com/excalidraw/excalidraw" },
  Liberation: {
    licencia: "GNU GPL 2.0 con la excepción de fuentes (Liberation 1.x)",
    texto: "Liberation-1",
    origen: "https://github.com/liberationfonts/liberation-fonts",
  },
  Lilita: { licencia: "SIL Open Font License 1.1", texto: "OFL-1.1", origen: "https://github.com/googlefonts/lilita-one" },
  Nunito: { licencia: "SIL Open Font License 1.1", texto: "OFL-1.1", origen: "https://github.com/googlefonts/nunito" },
  Virgil: { licencia: "SIL Open Font License 1.1", texto: "OFL-1.1", origen: "https://github.com/excalidraw/virgil" },
  Xiaolai: { licencia: "SIL Open Font License 1.1", texto: "OFL-1.1", origen: "https://github.com/lxgw/kose-font" },
};

/** La excepción de fuentes de la GPL con la que se publicaron las Liberation 1.x. */
const EXCEPCION_FUENTES = `As a special exception, if you create a document which uses this font, and
embed this font or unaltered portions of this font into the document, this
font does not by itself cause the resulting document to be covered by the GNU
General Public License. This exception does not however invalidate any other
reasons why the document might be covered by the GNU General Public License.
If you modify this font, you may extend this exception to your version of the
font, but you are not obligated to do so. If you do not wish to do so, delete
this exception statement from your version.`;

/** Arma el aviso de licencias de las fuentes copiadas. */
async function escribirAviso(version) {
  const familias = (await readdir(ORIGEN, { withFileTypes: true }))
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
  const sinLicencia = familias.filter((f) => !LICENCIAS[f]);
  if (sinLicencia.length > 0) {
    throw new Error(
      `familias de fuentes sin licencia anotada en LICENCIAS: ${sinLicencia.join(", ")}. ` +
        "Revisá su licencia y agregala antes de distribuirlas.",
    );
  }
  const partes = [
    `Fuentes de Excalidraw ${version} incluidas en Mycelium (public/excalidraw-assets/fonts/).`,
    "Se distribuyen sin modificar, tal como vienen en el paquete @excalidraw/excalidraw.",
    "",
  ];
  const textos = new Set();
  const propios = [];
  for (const familia of familias) {
    const archivos = (await readdir(join(ORIGEN, familia))).filter((a) => a.endsWith(".woff2")).sort();
    const datos = nombresWoff2(join(ORIGEN, familia, archivos[0]));
    const { licencia, texto, origen } = LICENCIAS[familia];
    const copyright = texto === "propio" && /^MIT License/.test(datos[0] ?? "")
      ? (datos[0].match(/^Copyright .*$/gm) ?? []).join("; ")
      : datos[0] ?? "";
    partes.push(
      "-".repeat(72),
      `${datos[16] ?? datos[1] ?? familia}${datos[5] ? ` (${datos[5].split(";")[0]})` : ""}`,
      `Copyright: ${copyright.trim() || "(sin aviso en la fuente)"}`,
      `Licencia: ${licencia}`,
      `Origen: ${origen}`,
      "",
    );
    if (texto === "propio") propios.push([datos[16] ?? datos[1] ?? familia, datos[0].startsWith("MIT") ? datos[0] : datos[13]]);
    else textos.add(texto);
  }
  for (const [nombre, licencia] of propios) {
    partes.push("=".repeat(72), `Licencia de ${nombre} (la que trae la propia fuente)`, "=".repeat(72), "", licencia.trim(), "");
  }
  if (textos.has("OFL-1.1")) {
    partes.push("=".repeat(72), "SIL Open Font License 1.1", "=".repeat(72), "");
    partes.push((await readFile(join(TEXTOS, "OFL-1.1.txt"), "utf8")).trim(), "");
  }
  if (textos.has("Liberation-1")) {
    partes.push("=".repeat(72), "Liberation Sans: GNU GPL 2.0 con la excepción de fuentes", "=".repeat(72), "");
    partes.push(EXCEPCION_FUENTES, "", (await readFile(join(TEXTOS, "GPL-2.0.txt"), "utf8")).trim(), "");
  }
  await writeFile(AVISO, `${partes.join("\n")}\n`);
}

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
        await escribirAviso(version);
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
  await escribirAviso(version);
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
