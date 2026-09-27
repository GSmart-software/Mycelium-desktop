// Publicación de los diccionarios del corrector ortográfico (`FUN-L-12`, § 4 de
// `docs/features/corrector-ortografico.md`).
//
// Arma, a partir de los paquetes `dictionary-*` de npm (wooorm/dictionaries),
// la carpeta que va a R2 junto a los instaladores:
//
//   diccionarios/
//   ├── manifiesto.json
//   ├── es-AR/1.0.0/{es-AR.aff.gz, es-AR.dic.gz, LICENSE.txt}
//   ├── es-ES/1.0.0/…
//   ├── en-US/1.0.0/…
//   └── it-IT/1.0.0/…
//
//   npm run publicar-diccionarios -- --simulacro   solo arma la carpeta local
//   npm run publicar-diccionarios                  arma y sube a R2 (wrangler)
//   npm run publicar-diccionarios -- --ayuda
//
// La carpeta local (`frontend/.diccionarios/`) sirve también para desarrollo:
// la app la lee si se le apunta con `MYCELIUM_DICCIONARIOS` (ver la spec, «Cómo
// probarlo»). Las URLs del manifiesto son **relativas**, así que la misma
// carpeta funciona servida desde R2, desde un servidor local o desde el disco.
//
// Las rutas llevan la versión del diccionario y son inmutables: para publicar un
// cambio de un diccionario se sube su `version` en la tabla de abajo. Antes de
// subir se comprueba que ninguna versión ya publicada cambie de contenido.
//
// Node >= 18. Sin dependencias: los paquetes se bajan con `npm install` a
// `frontend/.diccionarios-fuente/` (fuera de git).
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const RAIZ_FRONTEND = resolve(fileURLToPath(new URL("..", import.meta.url)));
const FUENTE = join(RAIZ_FRONTEND, ".diccionarios-fuente");
const SALIDA_DEFECTO = join(RAIZ_FRONTEND, ".diccionarios");

/** El bucket y la URL pública: los mismos que los instaladores (`publicar.mjs`). */
const BUCKET = process.env.MYCELIUM_BUCKET_RELEASES || "mycelium-releases";
const URL_PUBLICA = "https://pub-4a4b6d7b99be4917a2fe0074be9dfa40.r2.dev";
const PREFIJO = "diccionarios";

/**
 * Las variantes de español que publica wooorm/dictionaries, además de la de
 * España. El usuario ve un solo «Español»; la app elige la de la región del
 * sistema, y si no hay, la de España.
 */
const REGIONES_ES = [
  "AR", "BO", "CL", "CO", "CR", "CU", "DO", "EC", "GT", "HN",
  "MX", "NI", "PA", "PE", "PH", "PR", "PY", "SV", "US", "UY", "VE",
];

/**
 * Qué se publica. `version` es la del diccionario en R2 (no la del paquete):
 * subirla es la única forma de cambiar uno ya publicado.
 */
const IDIOMAS = [
  {
    id: "es",
    nombre: "Español",
    porDefecto: "es-ES",
    licencia: "GPL-3.0-or-later OR LGPL-3.0-or-later OR MPL-1.1",
    urlFuente: "https://github.com/sbosio/rla-es",
    autor: "Santiago Bosio y colaboradores (RLA-ES)",
    variantes: [
      { region: "ES", id: "es-ES", paquete: "dictionary-es@4.0.0", version: "1.0.0" },
      ...REGIONES_ES.map((r) => ({
        region: r,
        id: `es-${r}`,
        paquete: `dictionary-es-${r.toLowerCase()}@2.0.0`,
        version: "1.0.0",
      })),
    ],
  },
  {
    id: "en",
    nombre: "Inglés",
    porDefecto: "en-US",
    licencia: "MIT AND BSD",
    urlFuente: "http://wordlist.aspell.net/",
    autor: "Kevin Atkinson (SCOWL)",
    variantes: [{ region: "US", id: "en-US", paquete: "dictionary-en@4.0.0", version: "1.0.0" }],
  },
  {
    id: "it",
    nombre: "Italiano",
    porDefecto: "it-IT",
    // Solo GPL-3 (spec § 8): se distribuye aparte, opcional y sin modificar.
    licencia: "GPL-3.0",
    urlFuente: "https://extensions.openoffice.org/project/dict-it",
    autor: "Andrea Pescetti y colaboradores",
    variantes: [{ region: "IT", id: "it-IT", paquete: "dictionary-it@2.0.0", version: "1.0.0" }],
  },
];

/** Dónde leer el texto completo de cada licencia nombrada. */
const TEXTOS_LICENCIA = {
  "GPL-3.0": "https://www.gnu.org/licenses/gpl-3.0.txt",
  "LGPL-3.0": "https://www.gnu.org/licenses/lgpl-3.0.txt",
  "MPL-1.1": "https://www.mozilla.org/media/MPL/1.1/index.txt",
};

// ── Utilidades ────────────────────────────────────────────────────────────────

function fallar(texto) {
  console.error(`\n  x  ${texto}`);
  process.exit(1);
}

function ok(texto) {
  console.log(`  ok  ${texto}`);
}

const sha256 = (datos) => createHash("sha256").update(datos).digest("hex");

function nombrePaquete(especificador) {
  return especificador.slice(0, especificador.lastIndexOf("@"));
}

function leerOpciones(argv) {
  const opciones = { simulacro: false, salida: SALIDA_DEFECTO, ayuda: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--simulacro" || a === "-s") opciones.simulacro = true;
    else if (a === "--salida") opciones.salida = resolve(argv[++i] ?? fallar("--salida necesita una carpeta"));
    else if (a === "--ayuda" || a === "-h") opciones.ayuda = true;
    else fallar(`Opción desconocida: ${a}`);
  }
  return opciones;
}

const AYUDA = `
Publica los diccionarios del corrector ortográfico (FUN-L-12).

  --simulacro, -s     Solo arma la carpeta local; no sube nada.
  --salida <carpeta>  Dónde armarla (por defecto frontend/.diccionarios).
  --ayuda, -h         Esto.

Para probar la app contra la carpeta local:
  set MYCELIUM_DICCIONARIOS=${SALIDA_DEFECTO}
  npm run tauri dev
`;

// ── 1. Paquetes ───────────────────────────────────────────────────────────────

function instalarPaquetes() {
  const paquetes = IDIOMAS.flatMap((i) => i.variantes.map((v) => v.paquete));
  const faltan = paquetes.filter((p) => !existsSync(join(FUENTE, "node_modules", nombrePaquete(p), "index.dic")));
  if (faltan.length === 0) {
    ok(`paquetes ya descargados en ${FUENTE}`);
    return;
  }
  mkdirSync(FUENTE, { recursive: true });
  if (!existsSync(join(FUENTE, "package.json"))) {
    writeFileSync(join(FUENTE, "package.json"), JSON.stringify({ private: true, name: "diccionarios-fuente" }, null, 2));
  }
  console.log(`  ..  npm install ${faltan.length} paquetes`);
  const r = spawnSync("npm", ["install", "--no-audit", "--no-fund", "--save-exact", ...faltan], {
    cwd: FUENTE,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (r.status !== 0) fallar("No se pudieron bajar los paquetes dictionary-* de npm.");
  ok("paquetes descargados");
}

// ── 2. Armado ─────────────────────────────────────────────────────────────────

function licenciaTxt(idioma, variante, textoPaquete) {
  const textos = Object.entries(TEXTOS_LICENCIA)
    .filter(([spdx]) => idioma.licencia.includes(spdx))
    .map(([spdx, url]) => `  ${spdx}: ${url}`)
    .join("\n");
  return [
    `Diccionario ${variante.id} (${idioma.nombre}) para el corrector ortográfico de Mycelium.`,
    "",
    `Autor: ${idioma.autor}`,
    `Fuente: ${idioma.urlFuente}`,
    `Paquete: ${variante.paquete} (https://github.com/wooorm/dictionaries)`,
    `Licencia: ${idioma.licencia}`,
    ...(textos ? ["Texto completo de la licencia:", textos] : []),
    "",
    "Se distribuye sin modificar: los archivos .aff y .dic son los del paquete,",
    "solo comprimidos con gzip para la descarga.",
    "",
    "─".repeat(72),
    "Aviso de licencia del diccionario, tal como lo trae su paquete:",
    "─".repeat(72),
    "",
    textoPaquete,
  ].join("\n");
}

function armar(salida) {
  rmSync(salida, { recursive: true, force: true });
  mkdirSync(salida, { recursive: true });
  const archivos = []; // { clave, archivo, contentType }
  const manifiesto = { version: 1, idiomas: [] };

  for (const idioma of IDIOMAS) {
    const variantes = [];
    for (const v of idioma.variantes) {
      const dir = join(FUENTE, "node_modules", nombrePaquete(v.paquete));
      const aff = readFileSync(join(dir, "index.aff"));
      const dic = readFileSync(join(dir, "index.dic"));
      const licencia = existsSync(join(dir, "license")) ? readFileSync(join(dir, "license"), "utf8") : "";

      const rel = `${v.id}/${v.version}`;
      mkdirSync(join(salida, rel), { recursive: true });
      // gzip nivel 9: se comprime una vez y se descarga muchas.
      const affGz = gzipSync(aff, { level: 9 });
      const dicGz = gzipSync(dic, { level: 9 });
      writeFileSync(join(salida, rel, `${v.id}.aff.gz`), affGz);
      writeFileSync(join(salida, rel, `${v.id}.dic.gz`), dicGz);
      writeFileSync(join(salida, rel, "LICENSE.txt"), licenciaTxt(idioma, v, licencia));
      for (const nombre of [`${v.id}.aff.gz`, `${v.id}.dic.gz`]) {
        archivos.push({ clave: `${rel}/${nombre}`, archivo: join(salida, rel, nombre), contentType: "application/gzip" });
      }
      archivos.push({ clave: `${rel}/LICENSE.txt`, archivo: join(salida, rel, "LICENSE.txt"), contentType: "text/plain; charset=utf-8" });

      variantes.push({
        region: v.region,
        id: v.id,
        version: v.version,
        aff: `${rel}/${v.id}.aff.gz`,
        dic: `${rel}/${v.id}.dic.gz`,
        // El hash es del archivo DESCOMPRIMIDO: es lo que la app verifica
        // antes de usarlo, después de descomprimir.
        sha256Aff: sha256(aff),
        sha256Dic: sha256(dic),
        bytes: affGz.length + dicGz.length,
      });
    }
    const porDefecto = variantes.find((v) => v.id === idioma.porDefecto);
    manifiesto.idiomas.push({
      id: idioma.id,
      nombre: idioma.nombre,
      variantes,
      porDefecto: idioma.porDefecto,
      licencia: idioma.licencia,
      urlLicencia: `${porDefecto.id}/${porDefecto.version}/LICENSE.txt`,
      urlFuente: idioma.urlFuente,
      autor: idioma.autor,
    });
    const total = variantes.reduce((s, v) => s + v.bytes, 0);
    ok(`${idioma.nombre}: ${variantes.length} variante(s), ${(total / 1024).toFixed(0)} KB en gzip`);
  }

  // Sin BOM y con `{` como primer byte, como los manifiestos del updater.
  writeFileSync(join(salida, "manifiesto.json"), JSON.stringify(manifiesto, null, 2) + "\n");
  archivos.push({
    clave: "manifiesto.json",
    archivo: join(salida, "manifiesto.json"),
    contentType: "application/json",
  });
  ok(`manifiesto.json con ${manifiesto.idiomas.length} idiomas`);
  return { manifiesto, archivos };
}

// ── 3. Subida ─────────────────────────────────────────────────────────────────

/**
 * Lo publicado es inmutable: si una variante con la misma versión ya está en R2
 * con otro contenido, no se sube (la app no volvería a descargarla y cada
 * instalación tendría una cosa distinta). Hay que subir su versión.
 */
async function comprobarInmutables(manifiesto) {
  let remoto;
  try {
    const r = await fetch(`${URL_PUBLICA}/${PREFIJO}/manifiesto.json`);
    if (r.status === 404) return ok("no hay manifiesto publicado todavía");
    if (!r.ok) fallar(`El manifiesto publicado respondió ${r.status}; no sigo a ciegas.`);
    remoto = await r.json();
  } catch (e) {
    fallar(`No pude leer el manifiesto publicado (${e.message}); no sigo a ciegas.`);
  }
  const publicadas = new Map();
  for (const i of remoto.idiomas ?? []) for (const v of i.variantes ?? []) publicadas.set(`${v.id}@${v.version}`, v);
  for (const i of manifiesto.idiomas) {
    for (const v of i.variantes) {
      const previa = publicadas.get(`${v.id}@${v.version}`);
      if (previa && (previa.sha256Aff !== v.sha256Aff || previa.sha256Dic !== v.sha256Dic)) {
        fallar(`${v.id} ${v.version} ya está publicado con otro contenido: subí su versión en IDIOMAS.`);
      }
    }
  }
  ok("ninguna versión publicada cambia de contenido");
}

function subir(archivos) {
  for (const { clave, archivo, contentType } of archivos) {
    const r = spawnSync(
      "npx",
      ["--no-install", "wrangler", "r2", "object", "put", `${BUCKET}/${PREFIJO}/${clave}`, "--file", archivo, "--remote", "--content-type", contentType],
      { stdio: "inherit", shell: process.platform === "win32" },
    );
    if (r.status !== 0) fallar(`Falló la subida de ${clave}. Lo ya subido queda; se puede repetir.`);
    ok(`subido ${PREFIJO}/${clave}`);
  }
}

// ── Principal ─────────────────────────────────────────────────────────────────

const opciones = leerOpciones(process.argv.slice(2));
if (opciones.ayuda) {
  console.log(AYUDA);
  process.exit(0);
}
console.log(`\n=== Diccionarios del corrector ${opciones.simulacro ? "(SIMULACRO: no se sube nada)" : ""}===\n`);
instalarPaquetes();
const { manifiesto, archivos } = armar(opciones.salida);
console.log(`\n  Carpeta lista: ${opciones.salida}`);
if (opciones.simulacro) {
  console.log("  Para probar la app contra ella:");
  console.log(`    set MYCELIUM_DICCIONARIOS=${opciones.salida}`);
  process.exit(0);
}
await comprobarInmutables(manifiesto);
// El manifiesto va ÚLTIMO (`archivos` ya lo tiene al final): mientras se suben
// los diccionarios, el publicado sigue apuntando a archivos que existen.
subir(archivos);
console.log(`\n  Publicado en ${URL_PUBLICA}/${PREFIJO}/manifiesto.json`);
