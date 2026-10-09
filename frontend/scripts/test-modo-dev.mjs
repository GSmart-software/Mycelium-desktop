// Test del modo desarrollador (`FUN-S-36`): la lógica pura de `lib/modoDev.ts`
// —reconocer el comando oculto `>dev` y filtrar los comandos `soloDev`— y la
// defensa de que el comando siga oculto: ninguna página de la ayuda lo nombra.
//
// Mismo arnés que `scripts/test-estados-tarea.mjs`: el módulo se transpila a
// una carpeta temporal DENTRO de `frontend/`.
//
//   node --test scripts/test-modo-dev.mjs
import assert from "node:assert/strict";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { after, test } from "node:test";
import ts from "typescript";
import { SECRETO_DEV, buscarSecretoDev } from "./secreto-dev.mjs";

const AQUI = dirname(fileURLToPath(import.meta.url));
const FRONTEND = join(AQUI, "..");
const TMP = join(FRONTEND, ".tmp-test-modo-dev");

await rm(TMP, { recursive: true, force: true });
await mkdir(TMP, { recursive: true });
const fuente = await readFile(join(FRONTEND, "lib/modoDev.ts"), "utf8");
const { outputText } = ts.transpileModule(fuente, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
});
await writeFile(join(TMP, "modoDev.mjs"), outputText);
const { esConsultaDev, comandosDisponibles, avisoModoDev } = await import(
  pathToFileURL(join(TMP, "modoDev.mjs")).href
);

after(() => rm(TMP, { recursive: true, force: true }));

test("`>dev` activa, sin importar mayúsculas ni espacios alrededor", () => {
  for (const t of [">dev", ">DEV", ">Dev", "> dev", ">dev ", ">  dEv  ", ">\tdev"]) {
    assert.equal(esConsultaDev(t), true, JSON.stringify(t));
  }
});

test("lo que no es exactamente `>dev` no activa", () => {
  for (const t of [">de", ">d", ">", ">devx", ">dev x", ">d ev", ">>dev", ">devtools", ">ddev"]) {
    assert.equal(esConsultaDev(t), false, JSON.stringify(t));
  }
});

test("`dev` sin «>» (modo notas, Ctrl+O) no activa: una nota «dev» se abre normal", () => {
  for (const t of ["dev", "DEV", " dev", "dev>", " >dev", ""]) {
    assert.equal(esConsultaDev(t), false, JSON.stringify(t));
  }
});

test("sin el modo, los comandos `soloDev` no existen; con él, están todos", () => {
  const comandos = [
    { id: "a" },
    { id: "b", soloDev: true },
    { id: "c", soloDev: false },
    { id: "d", soloDev: true },
  ];
  assert.deepEqual(comandosDisponibles(comandos, false).map((c) => c.id), ["a", "c"]);
  assert.deepEqual(comandosDisponibles(comandos, true).map((c) => c.id), ["a", "b", "c", "d"]);
  // No muta la lista de entrada.
  assert.equal(comandos.length, 4);
});

test("el aviso dice el estado nuevo", () => {
  assert.equal(avisoModoDev(true), "Modo desarrollador activado");
  assert.equal(avisoModoDev(false), "Modo desarrollador desactivado");
});

test("la paleta declara sus comandos de desarrollador con `soloDev: true`", async () => {
  const paleta = await readFile(join(FRONTEND, "components/workspace/PaletaComandos.tsx"), "utf8");
  for (const titulo of ["Desactivar el modo desarrollador", "Abrir las herramientas de desarrollador"]) {
    const i = paleta.indexOf(`titulo: "${titulo}"`);
    assert.ok(i >= 0, `falta el comando «${titulo}»`);
    const bloque = paleta.slice(i, paleta.indexOf("},", i));
    assert.match(bloque, /soloDev: true/, `«${titulo}» tiene que ser soloDev`);
  }
});

test("la ayuda no revela el modo ni nada de lo que habilita", async () => {
  const recorrer = async (dir) => {
    for (const e of await readdir(dir, { withFileTypes: true })) {
      const ruta = join(dir, e.name);
      if (e.isDirectory()) await recorrer(ruta);
      else if (e.name.endsWith(".md")) {
        const texto = await readFile(ruta, "utf8");
        const secreto = buscarSecretoDev(texto);
        assert.equal(secreto, null, `${ruta} menciona ${secreto?.que} (${secreto?.patron})`);
      }
    }
  };
  await recorrer(join(FRONTEND, "ayuda"));
});

test("la lista de lo secreto del modo dev atrapa lo que habilita y deja pasar F12", () => {
  for (const texto of [
    "Escribí >dev en la paleta",
    "Nuevo: modo desarrollador",
    "el modo dev ahora…",
    "Mycelium v2.5.0 · dev",
    "Elegí cualquier versión en «Versiones publicadas».",
    "Configurá tu propio servidor de actualizaciones",
    "Nuevos comandos de desarrollador en la paleta",
    "Cierra FUN-S-36",
  ]) {
    assert.notEqual(buscarSecretoDev(texto), null, `debería atrapar: ${texto}`);
  }
  for (const texto of [
    "F12 abre las herramientas de desarrollador, útiles para escribir CSS propio.",
    "Buscá notas por propiedades y desarrollá tus ideas.",
    "Las actualizaciones se descargan solas.",
    "Developer notes",
  ]) {
    assert.equal(buscarSecretoDev(texto), null, `no debería atrapar: ${texto}`);
  }
  assert.ok(SECRETO_DEV.length > 0);
});
