// Subir la versión de Mycelium en los cinco sitios donde vive, de una vez.
//
//   npm run versionar -- 1.5.1
//   npm run versionar -- 1.5.1 --simulacro    muestra qué cambiaría, sin tocar nada
//
// Por qué existe: la versión está repartida en cinco archivos con cinco formatos
// distintos (ver [[Versionado del sistema]]), y hacerlo a mano es el paso con más
// superficie de error de todo el proceso de publicar. Si uno se olvida, el
// instalador y el manifiesto anuncian números distintos y la actualización entra
// en bucle: la app se actualiza y sigue viendo que hay algo nuevo.
//
// `npm run publicar` COMPRUEBA que los cinco coincidan; esto es lo que los pone.
//
// NO se llama `version` a propósito: ese nombre es un lifecycle script de npm
// (lo ejecuta `npm version`) y la colisión daría sorpresas.
//
// Node >= 18. Sin dependencias.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ_FRONTEND = resolve(fileURLToPath(new URL("..", import.meta.url)));
const RAIZ_REPO = resolve(RAIZ_FRONTEND, "..");

const ok = (t) => console.log(`      ok   ${t}`);
const aviso = (t) => console.log(`      !    ${t}`);
const detalle = (t) => console.log(`           ${t}`);

class ErrorDeVersion extends Error {}
const fallar = (m) => {
  throw new ErrorDeVersion(m);
};

/**
 * Los cinco sitios, cada uno con el patrón que aísla SU número.
 *
 * Se hace con reemplazo dirigido y no releyendo/reescribiendo el archivo entero
 * (p. ej. con `JSON.stringify`) por dos motivos: reformatearía el archivo
 * completo, y los `.md`/`.toml` del repo están en CRLF — un round-trip los
 * convertiría a LF y ensuciaría el diff con cientos de líneas falsas.
 *
 * `patron` recibe la versión ACTUAL: al anclar en ella, si el archivo ya no la
 * tiene el reemplazo no ocurre y se detecta, en vez de escribir a ciegas.
 */
const ARCHIVOS = [
  {
    ruta: join(RAIZ_FRONTEND, "lib/version.ts"),
    nombre: "lib/version.ts",
    leer: (t) => t.match(/APP_VERSION\s*=\s*"([^"]+)"/)?.[1],
    patron: (v) => new RegExp(`(APP_VERSION\\s*=\\s*)"${escapar(v)}"`),
  },
  {
    ruta: join(RAIZ_FRONTEND, "package.json"),
    nombre: "package.json",
    leer: (t) => JSON.parse(t).version,
    patron: (v) => new RegExp(`("version"\\s*:\\s*)"${escapar(v)}"`),
  },
  {
    ruta: join(RAIZ_FRONTEND, "src-tauri/tauri.conf.json"),
    nombre: "src-tauri/tauri.conf.json",
    leer: (t) => JSON.parse(t).version,
    patron: (v) => new RegExp(`("version"\\s*:\\s*)"${escapar(v)}"`),
  },
  {
    ruta: join(RAIZ_FRONTEND, "src-tauri/Cargo.toml"),
    nombre: "src-tauri/Cargo.toml",
    leer: (t) => t.match(/\[package\][\s\S]*?\nversion\s*=\s*"([^"]+)"/)?.[1],
    // Ancla en [package] para no tocar la versión de una dependencia.
    patron: (v) => new RegExp(`(\\[package\\][\\s\\S]*?\\nversion\\s*=\\s*)"${escapar(v)}"`),
  },
  {
    ruta: join(RAIZ_FRONTEND, "src-tauri/Cargo.lock"),
    nombre: "src-tauri/Cargo.lock",
    leer: (t) => t.match(/name\s*=\s*"app"\s*\r?\nversion\s*=\s*"([^"]+)"/)?.[1],
    // Ancla en el paquete `app`: el lock tiene cientos de versiones más.
    patron: (v) => new RegExp(`(name\\s*=\\s*"app"\\s*\\r?\\nversion\\s*=\\s*)"${escapar(v)}"`),
  },
];

const escapar = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function leerActuales() {
  const fuentes = ARCHIVOS.map((a) => {
    if (!existsSync(a.ruta)) fallar(`No existe ${a.nombre}.`);
    return { ...a, version: a.leer(readFileSync(a.ruta, "utf8")) };
  });
  const sinLeer = fuentes.filter((f) => !f.version);
  if (sinLeer.length) {
    fallar(`No pude leer la versión de: ${sinLeer.map((f) => f.nombre).join(", ")}.`);
  }
  return fuentes;
}

function comparar(a, b) {
  const [x, y] = [a, b].map((v) => v.split(".").map(Number));
  for (let i = 0; i < 3; i++) {
    if (x[i] !== y[i]) return x[i] - y[i];
  }
  return 0;
}

/** Esqueleto de la nota de release, con los delimitadores que `publicar` exige. */
function plantillaNota(version, anterior) {
  const hoy = new Date().toISOString().slice(0, 10);
  return `# Versión ${version}

**Solo desktop** (\`desktop-tauri\`) · ${hoy} · sobre [[Version ${anterior}]]

<!-- Un párrafo: cuál es el tema de esta versión y qué IDs entran. -->

## Por qué sube este dígito

<!-- ¿El usuario puede hacer algo que antes no podía? Ver [[Versionado del sistema]]. -->

<!-- notas-release:inicio -->
## <!-- título de cara al usuario -->

<!-- Lo que sigue es lo ÚNICO que ve el usuario en el diálogo de actualización.
     Escribilo para alguien que solo quiere decidir si actualiza: qué gana, en
     viñetas cortas. Nada de nombres de archivo ni de IDs internos.
     NO menciones el modo avanzado (FUN-M-16): es deliberadamente oculto y
     \`npm run publicar\` rechaza el changelog si aparece. -->
<!-- notas-release:fin -->

## Cómo comprobarlo en la app

<!-- Pasos concretos para que el usuario lo verifique. -->

## Relacionadas

- [[Version ${anterior}]] — la versión anterior.
- [[Versionado del sistema]] — el criterio del número.
- [[BACKLOG]] — el inventario.
- [[Mapa de documentacion]] — índice general.
`;
}

function ayuda() {
  console.log(`Subir la versión de Mycelium en los cinco archivos donde vive.

  npm run versionar -- <X.Y.Z> [opciones]

Opciones:
  --simulacro, -s   Muestra qué cambiaría, sin escribir nada.
  --forzar          Permite bajar de versión o repetir la actual.
  --ayuda, -h       Esto.

Qué toca:
  lib/version.ts · package.json · src-tauri/tauri.conf.json
  src-tauri/Cargo.toml · src-tauri/Cargo.lock

Además crea el esqueleto de docs/estado/Version <X.Y.Z>.md con los delimitadores
del changelog, si no existe todavía.

NO decide el número por vos: el criterio (patch / minor / major) está en
[[Versionado del sistema]] y depende de si el usuario puede hacer algo que antes
no podía.`);
}

function principal(argv) {
  const args = argv.slice(2);
  if (args.includes("--ayuda") || args.includes("-h")) return ayuda(), 0;

  const simulacro = args.includes("--simulacro") || args.includes("-s");
  const forzar = args.includes("--forzar");
  const nueva = args.find((a) => !a.startsWith("-"));

  if (!nueva) fallar("Falta la versión. Ejemplo: npm run versionar -- 1.5.1");
  if (!/^\d+\.\d+\.\d+$/.test(nueva)) fallar(`"${nueva}" no tiene la forma X.Y.Z.`);

  console.log(`\n=== Versionar Mycelium${simulacro ? " (SIMULACRO: no se escribe nada)" : ""} ===\n`);

  const fuentes = leerActuales();
  const distintas = [...new Set(fuentes.map((f) => f.version))];
  if (distintas.length > 1) {
    const lista = fuentes.map((f) => `             ${f.version}  ${f.nombre}`).join("\n");
    aviso("la versión NO coincide hoy en los cinco archivos:");
    console.log(lista);
    detalle("se van a poner todos en la nueva, que es justo para lo que sirve esto");
  }

  const actual = distintas[0];
  ok(`versión actual: ${distintas.length > 1 ? distintas.join(" / ") : actual}`);

  const orden = comparar(nueva, actual);
  if (orden === 0 && !forzar) fallar(`Ya está en ${nueva}. Usá --forzar si querés reescribirla.`);
  if (orden < 0 && !forzar) {
    fallar(`${nueva} es ANTERIOR a ${actual}. Un número ya publicado identifica lo que salió con él (ver [[Versionado del sistema]]). Usá --forzar si es a propósito.`);
  }
  if (orden <= 0) aviso(`se va de ${actual} a ${nueva} (--forzar)`);

  // ── Escribir ────────────────────────────────────────────────────────────────
  const cambios = [];
  for (const f of fuentes) {
    const texto = readFileSync(f.ruta, "utf8");
    const patron = f.patron(f.version);
    const coincidencias = texto.match(new RegExp(patron.source, "g"))?.length ?? 0;
    if (coincidencias !== 1) {
      fallar(`En ${f.nombre} el patrón de la versión aparece ${coincidencias} veces, y tiene que aparecer exactamente 1. No toco nada: revisalo a mano.`);
    }
    cambios.push({ ...f, texto: texto.replace(patron, `$1"${nueva}"`) });
  }

  for (const c of cambios) {
    if (!simulacro) writeFileSync(c.ruta, c.texto);
    ok(`${c.nombre}: ${c.version} → ${nueva}`);
  }

  // ── Comprobar releyendo, no confiando en lo que acabamos de escribir ─────────
  if (!simulacro) {
    const despues = leerActuales();
    const malas = despues.filter((f) => f.version !== nueva);
    if (malas.length) {
      fallar(`Se escribió, pero al releer NO quedaron en ${nueva}: ${malas.map((f) => `${f.nombre} (${f.version})`).join(", ")}.`);
    }
    ok(`releídos los cinco archivos: todos en ${nueva}`);
  }

  // ── Esqueleto de la nota de release ─────────────────────────────────────────
  const nota = join(RAIZ_REPO, "docs", "estado", `Version ${nueva}.md`);
  if (existsSync(nota)) {
    ok(`la nota docs/estado/Version ${nueva}.md ya existe, no se toca`);
  } else if (simulacro) {
    detalle(`[simulacro] se crearía docs/estado/Version ${nueva}.md`);
  } else {
    writeFileSync(nota, plantillaNota(nueva, actual));
    ok(`creada docs/estado/Version ${nueva}.md con los delimitadores del changelog`);
  }

  console.log(`\n${simulacro ? "Simulacro completo. No se escribió nada." : `Versión ${nueva} puesta en los cinco archivos.`}`);
  if (!simulacro) {
    console.log(`
Falta, en este orden:
  1. Escribir docs/estado/Version ${nueva}.md — sobre todo lo que va entre los
     delimitadores, que es lo único que ve el usuario al actualizar.
  2. Añadir la entrada de ${nueva} al comentario de historial de lib/version.ts.
  3. Commitear.
  4. npm run publicar`);
  }
  return 0;
}

try {
  process.exit(principal(process.argv));
} catch (e) {
  if (e instanceof ErrorDeVersion) {
    console.error(`\nFALLO: ${e.message}\n`);
    console.error("No se escribió nada.\n");
    process.exit(1);
  }
  throw e;
}
