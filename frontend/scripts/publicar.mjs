// Publicación de una versión de Mycelium (`FUN-L-15` · `RELEASE-SCRIPT-PUBLICACION`).
//
// Automatiza los pasos 2 a 5 de `docs/procesos/Publicar una version.md`: compilar
// firmando, subir los instaladores a Cloudflare R2, escribir los tres manifiestos
// y **comprobar que lo publicado sirve**. El proceso manual sigue documentado y
// sigue siendo el respaldo cuando esto falla.
//
//   npm run publicar -- --simulacro     ensayo: hace todo menos subir
//   npm run publicar                    publicación real
//   npm run publicar -- --ayuda         todas las opciones
//
// Por qué un script local y no CI: la clave privada de firma no sale de esta
// máquina y el remoto está desalineado a propósito (ver [[RAMAS]]).
//
// Node >= 18 (usa `fetch` global). No necesita dependencias.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

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

/**
 * El modo avanzado (`FUN-M-16`) es deliberadamente oculto: anunciarlo en el
 * changelog lo desactivaría como tal. Se comprueba antes de compilar, que es
 * cuando corregirlo todavía es gratis.
 */
const PROHIBIDO_EN_NOTAS = [/modo\s+avanzado/i, /FUN-M-16/i];

/** Sin el límite de jobs, rustc se queda sin memoria (ver [[Compilacion y entorno de desarrollo]]). */
const JOBS_CARGO = "2";

// ── Presentación ──────────────────────────────────────────────────────────────

/** Pasos que llegaron a completarse, para poder decir qué quedó a medias si algo falla. */
const hechos = [];

let pasoActual = 0;
const TOTAL_PASOS = 6;

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
    } else fallar(`Opción desconocida: ${arg}. Probá con --ayuda.`);
  }
  return opciones;
}

const AYUDA = `
Publicar una versión de Mycelium (FUN-L-15).

  npm run publicar -- [opciones]

Opciones:
  --simulacro, -s   Hace todo menos subir al bucket: comprueba, compila, escribe
                    los manifiestos y los deja en installers/v<version>/. Imprime
                    los comandos de subida que se habrían ejecutado.
  --sin-compilar    Reutiliza los instaladores ya compilados (bundle/ o, si no
                    están, installers/v<version>/) en vez de recompilar. Es lo que
                    hace falta para rehacer un manifiesto mal escrito sin esperar
                    diez minutos, y para ensayar rápido.
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
async function pedir(url) {
  const separador = url.includes("?") ? "&" : "?";
  return fetch(`${url}${separador}_=${Date.now()}`, { cache: "no-store" });
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

  if (!clave) {
    fallar(
      "Falta TAURI_SIGNING_PRIVATE_KEY. Sin ella `tauri build` no genera el .sig y la " +
        "versión no puede instalarse como actualización. Ver [[Publicar una version]] § 1.4.",
    );
  }
  if (!password) {
    fallar("Falta TAURI_SIGNING_PRIVATE_KEY_PASSWORD. Ver [[Publicar una version]] § 1.4.");
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
    return;
  }
  if (!respuesta.ok) {
    aviso(`el bucket respondió ${respuesta.status} al preguntar por la ${version}; sigo`);
    return;
  }
  if (!forzar) {
    fallar(
      `La ${version} YA está publicada en ${base}/${version}/. Publicar una corrección como ` +
        "versión nueva es lo correcto; reescribir una versión existente puede romperle la " +
        "actualización a quien ya la tenga. Si aun así querés hacerlo, repetí con --forzar.",
    );
  }
  aviso(`la ${version} ya está publicada y se va a REESCRIBIR (--forzar)`);
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
  for (const patron of PROHIBIDO_EN_NOTAS) {
    if (patron.test(texto)) {
      fallar(
        `El changelog menciona el modo avanzado (coincide con ${patron}). Es una función ` +
          "deliberadamente oculta (`FUN-M-16`): anunciarla en el diálogo de actualización la " +
          "desactiva como tal. Quitá esa línea y repetí.",
      );
    }
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
function construirManifiesto({ version, notas, base, rutaSig }) {
  const firma = readFileSync(rutaSig, "utf8").trim();
  if (!firma) fallar(`El .sig está vacío: ${rutaSig}`);
  if (firma.includes("\\") || existsSync(firma)) {
    fallar("El .sig parece contener una ruta en vez de la firma. Revisá la compilación.");
  }
  const { exe } = nombresDeArtefactos(version);
  return {
    version,
    notes: notas,
    pub_date: fechaUtc(),
    platforms: {
      // El canal de actualización es el NSIS: instala en modo currentUser, así que
      // actualizar no dispara UAC. El MSI se publica solo para la instalación inicial.
      "windows-x86_64": { signature: firma, url: `${base}/${version}/${exe}` },
    },
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
async function verificarInstalador(url, sha256Local) {
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
  ok(`el .exe del bucket coincide con el firmado (sha256 ${remoto.slice(0, 16)}…)`);
}

// ── Programa ──────────────────────────────────────────────────────────────────

async function principal() {
  const opciones = leerArgumentos(process.argv.slice(2));
  if (opciones.ayuda) {
    console.log(AYUDA);
    return;
  }

  console.log(`\n=== Publicar Mycelium ${opciones.simulacro ? "(SIMULACRO: no se sube nada)" : ""} ===`);

  // ── 1. Comprobaciones previas, antes de compilar nada ──
  paso("Comprobaciones previas");
  const version = comprobarVersion();
  ok(`versión ${version}, coherente en los cinco archivos`);
  comprobarClavesDeFirma();
  const { base } = comprobarConfiguracionDelUpdater();
  ok(`clave pública configurada; base derivada del endpoint: ${base}`);
  const wrangler = comprobarWrangler();
  detalle(`bucket: ${BUCKET}`);
  await comprobarQueNoEstaPublicada(base, version, opciones.forzar);
  const notas = leerNotas(version, opciones.notas);
  ok(`changelog leído de ${notas.origen.replace(RAIZ_REPO, "").replace(/^[\\/]/, "")} (${notas.texto.length} caracteres)`);
  hechos.push("comprobaciones previas");

  // ── 2. Compilar ──
  paso(opciones.sinCompilar ? "Compilar (omitido por --sin-compilar)" : "Compilar");
  if (opciones.sinCompilar) aviso("se reutilizan instaladores ya existentes");
  else {
    compilar();
    hechos.push("compilación");
  }
  const artefactos = localizarArtefactos(version, opciones);
  const shaExe = sha256(artefactos.exe);
  detalle(`sha256 del .exe firmado: ${shaExe}`);

  // ── 6 (adelantado). Preservar ──
  // Se hace antes de subir para tener los artefactos y los manifiestos a salvo aunque
  // la subida falle: `target/` se borra con cualquier `cargo clean`.
  paso("Preservar los instaladores en installers/");
  const destino = join(RAIZ_REPO, "installers", `v${version}`);
  mkdirSync(destino, { recursive: true });
  for (const ruta of [artefactos.exe, artefactos.sig, artefactos.msi]) {
    const copia = join(destino, basename(ruta));
    if (resolve(copia) === resolve(ruta)) continue; // ya venían de acá (--sin-compilar)
    copyFileSync(ruta, copia);
  }
  ok(`instaladores en installers/v${version}/ (fuera de git)`);
  hechos.push(`instaladores preservados en installers/v${version}/`);

  // ── 3-4. Manifiestos ──
  paso("Escribir los manifiestos");
  const manifiesto = construirManifiesto({ version, notas: notas.texto, base, rutaSig: artefactos.sig });
  const rutaLatest = join(destino, "latest.json");
  escribirJsonSinBom(rutaLatest, manifiesto);
  ok(`latest.json escrito (UTF-8 sin BOM, primer byte 0x7B) en installers/v${version}/`);
  detalle(`url del instalador: ${manifiesto.platforms["windows-x86_64"].url}`);

  const indice = await construirIndiceDeVersiones({ base, manifiesto });
  const rutaVersiones = join(destino, "versions.json");
  escribirJsonSinBom(rutaVersiones, indice);
  ok(`versions.json escrito con ${indice.versions.length} versión/es (la nueva arriba)`);
  hechos.push(`manifiestos escritos en installers/v${version}/`);

  // ── 3-4. Subir ──
  paso(opciones.simulacro ? "Subir al bucket (SIMULACRO: solo se imprimen los comandos)" : "Subir al bucket");
  const { exe, sig, msi } = nombresDeArtefactos(version);
  // Orden deliberado: primero los archivos, después el manifiesto de la versión, el
  // índice, y el latest.json de la raíz AL FINAL. Es el que dispara la actualización
  // de todo el mundo: no debe anunciar nada que todavía no esté completo en el bucket.
  const subidas = [
    { clave: `${version}/${exe}`, archivo: artefactos.exe },
    { clave: `${version}/${sig}`, archivo: artefactos.sig },
    { clave: `${version}/${msi}`, archivo: artefactos.msi },
    { clave: `${version}/latest.json`, archivo: rutaLatest, contentType: "application/json" },
    { clave: "versions.json", archivo: rutaVersiones, contentType: "application/json" },
    { clave: "latest.json", archivo: rutaLatest, contentType: "application/json" },
  ];
  for (const s of subidas) {
    subir(wrangler, { ...s, simulacro: opciones.simulacro });
    if (!opciones.simulacro) hechos.push(`subido ${s.clave}`);
  }

  // ── 5. Verificar lo publicado ──
  paso("Verificar lo publicado");
  if (opciones.simulacro) {
    aviso("no se subió nada, así que se verifica lo local en vez de lo remoto");
    const local = leerJson(rutaLatest);
    if (local.platforms["windows-x86_64"].signature !== readFileSync(artefactos.sig, "utf8").trim()) {
      fallar("La firma del manifiesto no coincide con el .sig. Es el fallo más común del proceso manual.");
    }
    ok("la firma del manifiesto es idéntica al .sig generado");
    ok(`versions.json local contiene ${leerJson(rutaVersiones).versions.map((v) => v.version).join(", ")}`);
    detalle("para verificar de verdad hace falta publicar: repetí sin --simulacro");
  } else {
    const firmaLocal = readFileSync(artefactos.sig, "utf8").trim();
    const comprobarManifiesto = (json) => {
      if (json.version !== version) fallar(`el manifiesto publicado anuncia la ${json.version}, no la ${version}`);
      if (json.platforms?.["windows-x86_64"]?.signature !== firmaLocal) {
        fallar("la firma del manifiesto publicado NO es la del .sig generado: nadie podría actualizar");
      }
    };
    await verificarJson(`${base}/latest.json`, comprobarManifiesto);
    await verificarJson(`${base}/${version}/latest.json`, comprobarManifiesto);
    await verificarJson(`${base}/versions.json`, (json) => {
      if (!json.versions?.some((v) => v.version === version)) {
        fallar(`versions.json publicado no incluye la ${version}`);
      }
    });
    ok("la firma de los dos manifiestos es idéntica al .sig generado");
    await verificarInstalador(`${base}/${version}/${exe}`, shaExe);
  }

  console.log(
    opciones.simulacro
      ? `\nSimulacro completo. No se subió nada. Lo que se habría publicado quedó en installers/v${version}/.`
      : `\nPublicada la ${version}. Los usuarios con 1.4.0 o posterior la verán en su próxima comprobación diaria.`,
  );
}

principal().catch((e) => {
  console.error(`\nFALLO: ${e instanceof ErrorDePublicacion ? e.message : e.stack}`);
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
