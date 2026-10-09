// Publicación de una versión de Mycelium (`FUN-L-15` · `RELEASE-SCRIPT-PUBLICACION`).
//
// Automatiza los pasos 2 a 5 de `docs/procesos/Publicar una version.md`: firmar,
// subir los instaladores a Cloudflare R2, escribir los tres manifiestos y
// **comprobar que lo publicado sirve**. El proceso manual sigue documentado y
// sigue siendo el respaldo cuando esto falla.
//
//   npm run publicar -- --ci <carpeta> --simulacro   ensayo: hace todo menos subir
//   npm run publicar -- --ci <carpeta>               publicación real (el circuito normal)
//   npm run publicar                                 respaldo: compila Windows acá, solo Windows
//   npm run publicar -- --ayuda                      todas las opciones
//
// El circuito normal (`FUN-L-28`, «opción 2», 2026-10-05): GitHub Actions compila
// los TRES sistemas —Windows, macOS y Linux— SIN firmar, y este script firma esos
// artefactos acá y los publica. Por qué la firma es local y no de CI: la clave
// privada no sale de esta máquina (ver [[instaladores-mac-linux]]). Sin `--ci`,
// el script compila Windows en esta PC como antes de CI: es el respaldo para
// cuando Actions no esté disponible.
//
// Node >= 18 (usa `fetch` global). No necesita dependencias.
import { spawnSync } from "node:child_process";
import { createHash, createPublicKey, verify as verificarEd25519 } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buscarSecretoDev } from "./secreto-dev.mjs";

// ── Constantes del proyecto ───────────────────────────────────────────────────

const RAIZ_FRONTEND = resolve(fileURLToPath(new URL("..", import.meta.url)));
const RAIZ_REPO = resolve(RAIZ_FRONTEND, "..");

/**
 * Nombre del bucket de R2. La URL pública (`pub-<hash>.r2.dev`) no lo contiene,
 * así que no hay de dónde derivarlo; se puede sobreescribir por entorno para
 * ensayar contra el bucket de pruebas del § 4 del proceso manual.
 */
const BUCKET = process.env.MYCELIUM_BUCKET_RELEASES || "mycelium-releases";

/** Marcadores del `tauri.conf.json` de fábrica: con ellos el updater está apagado. */
const MARCADOR_PUBKEY = "SIN-CONFIGURAR";
const MARCADOR_ENDPOINT = ".invalid";

/** Delimitadores de la parte de la nota de release que ve el usuario final. */
const NOTAS_INICIO = "<!-- notas-release:inicio -->";
const NOTAS_FIN = "<!-- notas-release:fin -->";

/** Sin el límite de jobs, rustc se queda sin memoria (ver [[Compilacion y entorno de desarrollo]]). */
const JOBS_CARGO = "2";

// ── Presentación ──────────────────────────────────────────────────────────────

/** Pasos que llegaron a completarse, para poder decir qué quedó a medias si algo falla. */
const hechos = [];

let pasoActual = 0;
/**
 * Sin `--ci`: comprobar, compilar, preservar y firmar, manifiestos, subir y
 * verificar. Con `--ci` no hay compilación: compilar y preservar se reemplazan
 * por un único paso de preparar y firmar lo de CI.
 */
let TOTAL_PASOS = 6;

/** La versión que se está publicando, para los mensajes de recuperación. */
let versionEnCurso = null;

function paso(titulo) {
  pasoActual += 1;
  console.log(`\n[${pasoActual}/${TOTAL_PASOS}] ${titulo}`);
}

function ok(texto) {
  console.log(`      ok   ${texto}`);
}

function aviso(texto) {
  console.log(`      !    ${texto}`);
}

function detalle(texto) {
  console.log(`           ${texto}`);
}

/** Error esperado: el script lo reporta con contexto en vez de volcar un stack. */
class ErrorDePublicacion extends Error {}

/**
 * Fallo de RED al verificar. Se distingue a propósito de `ErrorDePublicacion`:
 * llegado ese punto lo publicado ya está subido, así que el problema es no haber
 * podido comprobarlo — no que la publicación haya fallado. Decir lo segundo
 * cuando pasa lo primero es la peor forma de enterarse.
 */
class ErrorDeRed extends Error {}

function fallar(mensaje) {
  throw new ErrorDePublicacion(mensaje);
}

// ── Argumentos ────────────────────────────────────────────────────────────────

function leerArgumentos(argv) {
  const opciones = {
    simulacro: false,
    forzar: false,
    sinCompilar: false,
    notas: null,
    ci: null,
    ayuda: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--simulacro" || arg === "-s") opciones.simulacro = true;
    else if (arg === "--forzar") opciones.forzar = true;
    else if (arg === "--sin-compilar") opciones.sinCompilar = true;
    else if (arg === "--ayuda" || arg === "-h") opciones.ayuda = true;
    else if (arg === "--notas") {
      opciones.notas = argv[i + 1];
      i += 1;
      if (!opciones.notas) fallar("`--notas` necesita la ruta de un archivo.");
    } else if (arg === "--ci") {
      opciones.ci = argv[i + 1];
      i += 1;
      if (!opciones.ci || opciones.ci.startsWith("--")) {
        fallar("`--ci` necesita la carpeta donde descargaste los artefactos del run de GitHub Actions.");
      }
    } else fallar(`Opción desconocida: ${arg}. Probá con --ayuda.`);
  }
  return opciones;
}

const AYUDA = `
Publicar una versión de Mycelium (FUN-L-15).

  npm run publicar -- --ci <carpeta> [opciones]   circuito normal (los tres sistemas)
  npm run publicar -- [opciones]                  respaldo: compila Windows acá

Opciones:
  --ci <carpeta>    EL CIRCUITO NORMAL (FUN-L-28). Publica Windows (x64), macOS
                    (Apple Silicon) y Linux (x64), compilados en GitHub Actions.
                    <carpeta> es donde descargaste los TRES artefactos del run
                    (mycelium-<version>-windows-x86_64, -macos-aarch64 y
                    -linux-x86_64): descomprimidos —en subcarpetas o todo junto—
                    o los .zip tal cual. Son obligatorios los tres. No se compila
                    nada en esta PC: CI no firma, así que el script firma acá el
                    -setup.exe, el .msi, el .app.tar.gz, el .AppImage, el .deb y el
                    .rpm, y verifica cada firma contra la pubkey de la app.
                    Sin --ci, el respaldo: compila Windows acá y publica solo
                    Windows.
  --simulacro, -s   Hace todo menos subir al bucket: comprueba, firma (y sin --ci
                    compila), escribe los manifiestos y los deja en
                    installers/v<version>/. Imprime los comandos de subida que se
                    habrían ejecutado.
  --sin-compilar    Solo sin --ci: reutiliza los instaladores de Windows ya
                    compilados (bundle/ o, si no están, installers/v<version>/)
                    en vez de recompilar. Con --ci se ignora (con aviso): no hay
                    nada que compilar.
  --forzar          Permite republicar una versión que YA está en el bucket.
                    Sin esto se aborta: reescribir los archivos de una versión que
                    la gente ya tiene puede romper instalaciones ajenas.
  --notas <archivo> Toma el changelog de ese archivo entero, en vez de la sección
                    delimitada de la nota de release.
  --ayuda, -h       Esto.

El changelog sale de docs/estado/Version <version>.md, de lo que haya entre
${NOTAS_INICIO} y ${NOTAS_FIN}.

Variables de entorno:
  TAURI_SIGNING_PRIVATE_KEY           obligatoria (ruta a la clave privada)
  TAURI_SIGNING_PRIVATE_KEY_PASSWORD  obligatoria
  MYCELIUM_BUCKET_RELEASES            opcional, para ensayar contra otro bucket
`;

// ── Utilidades ────────────────────────────────────────────────────────────────

/** Lee JSON tolerando un BOM de entrada (los nuestros no lo llevan, los ajenos quizá). */
function leerJson(ruta) {
  return JSON.parse(readFileSync(ruta, "utf8").replace(/^﻿/, ""));
}

/**
 * Escribe JSON en UTF-8 **sin BOM** y lo comprueba. `serde_json` —el parser de
 * Rust que lee el manifiesto— no salta el BOM: falla con un error de sintaxis
 * que no lo menciona por ningún lado, así que el fallo se vería tarde y sin pista.
 */
function escribirJsonSinBom(ruta, objeto) {
  writeFileSync(ruta, `${JSON.stringify(objeto, null, 2)}\n`, "utf8");
  const primerByte = readFileSync(ruta)[0];
  if (primerByte !== 0x7b) {
    fallar(
      `${basename(ruta)} no empieza por '{' (byte 0x${primerByte.toString(16).toUpperCase()}). ` +
        "Si es 0xEF lleva BOM y la app no podría leerlo.",
    );
  }
}

function sha256(ruta) {
  return createHash("sha256").update(readFileSync(ruta)).digest("hex");
}

/**
 * Ejecuta un comando externo. En Windows los ejecutables de npm son `.cmd`, que
 * solo se resuelven a través del shell; por eso `shell: true` y el entrecomillado
 * manual de los argumentos con espacios.
 */
function ejecutar(comando, args, { capturar = false, env } = {}) {
  const linea = [comando, ...args.map((a) => (/\s/.test(a) ? `"${a}"` : a))].join(" ");
  const r = spawnSync(linea, {
    cwd: RAIZ_FRONTEND,
    shell: true,
    encoding: "utf8",
    stdio: capturar ? "pipe" : "inherit",
    env: { ...process.env, ...env },
  });
  return {
    codigo: r.status,
    salida: `${r.stdout || ""}${r.stderr || ""}`.trim(),
    linea,
  };
}

/** GET con anti-caché: el CDN de r2.dev puede servir la versión anterior del JSON. */
/**
 * GET con reintentos. La red falla de forma intermitente y en la fase de
 * verificación eso es especialmente molesto: la publicación ya salió bien y un
 * `fetch failed` suelto haría pensar que no. Tres intentos con espera creciente.
 */
async function pedir(url, intentos = 3) {
  const separador = url.includes("?") ? "&" : "?";
  let ultimo;
  for (let i = 1; i <= intentos; i++) {
    try {
      return await fetch(`${url}${separador}_=${Date.now()}`, { cache: "no-store" });
    } catch (e) {
      ultimo = e;
      if (i < intentos) {
        aviso(`fallo de red consultando ${url} (intento ${i}/${intentos}), reintentando…`);
        await new Promise((r) => setTimeout(r, 1500 * i));
      }
    }
  }
  throw new ErrorDeRed(`No pude consultar ${url}: ${ultimo?.cause?.message ?? ultimo?.message}`);
}

// ── 1. Comprobaciones previas ─────────────────────────────────────────────────

/**
 * La versión vive en cinco sitios que hay que subir a mano (ver [[Versionado del
 * sistema]]). Si uno se olvida, el instalador y el manifiesto anuncian números
 * distintos y la actualización queda en un bucle: la app se actualiza y sigue
 * viendo que hay algo nuevo.
 */
function comprobarVersion() {
  const fuentes = {
    "lib/version.ts": (() => {
      const texto = readFileSync(join(RAIZ_FRONTEND, "lib/version.ts"), "utf8");
      return texto.match(/APP_VERSION\s*=\s*"([^"]+)"/)?.[1];
    })(),
    "package.json": leerJson(join(RAIZ_FRONTEND, "package.json")).version,
    "src-tauri/Cargo.toml": (() => {
      const texto = readFileSync(join(RAIZ_FRONTEND, "src-tauri/Cargo.toml"), "utf8");
      return texto.match(/\[package\][\s\S]*?\nversion\s*=\s*"([^"]+)"/)?.[1];
    })(),
    "src-tauri/tauri.conf.json": leerJson(join(RAIZ_FRONTEND, "src-tauri/tauri.conf.json")).version,
    "src-tauri/Cargo.lock": (() => {
      const texto = readFileSync(join(RAIZ_FRONTEND, "src-tauri/Cargo.lock"), "utf8");
      return texto.match(/name\s*=\s*"app"\s*\nversion\s*=\s*"([^"]+)"/)?.[1];
    })(),
  };

  const faltantes = Object.entries(fuentes).filter(([, v]) => !v);
  if (faltantes.length) {
    fallar(`No pude leer la versión de: ${faltantes.map(([k]) => k).join(", ")}.`);
  }

  const distintas = [...new Set(Object.values(fuentes))];
  if (distintas.length > 1) {
    const lista = Object.entries(fuentes)
      .map(([archivo, v]) => `             ${v}  ${archivo}`)
      .join("\n");
    fallar(`La versión no coincide en los cinco archivos:\n${lista}`);
  }

  const version = distintas[0];
  if (!/^\d+\.\d+\.\d+$/.test(version)) {
    fallar(`La versión "${version}" no tiene la forma X.Y.Z.`);
  }
  return version;
}

/**
 * La base pública se **deriva** del `endpoints` compilado en la app, nunca se
 * escribe aparte: si se duplicara, un día apuntarían a sitios distintos y nadie
 * lo notaría hasta que las actualizaciones dejaran de llegar.
 */
function comprobarConfiguracionDelUpdater() {
  const conf = leerJson(join(RAIZ_FRONTEND, "src-tauri/tauri.conf.json"));
  const updater = conf.plugins?.updater;
  if (!updater) fallar("`plugins.updater` no está en tauri.conf.json.");

  const { pubkey, endpoints } = updater;
  if (!pubkey || pubkey.includes(MARCADOR_PUBKEY)) {
    fallar(
      "`plugins.updater.pubkey` sigue siendo el marcador de fábrica: la app tiene el " +
        "updater apagado y no podría verificar ninguna firma. Ver [[Publicar una version]] § 1.3.",
    );
  }
  const endpoint = endpoints?.[0];
  if (!endpoint) fallar("`plugins.updater.endpoints` está vacío.");
  if (endpoint.includes(MARCADOR_ENDPOINT)) {
    fallar(`\`endpoints\` sigue siendo el marcador de fábrica (${endpoint}). Ver § 1.3.`);
  }
  if (!endpoint.endsWith("/latest.json")) {
    fallar(`\`endpoints[0]\` debería terminar en /latest.json, y es: ${endpoint}`);
  }
  let url;
  try {
    url = new URL(endpoint);
  } catch {
    fallar(`\`endpoints[0]\` no es una URL válida: ${endpoint}`);
  }
  if (url.protocol !== "https:") fallar(`El endpoint tiene que ser https, y es ${url.protocol}`);

  return { base: endpoint.slice(0, -"/latest.json".length), pubkey };
}

/**
 * Comprueba que las dos variables de firma existen. **Nunca imprime sus valores**:
 * `TAURI_SIGNING_PRIVATE_KEY` es una ruta, pero la contraseña es la contraseña, y
 * esta salida acaba pegada en chats y en informes.
 */
function comprobarClavesDeFirma() {
  const clave = process.env.TAURI_SIGNING_PRIVATE_KEY;
  const password = process.env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD;

  if (!clave || !password) {
    const cual = !clave ? "TAURI_SIGNING_PRIVATE_KEY" : "TAURI_SIGNING_PRIVATE_KEY_PASSWORD";
    fallar(
      `Falta ${cual}. Sin las dos no se puede firmar nada (ni lo de CI con \`tauri signer ` +
        "sign\`, ni el .exe de `tauri build`) y la versión no podría instalarse como actualización.\n\n" +
        "           La causa MÁS habitual no es que no existan, sino que esta terminal se\n" +
        "           abrió ANTES de definirlas: se guardaron a nivel de usuario y eso solo\n" +
        "           alcanza a los procesos que arranquen después. Cargalas en esta sesión:\n\n" +
        "             $env:TAURI_SIGNING_PRIVATE_KEY = [Environment]::GetEnvironmentVariable('TAURI_SIGNING_PRIVATE_KEY','User')\n" +
        "             $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = [Environment]::GetEnvironmentVariable('TAURI_SIGNING_PRIVATE_KEY_PASSWORD','User')\n\n" +
        "           Abrir una terminal nueva también sirve — salvo en la terminal integrada\n" +
        "           de Mycelium, que hereda el entorno de la app: ahí haría falta reiniciar\n" +
        "           Mycelium, o usar el bloque de arriba.\n\n" +
        "           Si de verdad nunca las definiste: [[Publicar una version]] § 1.4.",
    );
  }

  // El valor admite dos formas: la ruta del .key o su contenido en base64.
  if (existsSync(clave)) ok("TAURI_SIGNING_PRIVATE_KEY apunta a un archivo que existe");
  else if (/^[A-Za-z0-9+/=\s]{60,}$/.test(clave)) ok("TAURI_SIGNING_PRIVATE_KEY lleva la clave en línea");
  else fallar("TAURI_SIGNING_PRIVATE_KEY no es ni una ruta existente ni una clave en base64.");

  ok("TAURI_SIGNING_PRIVATE_KEY_PASSWORD definida");
}

/** Devuelve cómo invocar wrangler, o falla. Se prueba el global antes que el de npx. */
function comprobarWrangler() {
  const candidatos = [
    { comando: "wrangler", args: [] },
    { comando: "npx", args: ["--no-install", "wrangler"] },
  ];
  let invocacion = null;
  for (const c of candidatos) {
    const r = ejecutar(c.comando, [...c.args, "--version"], { capturar: true });
    if (r.codigo === 0) {
      invocacion = c;
      ok(`wrangler disponible (${r.salida.split("\n").pop()})`);
      break;
    }
  }
  if (!invocacion) {
    fallar("wrangler no está instalado o no está en el PATH. Instalalo con: npm install -g wrangler");
  }

  const quien = ejecutar(invocacion.comando, [...invocacion.args, "whoami"], { capturar: true });
  if (quien.codigo !== 0 || /not authenticated|no estás autenticado/i.test(quien.salida)) {
    fallar("wrangler no está autenticado. Ejecutá: wrangler login");
  }
  ok("wrangler autenticado");
  return invocacion;
}

/**
 * Republicar encima de una versión que la gente ya tiene es de las pocas cosas
 * que pueden romper instalaciones ajenas: alguien puede tenerla a medio descargar
 * y la firma dejaría de coincidir. Por eso se aborta salvo `--forzar`.
 */
async function comprobarQueNoEstaPublicada(base, version, forzar) {
  let respuesta;
  try {
    respuesta = await pedir(`${base}/${version}/latest.json`);
  } catch (e) {
    fallar(`No pude consultar el bucket (${base}): ${e.message}`);
  }
  if (respuesta.status === 404) {
    ok(`la ${version} todavía no está en el bucket`);
    return null;
  }
  if (!respuesta.ok) {
    aviso(`el bucket respondió ${respuesta.status} al preguntar por la ${version}; sigo`);
    return null;
  }
  if (!forzar) {
    fallar(
      `La ${version} YA está publicada en ${base}/${version}/. Publicar una corrección como ` +
        "versión nueva es lo correcto; reescribir una versión existente puede romperle la " +
        "actualización a quien ya la tenga. Si aun así querés hacerlo, repetí con --forzar.",
    );
  }
  aviso(`la ${version} ya está publicada y se va a REESCRIBIR (--forzar)`);
  // Se devuelve lo publicado para que `principal` pueda comprobar que la
  // republicación no le quita plataformas (ver `comprobarQueNoSePierdenPlataformas`).
  try {
    return JSON.parse((await respuesta.text()).replace(/^﻿/, ""));
  } catch {
    aviso(`el latest.json publicado de la ${version} no parsea; se reescribe igual`);
    return null;
  }
}

/**
 * Republicar con `--forzar` **sin** `--ci` una versión que ya salió con macOS y
 * Linux reescribiría su manifiesto solo con Windows: esas instalaciones dejarían de
 * encontrar su plataforma y se quedarían sin actualizar, sin ningún error visible
 * de este lado. Es justo el comando que se sugiere tras un corte de red
 * (`--sin-compilar --forzar`), así que el olvido es fácil y se corta acá.
 */
function comprobarQueNoSePierdenPlataformas(publicado, opciones) {
  if (!publicado || opciones.ci) return;
  // Las claves de Windows (`windows-x86_64` y `windows-x86_64-msi`) las rehace
  // también el respaldo local; las demás solo salen de --ci.
  const otras = Object.keys(publicado.platforms ?? {}).filter((p) => !p.startsWith("windows-"));
  if (otras.length) {
    fallar(
      `La ${publicado.version} publicada incluye también ${otras.join(", ")}. Republicarla sin ` +
        "--ci dejaría su manifiesto solo con Windows y esas instalaciones no podrían actualizar.\n" +
        "           Repetí con --ci <carpeta>. Si ya la publicaste con --ci, las copias firmadas\n" +
        `           quedaron en installers/v${publicado.version}/ y sirven: --ci installers/v${publicado.version}`,
    );
  }
}

/**
 * El changelog es un resumen curado, no la nota de release entera: esa tiene
 * secciones internas ("Dónde vive el código", "Cómo comprobarlo en la app") que
 * no le sirven a quien solo decide si actualiza. Se toma de la sección delimitada
 * de la nota, para que la fuente siga siendo una sola y viva junto al release.
 */
function leerNotas(version, rutaNotas) {
  let texto;
  let origen;

  if (rutaNotas) {
    const ruta = resolve(process.cwd(), rutaNotas);
    if (!existsSync(ruta)) fallar(`No existe el archivo de notas: ${ruta}`);
    texto = readFileSync(ruta, "utf8").replace(/^﻿/, "").trim();
    origen = ruta;
  } else {
    const ruta = join(RAIZ_REPO, "docs/estado", `Version ${version}.md`);
    if (!existsSync(ruta)) {
      fallar(
        `No existe la nota de release "docs/estado/Version ${version}.md". El changelog sale ` +
          "de ahí; escribila antes de publicar (paso 1 de [[Publicar una version]]).",
      );
    }
    const contenido = readFileSync(ruta, "utf8").replace(/^﻿/, "");
    const desde = contenido.indexOf(NOTAS_INICIO);
    const hasta = contenido.indexOf(NOTAS_FIN);
    if (desde === -1 || hasta === -1 || hasta < desde) {
      fallar(
        `La nota "docs/estado/Version ${version}.md" no tiene la sección del changelog.\n` +
          `           Envolvé en ella el resumen que va a ver el usuario:\n\n` +
          `             ${NOTAS_INICIO}\n` +
          `             ## Qué entra\n\n             - …\n` +
          `             ${NOTAS_FIN}\n\n` +
          "           Son comentarios HTML: Mycelium no los muestra al leer la nota.\n" +
          "           Alternativa: pasá el resumen en un archivo aparte con --notas <archivo>.",
      );
    }
    texto = contenido.slice(desde + NOTAS_INICIO.length, hasta).trim();
    origen = ruta;
  }

  // Los .md del repo están en CRLF; el manifiesto viaja con saltos `\n` a secas para que
  // el JSON publicado no lleve `\r\n` sueltos que ningún renderer necesita.
  texto = texto.replace(/\r\n/g, "\n");

  if (!texto) {
    fallar(
      "El changelog quedó vacío. Publicar un manifiesto sin notas deja al usuario decidiendo " +
        "a ciegas si actualiza.",
    );
  }
  // El modo desarrollador (`FUN-S-36`) y todo lo que habilita son ocultos a
  // propósito: anunciarlos en el diálogo de actualización los desactiva como tales.
  // Se comprueba antes de compilar, que es cuando corregirlo todavía es gratis.
  const secreto = buscarSecretoDev(texto);
  if (secreto) {
    fallar(
      `El changelog menciona ${secreto.que} (coincide con ${secreto.patron}). Lo del modo ` +
        "desarrollador es deliberadamente oculto y no se anuncia: quitá esa línea y repetí. " +
        "La lista completa está en scripts/secreto-dev.mjs.",
    );
  }
  return { texto, origen };
}

// ── Artefactos ────────────────────────────────────────────────────────────────

function nombresDeArtefactos(version) {
  const exe = `Mycelium_${version}_x64-setup.exe`;
  return { exe, sig: `${exe}.sig`, msi: `Mycelium_${version}_x64_en-US.msi` };
}

/**
 * Localiza los tres artefactos. Lo recién compilado manda; solo con `--sin-compilar`
 * se acepta lo preservado en `installers/`, y se dice en voz alta de dónde salió:
 * subir sin querer una compilación vieja es indistinguible de subir la buena hasta
 * que a alguien le falla la actualización.
 */
function localizarArtefactos(version, { sinCompilar }) {
  const { exe, sig, msi } = nombresDeArtefactos(version);
  const bundle = join(RAIZ_FRONTEND, "src-tauri/target/release/bundle");
  const preservados = join(RAIZ_REPO, "installers", `v${version}`);

  const candidatos = [
    { origen: "la compilación (target/release/bundle)", exe: join(bundle, "nsis", exe), sig: join(bundle, "nsis", sig), msi: join(bundle, "msi", msi) },
  ];
  if (sinCompilar) {
    candidatos.push({
      origen: `installers/v${version}`,
      exe: join(preservados, exe),
      sig: join(preservados, sig),
      msi: join(preservados, msi),
    });
  }

  for (const c of candidatos) {
    if (existsSync(c.exe) && existsSync(c.sig) && existsSync(c.msi)) {
      ok(`instaladores tomados de ${c.origen}`);
      return c;
    }
  }

  const buscados = candidatos.map((c) => `             ${c.exe}`).join("\n");
  fallar(
    `No encontré los instaladores de la ${version}. Busqué en:\n${buscados}\n` +
      "           Compilá primero (quitá --sin-compilar).",
  );
}

// ── Artefactos de CI: Windows, macOS y Linux (`FUN-L-28`, opción --ci) ────────

/**
 * Lo que sube GitHub Actions (§ 3 de [[instaladores-mac-linux]]). Cada patrón
 * captura la versión del nombre para poder rechazar los artefactos de otro run.
 * `Mycelium.app.tar.gz` es la excepción: el bundler de Tauri no le pone versión,
 * así que se acepta sin ella —y se comprueba de otra forma, ver
 * `comprobarVersionDelApp`— o ya renombrado por una corrida anterior de este
 * script, que es lo que permite `--ci installers/v<version>`.
 *
 * `firmar`: lo que el updater puede instalar y por lo tanto necesita `.sig`. El
 * `.dmg` es solo para la primera instalación. Windows va primero: el orden es el
 * de la subida, y el `.exe` es el canal de la mayoría de las instalaciones.
 * `contentType` de Windows queda sin definir, como siempre se subió el `.exe`.
 */
const ARTEFACTOS_CI = [
  { id: "exe", plataforma: "Windows", patron: /^Mycelium_(\d+\.\d+\.\d+)_x64-setup\.exe$/, firmar: true },
  { id: "msi", plataforma: "Windows", patron: /^Mycelium_(\d+\.\d+\.\d+)_x64_en-US\.msi$/, firmar: true },
  { id: "dmg", plataforma: "macOS", patron: /^Mycelium_(\d+\.\d+\.\d+)_aarch64\.dmg$/, firmar: false, contentType: "application/x-apple-diskimage" },
  { id: "app", plataforma: "macOS", patron: /^Mycelium(?:_(\d+\.\d+\.\d+)_aarch64)?\.app\.tar\.gz$/, firmar: true, contentType: "application/gzip" },
  { id: "appimage", plataforma: "Linux", patron: /^Mycelium_(\d+\.\d+\.\d+)_amd64\.AppImage$/, firmar: true, contentType: "application/octet-stream" },
  { id: "deb", plataforma: "Linux", patron: /^Mycelium_(\d+\.\d+\.\d+)_amd64\.deb$/, firmar: true, contentType: "application/vnd.debian.binary-package" },
  { id: "rpm", plataforma: "Linux", patron: /^Mycelium-(\d+\.\d+\.\d+)-\d+\.x86_64\.rpm$/, firmar: true, contentType: "application/x-rpm" },
];

/**
 * Las entradas de `platforms` del manifiesto. `tauri-plugin-updater` (2.10,
 * `Updater::get_urls`) busca primero `{os}-{arch}-{instalador}` y después
 * `{os}-{arch}`, donde el instalador es el tipo de paquete con el que se instaló
 * esa copia (el bundler lo deja grabado en el binario; `installer_for_bundle_type`
 * lo traduce a `nsis`, `msi`, `app`, `deb`, `rpm` o `appimage`):
 *
 * - Windows: `windows-x86_64` es el NSIS (`-setup.exe`), el canal de siempre:
 *   instala por usuario y no pide UAC. Una copia instalada con el **MSI** busca
 *   antes `windows-x86_64-msi`; sin esa entrada caía en `windows-x86_64`, bajaba
 *   el NSIS y lo ejecutaba (`WindowsUpdaterType` decide por los bytes, no por cómo
 *   se instaló): el NSIS instala por usuario en `%LOCALAPPDATA%` y el MSI había
 *   instalado por máquina en `Program Files`, así que quedaban **dos Mycelium**
 *   (el aviso de [[Generar instaladores desktop]]). Con `windows-x86_64-msi` → el
 *   `.msi` firmado, esa copia se actualiza con `msiexec /i` sobre sí misma (el
 *   `upgradeCode` fijo hace la *major upgrade*), a costa de un UAC por
 *   actualización, que es lo que implica haber elegido el MSI. `windows-x86_64-nsis`
 *   no hace falta: sería un duplicado de `windows-x86_64`.
 * - macOS: el `.dmg` y el `.app` cuentan las dos como `app`, así que basta
 *   `darwin-aarch64`; `darwin-aarch64-app` sería un duplicado.
 * - Linux: **no basta** `linux-x86_64`. Una copia instalada con el `.deb` busca
 *   `linux-x86_64-deb`; si no está, cae en `linux-x86_64`, descarga el AppImage y
 *   `install_deb` lo rechaza (`InvalidUpdaterFormat`): esa gente vería fallar cada
 *   actualización. Por eso el `.deb` y el `.rpm` también se firman y llevan su
 *   entrada; `linux-x86_64` queda para el AppImage, que no tiene que nombrarse.
 */
const PLATAFORMAS = [
  { clave: "windows-x86_64", artefacto: "exe" },
  { clave: "windows-x86_64-msi", artefacto: "msi" },
  { clave: "darwin-aarch64", artefacto: "app" },
  { clave: "linux-x86_64", artefacto: "appimage" },
  { clave: "linux-x86_64-deb", artefacto: "deb" },
  { clave: "linux-x86_64-rpm", artefacto: "rpm" },
];

/** Nombre con el que se sube y se preserva cada artefacto de CI. */
function nombreFinalCi(id, version, original) {
  // Sin versión en el nombre, dos versiones se pisarían en installers/ y la URL del
  // manifiesto no diría a qué versión apunta.
  if (id === "app") return `Mycelium_${version}_aarch64.app.tar.gz`;
  return original;
}

function listarArchivos(carpeta) {
  const salida = [];
  for (const entrada of readdirSync(carpeta, { withFileTypes: true })) {
    const ruta = join(carpeta, entrada.name);
    if (entrada.isDirectory()) salida.push(...listarArchivos(ruta));
    else if (entrada.isFile()) salida.push(ruta);
  }
  return salida;
}

/**
 * `tar` del sistema. En Windows se pide el de System32 (bsdtar, que abre .zip y
 * .tar.gz) por ruta: desde Git Bash el primero del PATH es el GNU tar de MSYS, que
 * no sabe abrir un .zip.
 */
function comandoTar() {
  if (process.platform === "win32") {
    const sistema = join(process.env.SystemRoot || "C:\\Windows", "System32", "tar.exe");
    if (existsSync(sistema)) return sistema;
  }
  return "tar";
}

/** Carpeta temporal para los .zip descomprimidos; se borra al salir. */
let carpetaTemporalCi = null;
process.on("exit", () => {
  if (carpetaTemporalCi) rmSync(carpetaTemporalCi, { recursive: true, force: true });
});

/**
 * Si el usuario pasó los .zip tal como los baja GitHub, se descomprimen a una
 * carpeta temporal (no en la suya: no se le ensucia nada). Sin dependencias: el
 * `tar` de Windows 10+ abre .zip.
 */
function descomprimirZips(zips) {
  carpetaTemporalCi ??= mkdtempSync(join(tmpdir(), "mycelium-publicar-ci-"));
  const destinos = [];
  for (const zip of zips) {
    const destino = join(carpetaTemporalCi, basename(zip, ".zip"));
    mkdirSync(destino, { recursive: true });
    const r = spawnSync(comandoTar(), ["-xf", zip, "-C", destino], { encoding: "utf8" });
    if (r.status !== 0) {
      fallar(
        `No pude descomprimir ${zip}${r.error ? ` (${r.error.message})` : ""}.\n` +
          `${(r.stderr || "").trim()}\n` +
          "           Descomprimilo a mano en la misma carpeta y repetí.",
      );
    }
    ok(`descomprimido ${basename(zip)}`);
    destinos.push(destino);
  }
  return destinos;
}

/**
 * Lee la versión del `Info.plist` de dentro del `.app.tar.gz`. Es el único de los
 * artefactos que no dice su versión en el nombre, y es justo el que instala el
 * updater: uno de otro run haría que el Mac se "actualice" a la versión vieja y
 * vuelva a ver la nueva en cada comprobación. Devuelve `null` si no se pudo leer.
 */
function leerVersionDelApp(ruta) {
  const r = spawnSync(comandoTar(), ["-xOzf", ruta, "Mycelium.app/Contents/Info.plist"], {
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });
  if (r.status !== 0 || !r.stdout) return null;
  return r.stdout.match(/<key>CFBundleShortVersionString<\/key>\s*<string>([^<]+)<\/string>/)?.[1] ?? null;
}

/**
 * Busca en `<carpeta>` (recursivo, y dentro de los .zip que haya) los siete
 * archivos de la versión que se publica —los de los tres artefactos del run—.
 * Tolerante con la forma —subcarpetas con el nombre del artefacto, todo plano,
 * zips— y estricto con el contenido: si falta uno o es de otra versión, no se
 * sigue. Se llama en las comprobaciones previas, antes de firmar o subir nada.
 */
function localizarArtefactosCi(carpeta, version) {
  const raiz = resolve(process.cwd(), carpeta);
  if (!existsSync(raiz)) fallar(`No existe la carpeta de --ci: ${raiz}`);

  let archivos = listarArchivos(raiz);
  const zips = archivos.filter((a) => a.toLowerCase().endsWith(".zip"));
  if (zips.length) {
    for (const destino of descomprimirZips(zips)) archivos.push(...listarArchivos(destino));
  }

  const encontrados = {};
  const faltan = [];
  for (const tipo of ARTEFACTOS_CI) {
    const candidatos = archivos
      .map((ruta) => ({ ruta, m: basename(ruta).match(tipo.patron) }))
      .filter((c) => c.m)
      .map((c) => ({ ruta: c.ruta, version: c.m[1] ?? null }));

    // Los que dicen otra versión en el nombre no son candidatos, pero se nombran si
    // no queda otro: "es de la 2.3.0" orienta mucho más que "no lo encontré".
    const deOtra = candidatos.filter((c) => c.version && c.version !== version);
    let validos = candidatos.filter((c) => !c.version || c.version === version);

    // El mismo archivo dos veces (el zip y su contenido ya descomprimido, o la
    // carpeta de la corrida anterior) no es ambigüedad: se deduplica por contenido.
    if (validos.length > 1) {
      const vistos = new Map();
      for (const c of validos) {
        const huella = sha256(c.ruta);
        if (!vistos.has(huella)) vistos.set(huella, c);
      }
      validos = [...vistos.values()];
    }

    if (validos.length > 1 && tipo.id === "app" && encontrados.dmg) {
      // Sin versión en el nombre, el que va con el .dmg elegido es el de su mismo run.
      const juntoAlDmg = validos.filter((c) => dirname(c.ruta) === dirname(encontrados.dmg.ruta));
      if (juntoAlDmg.length === 1) validos = juntoAlDmg;
    }

    if (validos.length > 1) {
      fallar(
        `Hay más de un ${tipo.id === "app" ? "Mycelium.app.tar.gz" : `.${tipo.id}`} distinto en ${raiz}:\n` +
          validos.map((c) => `             ${relative(raiz, c.ruta) || c.ruta}`).join("\n") +
          "\n           Dejá solo los artefactos del run de esta versión y repetí.",
      );
    }
    if (validos.length === 0) {
      faltan.push(
        deOtra.length
          ? `${tipo.plataforma} ${tipo.id}: solo encontré ${deOtra.map((c) => basename(c.ruta)).join(", ")} (de otra versión)`
          : `${tipo.plataforma} ${tipo.id}: ningún archivo que coincida con ${tipo.patron}`,
      );
      continue;
    }
    encontrados[tipo.id] = { ...tipo, ruta: validos[0].ruta, nombre: nombreFinalCi(tipo.id, version, basename(validos[0].ruta)) };
  }

  if (faltan.length) {
    fallar(
      `Faltan artefactos de CI de la ${version} en ${raiz}:\n` +
        faltan.map((f) => `             - ${f}`).join("\n") +
        "\n           Descargá los TRES artefactos del run de Actions de ESTA versión " +
        `(mycelium-${version}-windows-x86_64, mycelium-${version}-macos-aarch64 y ` +
        `mycelium-${version}-linux-x86_64). Son obligatorios: con --ci no se compila nada acá. ` +
        "Ver [[Publicar una version]] § 2.",
    );
  }

  comprobarVersionDelApp(encontrados.app.ruta, version);
  const mostrar = (ruta) =>
    carpetaTemporalCi && ruta.startsWith(carpetaTemporalCi)
      ? `${relative(carpetaTemporalCi, ruta)}  (del .zip)`
      : relative(raiz, ruta) || ruta;
  for (const a of Object.values(encontrados)) detalle(`${a.plataforma.padEnd(7)} ${mostrar(a.ruta)}`);
  ok(`artefactos de Windows, macOS y Linux de la ${version} encontrados en ${raiz}`);
  return encontrados;
}

function comprobarVersionDelApp(ruta, version) {
  const delApp = leerVersionDelApp(ruta);
  if (delApp === null) {
    aviso(
      `no pude leer la versión de dentro de ${basename(ruta)}; se confía en que viene del mismo ` +
        "run que el .dmg (no tiene versión en el nombre)",
    );
    return;
  }
  if (delApp !== version) {
    fallar(
      `${basename(ruta)} es de la ${delApp} (Info.plist), no de la ${version}. Es el archivo que ` +
        "instala el updater en mac: publicarlo dejaría a esas instalaciones en un bucle de " +
        "actualización. Descargá el artefacto del run correcto.",
    );
  }
  ok(`el .app.tar.gz es de la ${version} (según su Info.plist)`);
}

/**
 * Firma con `tauri signer sign`, igual que hace `tauri build` con el `.exe`.
 *
 * Ojo con la clave: `tauri build` acepta en `TAURI_SIGNING_PRIVATE_KEY` la ruta
 * del `.key` **o** su contenido, pero `signer sign` solo el contenido (con una ruta
 * falla con "failed to decode base64 secret key"). Para la ruta tiene su propia
 * variable, `TAURI_SIGNING_PRIVATE_KEY_PATH`; así que se traduce acá, sin tocar
 * cómo las define el usuario. La contraseña va por entorno, nunca en la línea de
 * comandos: esa línea se imprime en los errores.
 */
function firmarConTauri(ruta) {
  const clave = process.env.TAURI_SIGNING_PRIVATE_KEY;
  const env = existsSync(clave)
    ? { TAURI_SIGNING_PRIVATE_KEY: undefined, TAURI_SIGNING_PRIVATE_KEY_PATH: clave }
    : { TAURI_SIGNING_PRIVATE_KEY_PATH: undefined };
  const r = ejecutar("npx", ["tauri", "signer", "sign", ruta], { capturar: true, env });
  const rutaSig = `${ruta}.sig`;
  if (r.codigo !== 0 || !existsSync(rutaSig)) {
    fallar(`\`tauri signer sign\` no pudo firmar ${basename(ruta)} (código ${r.codigo}):\n${r.salida}`);
  }
  return rutaSig;
}

/**
 * Verifica una firma del updater **como la verifica la app**, en Node puro:
 * minisign sobre Ed25519, que es lo que usa Tauri. Así se detecta antes de subir
 * que la clave con que se firmó no es la pareja de la `pubkey` compilada —el
 * fallo que, si no, aparece cuando un usuario intenta actualizar—.
 *
 * Formato (base64 de un texto de cuatro líneas): comentario, `alg(2) keyid(8)
 * firma(64)`, `trusted comment: …`, y la firma global sobre `firma + comentario`.
 * Con alg `ED` lo firmado es el BLAKE2b-512 del archivo; con `Ed`, el archivo.
 */
function verificarFirmaUpdater(rutaArchivo, firmaB64, pubkeyB64) {
  const lineasUtiles = (b64) =>
    Buffer.from(b64.trim(), "base64").toString("utf8").split(/\r?\n/).filter((l) => l.length);
  const pub = Buffer.from(lineasUtiles(pubkeyB64).find((l) => !l.startsWith("untrusted comment:")) ?? "", "base64");
  const [, sigB64, comentario, globalB64] = lineasUtiles(firmaB64);
  if (pub.length !== 42 || !sigB64 || !comentario?.startsWith("trusted comment: ") || !globalB64) {
    fallar(`La firma de ${basename(rutaArchivo)} o la pubkey no tienen el formato de minisign.`);
  }
  const sig = Buffer.from(sigB64, "base64");
  if (!sig.subarray(2, 10).equals(pub.subarray(2, 10))) {
    fallar(
      `${basename(rutaArchivo)} se firmó con OTRA clave que la pareja de la pubkey de ` +
        "tauri.conf.json (no coincide el id de clave). Ninguna instalación aceptaría esta " +
        "actualización. Revisá TAURI_SIGNING_PRIVATE_KEY.",
    );
  }
  const clave = createPublicKey({
    key: Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), pub.subarray(10)]),
    format: "der",
    type: "spki",
  });
  const datos = readFileSync(rutaArchivo);
  const algoritmo = sig.subarray(0, 2).toString("latin1");
  const mensaje = algoritmo === "ED" ? createHash("blake2b512").update(datos).digest() : datos;
  const firma = sig.subarray(10);
  const global = Buffer.concat([firma, Buffer.from(comentario.slice("trusted comment: ".length), "utf8")]);
  if (!verificarEd25519(null, mensaje, clave, firma) || !verificarEd25519(null, global, clave, Buffer.from(globalB64, "base64"))) {
    fallar(`La firma de ${basename(rutaArchivo)} NO verifica con la pubkey de tauri.conf.json.`);
  }
}

// ── 2. Compilar ───────────────────────────────────────────────────────────────

function compilar() {
  detalle("esto tarda ~10 minutos; la salida de tauri build va entera a esta consola");
  const r = ejecutar("npx", ["tauri", "build"], { env: { CARGO_BUILD_JOBS: JOBS_CARGO } });
  if (r.codigo !== 0) {
    fallar(
      `\`npx tauri build\` terminó con código ${r.codigo}. Si se queja de la firma, revisá las ` +
        "dos variables de entorno (§ 1.4); si se quedó sin memoria, cerrá cosas y repetí.",
    );
  }
  ok("compilación terminada");
}

// ── 3-4. Manifiestos ──────────────────────────────────────────────────────────

function fechaUtc() {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}

/**
 * El manifiesto que consulta la app. `signature` es el **contenido entero** del
 * `.sig`, no una ruta ni un hash: es el error más frecuente del proceso manual.
 */
function leerFirma(rutaSig) {
  const firma = readFileSync(rutaSig, "utf8").trim();
  if (!firma) fallar(`El .sig está vacío: ${rutaSig}`);
  if (firma.includes("\\") || existsSync(firma)) {
    fallar("El .sig parece contener una ruta en vez de la firma. Revisá la compilación.");
  }
  return firma;
}

/**
 * Arma `platforms` con cada clave de `PLATAFORMAS` cuyo artefacto se esté
 * publicando: con --ci, las seis; en el respaldo local, las dos de Windows.
 * `signature` es el **contenido entero** del `.sig`, no una ruta ni un hash. Los
 * dos `latest.json` —raíz y `<version>/`— son el mismo archivo, así que el modo
 * avanzado (`FUN-M-16`) ve las mismas plataformas; `versions.json` no lleva
 * `platforms`.
 */
function construirManifiesto({ version, notas, base, artefactos }) {
  const platforms = {};
  for (const { clave, artefacto } of plataformasPublicadas(artefactos)) {
    const a = artefactos[artefacto];
    platforms[clave] = { signature: leerFirma(a.rutaSig), url: `${base}/${version}/${a.nombre}` };
  }
  if (!platforms["windows-x86_64"]) fallar("El manifiesto quedó sin windows-x86_64: falta el .exe firmado.");
  return { version, notes: notas, pub_date: fechaUtc(), platforms };
}

/** Las entradas de `PLATAFORMAS` cuyo artefacto está entre los que se publican. */
function plataformasPublicadas(artefactos) {
  return PLATAFORMAS.filter((p) => artefactos[p.artefacto]);
}

/**
 * Copia los artefactos de CI a `installers/v<version>/` con su nombre final y firma
 * **las copias**: la carpeta del usuario no se toca, y lo firmado queda preservado
 * ahí. Cada firma se verifica en el acto contra la pubkey de la app (ver
 * `verificarFirmaUpdater`).
 */
function prepararArtefactosCi(encontrados, destino, pubkey) {
  const preparados = {};
  for (const a of Object.values(encontrados)) {
    const copia = join(destino, a.nombre);
    if (resolve(copia) !== resolve(a.ruta)) copyFileSync(a.ruta, copia); // --ci installers/v<version>
    let rutaSig = null;
    if (a.firmar) {
      rutaSig = firmarConTauri(copia);
      verificarFirmaUpdater(copia, readFileSync(rutaSig, "utf8"), pubkey);
      ok(`${a.nombre} firmado; la firma verifica con la pubkey de la app`);
    } else {
      ok(`${a.nombre} copiado (solo instalación inicial, sin firma)`);
    }
    preparados[a.id] = { ...a, ruta: copia, rutaSig, sha: sha256(copia) };
  }
  return preparados;
}

/**
 * Respaldo sin --ci: preserva en `installers/v<version>/` lo que dejó `tauri build`
 * (o lo que ya estaba ahí con --sin-compilar) y devuelve la misma forma que
 * `prepararArtefactosCi`. El `.exe` ya viene firmado por `tauri build`; acá se
 * verifica su firma. El `.msi` se firma acá (con la misma clave) para la entrada
 * `windows-x86_64-msi`: así el respaldo publica las mismas claves de Windows que CI.
 */
function prepararArtefactosLocales(locales, destino, pubkey, version) {
  const { exe, sig, msi } = nombresDeArtefactos(version);
  const copia = (origen, nombre) => {
    const ruta = join(destino, nombre);
    if (resolve(ruta) !== resolve(origen)) copyFileSync(origen, ruta); // ya venían de acá (--sin-compilar)
    return ruta;
  };
  const rutaExe = copia(locales.exe, exe);
  const rutaSigExe = copia(locales.sig, sig);
  const rutaMsi = copia(locales.msi, msi);
  ok(`instaladores en installers/v${version}/ (fuera de git)`);

  verificarFirmaUpdater(rutaExe, readFileSync(rutaSigExe, "utf8"), pubkey);
  ok(`${exe}: la firma de tauri build verifica con la pubkey de la app`);
  const rutaSigMsi = firmarConTauri(rutaMsi);
  verificarFirmaUpdater(rutaMsi, readFileSync(rutaSigMsi, "utf8"), pubkey);
  ok(`${msi} firmado; la firma verifica con la pubkey de la app`);

  return {
    exe: { id: "exe", plataforma: "Windows", nombre: exe, ruta: rutaExe, rutaSig: rutaSigExe, sha: sha256(rutaExe) },
    msi: { id: "msi", plataforma: "Windows", nombre: msi, ruta: rutaMsi, rutaSig: rutaSigMsi, sha: sha256(rutaMsi) },
  };
}

/**
 * `versions.json` se **actualiza, no se reemplaza**: si se pisara, las versiones
 * anteriores desaparecerían del modo avanzado y con ellas la posibilidad de volver
 * atrás. Se descarga el actual, se quita la entrada homónima (republicación) y la
 * nueva se pone arriba.
 */
async function construirIndiceDeVersiones({ base, manifiesto }) {
  let previas = [];
  try {
    const r = await pedir(`${base}/versions.json`);
    if (r.ok) {
      const texto = (await r.text()).replace(/^﻿/, "");
      const json = JSON.parse(texto);
      previas = Array.isArray(json.versions) ? json.versions : [];
      ok(`versions.json actual descargado (${previas.length} versión/es)`);
    } else if (r.status === 404) {
      aviso("no hay versions.json en el bucket todavía; se crea uno nuevo");
    } else {
      fallar(`versions.json respondió ${r.status}. No sigo: reescribirlo perdería el histórico.`);
    }
  } catch (e) {
    if (e instanceof ErrorDePublicacion) throw e;
    fallar(
      `No pude leer el versions.json actual (${e.message}). No sigo: escribir uno nuevo a ciegas ` +
        "borraría las versiones anteriores del modo avanzado.",
    );
  }

  const entrada = {
    version: manifiesto.version,
    pub_date: manifiesto.pub_date,
    notes: manifiesto.notes,
  };
  const resto = previas.filter((v) => v?.version !== manifiesto.version);
  if (resto.length !== previas.length) aviso(`la ${manifiesto.version} ya figuraba en el índice: se reemplaza su entrada`);
  return { versions: [entrada, ...resto] };
}

// ── Subida ────────────────────────────────────────────────────────────────────

function subir(wrangler, { clave, archivo, contentType, simulacro }) {
  const args = [...wrangler.args, "r2", "object", "put", `${BUCKET}/${clave}`, "--file", archivo, "--remote"];
  if (contentType) args.push("--content-type", contentType);

  if (simulacro) {
    detalle(`[simulacro] ${[wrangler.comando, ...args].join(" ")}`);
    return;
  }
  const r = ejecutar(wrangler.comando, args, { capturar: true });
  if (r.codigo !== 0) fallar(`Falló la subida de ${clave}:\n${r.salida}`);
  ok(`subido ${clave}`);
}

// ── 5. Verificación ───────────────────────────────────────────────────────────

async function verificarJson(url, comprobar) {
  const r = await pedir(url);
  if (!r.ok) fallar(`${url} respondió ${r.status}.`);
  // Se leen los bytes crudos y no `.text()`: el decodificador de fetch se come el BOM
  // en silencio, y el BOM es justamente lo que hay que detectar (`serde_json` no lo salta).
  const bytes = Buffer.from(await r.arrayBuffer());
  if (bytes[0] !== 0x7b) {
    fallar(
      `${url} no empieza por '{' (byte 0x${bytes[0].toString(16).toUpperCase()}). ` +
        "Si es 0xEF lleva BOM y la app fallaría al leerlo.",
    );
  }
  let json;
  try {
    json = JSON.parse(bytes.toString("utf8"));
  } catch (e) {
    fallar(`${url} no es JSON válido: ${e.message}`);
  }
  comprobar(json);
  ok(`${url.replace(/^https?:\/\/[^/]+/, "")} responde 200 y parsea`);
  return json;
}

/**
 * La comprobación que solo fallaría cuando un usuario intenta actualizar: que el
 * `.exe` que sirve el bucket sea byte a byte el que se firmó. Un `put` truncado
 * deja un archivo válido a la vista y una firma que no verifica.
 */
async function verificarInstalador(url, sha256Local, etiqueta = "el .exe") {
  const r = await pedir(url);
  if (!r.ok) fallar(`${url} respondió ${r.status}.`);
  const bytes = Buffer.from(await r.arrayBuffer());
  const remoto = createHash("sha256").update(bytes).digest("hex");
  if (remoto !== sha256Local) {
    fallar(
      "El instalador del bucket NO coincide con el que se firmó.\n" +
        `             local:  ${sha256Local}\n` +
        `             bucket: ${remoto}\n` +
        "           Volvé a subirlo; nadie podría actualizar con este archivo.",
    );
  }
  ok(`${etiqueta} del bucket coincide con el firmado (sha256 ${remoto.slice(0, 16)}…)`);
}

// ── Programa ──────────────────────────────────────────────────────────────────

async function principal() {
  const opciones = leerArgumentos(process.argv.slice(2));
  if (opciones.ayuda) {
    console.log(AYUDA);
    return;
  }

  // Con --ci no hay compilación: compilar + preservar se vuelven un solo paso.
  if (opciones.ci) TOTAL_PASOS = 5;
  const modo = opciones.ci ? "Windows, macOS y Linux, compilados en CI" : "solo Windows, compilado en esta PC: respaldo";
  console.log(`\n=== Publicar Mycelium (${modo}) ${opciones.simulacro ? "(SIMULACRO: no se sube nada) " : ""}===`);

  // ── 1. Comprobaciones previas, antes de compilar o firmar nada ──
  paso("Comprobaciones previas");
  if (opciones.ci && opciones.sinCompilar) {
    aviso("--sin-compilar se ignora con --ci: no se compila nada en esta PC, todo viene de CI");
  }
  if (!opciones.ci) {
    aviso("sin --ci: se compila Windows acá y se publica SOLO Windows (el respaldo para cuando CI no está)");
  }
  const version = comprobarVersion();
  versionEnCurso = version;
  ok(`versión ${version}, coherente en los cinco archivos`);
  comprobarClavesDeFirma();
  const { base, pubkey } = comprobarConfiguracionDelUpdater();
  ok(`clave pública configurada; base derivada del endpoint: ${base}`);
  const wrangler = comprobarWrangler();
  detalle(`bucket: ${BUCKET}`);
  const publicado = await comprobarQueNoEstaPublicada(base, version, opciones.forzar);
  comprobarQueNoSePierdenPlataformas(publicado, opciones);
  const notas = leerNotas(version, opciones.notas);
  ok(`changelog leído de ${notas.origen.replace(RAIZ_REPO, "").replace(/^[\\/]/, "")} (${notas.texto.length} caracteres)`);
  const encontradosCi = opciones.ci ? localizarArtefactosCi(opciones.ci, version) : null;
  hechos.push("comprobaciones previas");

  // Se preserva antes de subir para tener los artefactos y los manifiestos a salvo
  // aunque la subida falle: `target/` se borra con cualquier `cargo clean`, y la
  // carpeta de descargas de CI es del usuario.
  const destino = join(RAIZ_REPO, "installers", `v${version}`);
  let artefactos;
  if (encontradosCi) {
    // ── 2. Copiar a installers/, firmar y verificar las firmas de los tres sistemas ──
    paso("Preparar y firmar Windows, macOS y Linux (--ci)");
    mkdirSync(destino, { recursive: true });
    artefactos = prepararArtefactosCi(encontradosCi, destino, pubkey);
    hechos.push(`Windows, macOS y Linux copiados y firmados en installers/v${version}/`);
  } else {
    // ── 2. Compilar (respaldo) ──
    paso(opciones.sinCompilar ? "Compilar (omitido por --sin-compilar)" : "Compilar");
    if (opciones.sinCompilar) aviso("se reutilizan instaladores ya existentes");
    else {
      compilar();
      hechos.push("compilación");
    }
    const locales = localizarArtefactos(version, opciones);

    // ── 3. Preservar y firmar el MSI ──
    paso("Preservar los instaladores en installers/ y firmar el MSI");
    mkdirSync(destino, { recursive: true });
    artefactos = prepararArtefactosLocales(locales, destino, pubkey, version);
    hechos.push(`instaladores preservados (y el MSI firmado) en installers/v${version}/`);
  }
  detalle(`sha256 del .exe firmado: ${artefactos.exe.sha}`);
  const publicadas = plataformasPublicadas(artefactos);

  // ── Manifiestos ──
  paso("Escribir los manifiestos");
  const manifiesto = construirManifiesto({ version, notas: notas.texto, base, artefactos });
  const rutaLatest = join(destino, "latest.json");
  escribirJsonSinBom(rutaLatest, manifiesto);
  ok(`latest.json escrito (UTF-8 sin BOM, primer byte 0x7B) en installers/v${version}/`);
  for (const [clave, entrada] of Object.entries(manifiesto.platforms)) {
    detalle(`${clave.padEnd(18)} ${entrada.url}`);
  }

  const indice = await construirIndiceDeVersiones({ base, manifiesto });
  const rutaVersiones = join(destino, "versions.json");
  escribirJsonSinBom(rutaVersiones, indice);
  ok(`versions.json escrito con ${indice.versions.length} versión/es (la nueva arriba)`);
  hechos.push(`manifiestos escritos en installers/v${version}/`);

  // ── Subir ──
  paso(opciones.simulacro ? "Subir al bucket (SIMULACRO: solo se imprimen los comandos)" : "Subir al bucket");
  // Orden deliberado: primero los archivos (Windows primero), después el manifiesto
  // de la versión, el índice, y el latest.json de la raíz AL FINAL. Es el que dispara
  // la actualización de todo el mundo: no debe anunciar nada que todavía no esté
  // completo en el bucket.
  const subidas = [
    // Cada archivo y, si lo instala el updater, su .sig.
    ...Object.values(artefactos).flatMap((a) => [
      { clave: `${version}/${a.nombre}`, archivo: a.ruta, contentType: a.contentType },
      ...(a.rutaSig ? [{ clave: `${version}/${a.nombre}.sig`, archivo: a.rutaSig, contentType: "text/plain" }] : []),
    ]),
    { clave: `${version}/latest.json`, archivo: rutaLatest, contentType: "application/json" },
    { clave: "versions.json", archivo: rutaVersiones, contentType: "application/json" },
    { clave: "latest.json", archivo: rutaLatest, contentType: "application/json" },
  ];
  for (const s of subidas) {
    subir(wrangler, { ...s, simulacro: opciones.simulacro });
    if (!opciones.simulacro) hechos.push(`subido ${s.clave}`);
  }

  // ── Verificar lo publicado ──
  paso("Verificar lo publicado");
  const firmaDe = (artefacto) => readFileSync(artefactos[artefacto].rutaSig, "utf8").trim();
  if (opciones.simulacro) {
    aviso("no se subió nada, así que se verifica lo local en vez de lo remoto");
    const local = leerJson(rutaLatest);
    for (const { clave, artefacto } of publicadas) {
      if (local.platforms[clave]?.signature !== firmaDe(artefacto)) {
        fallar(`La firma de ${clave} en el manifiesto no coincide con ${basename(artefactos[artefacto].rutaSig)}.`);
      }
    }
    ok(`las firmas de ${publicadas.map((p) => p.clave).join(", ")} son idénticas a sus .sig`);
    ok(`versions.json local contiene ${leerJson(rutaVersiones).versions.map((v) => v.version).join(", ")}`);
    detalle("para verificar de verdad hace falta publicar: repetí sin --simulacro");
  } else {
    const comprobarManifiesto = (json) => {
      if (json.version !== version) fallar(`el manifiesto publicado anuncia la ${json.version}, no la ${version}`);
      for (const { clave, artefacto } of publicadas) {
        if (json.platforms?.[clave]?.signature !== firmaDe(artefacto)) {
          fallar(`la firma de ${clave} en el manifiesto publicado NO es la de su .sig: esa plataforma no podría actualizar`);
        }
      }
    };
    await verificarJson(`${base}/latest.json`, comprobarManifiesto);
    await verificarJson(`${base}/${version}/latest.json`, comprobarManifiesto);
    await verificarJson(`${base}/versions.json`, (json) => {
      if (!json.versions?.some((v) => v.version === version)) {
        fallar(`versions.json publicado no incluye la ${version}`);
      }
    });
    ok(`la firma de los dos manifiestos es idéntica a su .sig en las ${publicadas.length} plataformas`);
    // Se descargan los que instala el updater (los firmados): son los que fallarían
    // en silencio. El .dmg es solo de primera instalación.
    for (const a of Object.values(artefactos).filter((x) => x.rutaSig)) {
      await verificarInstalador(`${base}/${version}/${a.nombre}`, a.sha, a.nombre);
    }
  }

  console.log(
    opciones.simulacro
      ? `\nSimulacro completo. No se subió nada. Lo que se habría publicado quedó en installers/v${version}/.`
      : `\nPublicada la ${version}. Los usuarios con 1.4.0 o posterior la verán en su próxima comprobación diaria.` +
          (encontradosCi ? "\nEn macOS y Linux la verán las copias instaladas desde una versión publicada con --ci." : ""),
  );
}

principal().catch((e) => {
  // Un fallo de RED al verificar no es un fallo de publicación: si se subió
  // todo, la versión ESTÁ publicada y lo que faltó fue comprobarla. Se dice así
  // de claro, con la forma de comprobarla a mano.
  if (e instanceof ErrorDeRed && hechos.some((h) => h.startsWith("subido latest.json"))) {
    const v = versionEnCurso ?? "<version>";
    console.error(`\nLA VERSIÓN SE PUBLICÓ, pero NO se pudo verificar: ${e.message}`);
    console.error(
      "\nTodo se subió, incluido el latest.json de la raíz, así que la actualización ya está\n" +
        "anunciada. Lo que no se pudo hacer es la comprobación posterior — casi seguro es un\n" +
        "corte de red pasajero y no un problema de lo publicado.\n\n" +
        "Comprobalo cuando vuelva la red, sin volver a compilar:\n\n" +
        // Con --ci hay que repetirlo: sin él, el manifiesto se reescribiría solo con
        // Windows (y el script se niega). Las copias firmadas de installers/ sirven de carpeta.
        (process.argv.includes("--ci")
          ? `  npm run publicar -- --forzar --ci installers/v${v}\n\n`
          : "  npm run publicar -- --sin-compilar --forzar\n\n") +
        "Si prefieres mirarlo a mano, la § 5 de docs/procesos/Publicar una version.md dice qué\n" +
        "tiene que dar cada comprobación.",
    );
    process.exit(1);
  }

  console.error(`\nFALLO: ${e instanceof ErrorDePublicacion || e instanceof ErrorDeRed ? e.message : e.stack}`);
  if (hechos.length) {
    console.error("\nLo que SÍ quedó hecho (para saber qué hay a medias):");
    for (const h of hechos) console.error(`  - ${h}`);
  } else {
    console.error("\nNo se llegó a tocar nada: el fallo fue en las comprobaciones previas.");
  }
  console.error(
    "\nSi el bucket quedó a medias, mirá la § 5 de docs/procesos/Publicar una version.md " +
      "(«Cuando algo sale mal»): el latest.json de la raíz se sube el último justamente para " +
      "que un fallo intermedio no le anuncie a nadie una versión incompleta.",
  );
  process.exit(1);
});
