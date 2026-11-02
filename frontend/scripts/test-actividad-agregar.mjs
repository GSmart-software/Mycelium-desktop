// El registro de actividad de la IA agrega un renglón por operación (`FUN-M-58`).
//
// Antes `stores/actividadIaStore.ts` reescribía `.mycelium/actividad.jsonl`
// entero —ya recortado a 500— en cada operación registrada. Ahora agrega el
// renglón (`agregar_estado_vault`) y lo reescribe recortado una vez cada
// `MARGEN_COMPACTAR`. Este test corre el store real contra un disco de mentira
// que imita los dos comandos de Rust, y comprueba que lo que se lee al volver a
// abrir el vault es exactamente lo que había en memoria (las mismas 500, con
// sus «deshacer»), y cuántos bytes cruzan el puente antes y después.
//
//   node --test scripts/test-actividad-agregar.mjs
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { test } from "node:test";
import ts from "typescript";

const aUrl = (codigo) => `data:text/javascript,${encodeURIComponent(codigo)}`;

async function fuente(ruta, mapa = {}) {
  const texto = await readFile(fileURLToPath(new URL(ruta, import.meta.url)), "utf8");
  let { outputText } = ts.transpileModule(texto, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  });
  for (const [especificador, url] of Object.entries(mapa)) {
    outputText = outputText.split(`"${especificador}"`).join(`"${url}"`);
  }
  return aUrl(outputText);
}

// ── El disco: `.mycelium/actividad.jsonl` por vault, con los comandos de Rust ──
const D = (globalThis.__disco = { archivos: new Map(), bytes: 0, escrituras: 0, agregados: 0 });
const CORE = aUrl(`export async function invoke(cmd, a) {
  const D = globalThis.__disco;
  if (a.nombre !== "actividad.jsonl") throw new Error("nombre: " + a.nombre);
  if (cmd === "leer_estado_vault") return D.archivos.get(a.ruta) ?? null;
  if (cmd === "escribir_estado_vault") {
    D.escrituras++; D.bytes += a.contenido.length; D.archivos.set(a.ruta, a.contenido); return;
  }
  if (cmd === "agregar_estado_vault") {
    D.agregados++; D.bytes += a.contenido.length;
    const previo = D.archivos.get(a.ruta) ?? "";
    const salto = previo.length > 0 && !previo.endsWith("\\n") ? "\\n" : "";
    D.archivos.set(a.ruta, previo + salto + a.contenido); return;
  }
  throw new Error("comando: " + cmd);
}`);

const requerir = createRequire(import.meta.url);
const zustandDir = requerir.resolve("zustand/package.json").replace(/package\.json$/, "");
const ZUSTAND = pathToFileURL(`${zustandDir}esm/vanilla.mjs`).href;
const ZUSTAND_CREATE = aUrl(`import { createStore } from "${ZUSTAND}"; export const create = (f) => createStore(f);`);

const ACT = await fuente("../lib/actividadIa.ts");
const act = await import(ACT);
const { useActividadIaStore: store } = await import(
  await fuente("../stores/actividadIaStore.ts", {
    zustand: ZUSTAND_CREATE,
    "@/lib/actividadIa": ACT,
    "@tauri-apps/api/core": CORE,
  }),
);

/** Espera a que la cola de escrituras del store se vacíe. */
const vaciar = () => new Promise((r) => setTimeout(r, 0));

/** Una operación como las del MCP: ~600 bytes, como las del registro real. */
function operar(i) {
  return store.getState().registrar({
    op: "renombrar",
    resultado: "hecho",
    efecto: `Renombré «Nota ${i}» a «Nota ${i} bis» y reescribí los enlaces en 3 notas: ${"x".repeat(300)}`,
    objetivo: { tipo: "nota", ruta: `Carpeta/Nota ${i} bis.md` },
    deshacer: { tipo: "archivo_renombrar", clase: "nota", ruta: `Carpeta/Nota ${i} bis.md`, rutaAntes: `Carpeta/Nota ${i}.md`, nombre: `Nota ${i}` },
  });
}

async function reabrir(ruta) {
  await store.getState().cargar(null);
  await store.getState().cargar(ruta);
  return store.getState().entradas;
}

test("lo que se lee al reabrir es lo que había en memoria, en cada momento", async () => {
  const ruta = "C:/vault-a";
  await store.getState().cargar(ruta);
  for (let i = 0; i < 1234; i++) {
    const e = operar(i);
    // Un deshacer de vez en cuando: el panel cruza `ref` con la original.
    if (i % 7 === 0) store.getState().registrar({ op: "deshacer", resultado: "hecho", efecto: "Deshecho.", ref: e.id });
    if (i % 97 === 0 || i === 1233) {
      await vaciar();
      const enMemoria = store.getState().entradas;
      assert.ok(enMemoria.length <= act.TOPE_ENTRADAS);
      const texto = D.archivos.get(ruta);
      assert.ok(act.renglonesEnDisco(texto) <= act.TOPE_ENTRADAS + act.MARGEN_COMPACTAR, "el archivo no crece sin tope");
      const releidas = await reabrir(ruta);
      assert.deepEqual(releidas, enMemoria);
      assert.deepEqual(act.vistaActividad(releidas), act.vistaActividad(enMemoria));
    }
  }
  assert.equal(store.getState().entradas.length, act.TOPE_ENTRADAS);
});

test("un renglón a medias (cierre a mitad de escritura) se pierde solo él", async () => {
  const ruta = "C:/vault-b";
  await store.getState().cargar(ruta);
  operar(1);
  operar(2);
  await vaciar();
  D.archivos.set(ruta, D.archivos.get(ruta) + '{"v":1,"id":"cort');
  await reabrir(ruta);
  operar(3);
  await vaciar();
  const releidas = await reabrir(ruta);
  assert.deepEqual(releidas.map((e) => e.objetivo.ruta), ["Carpeta/Nota 1 bis.md", "Carpeta/Nota 2 bis.md", "Carpeta/Nota 3 bis.md"]);
});

test("lo registrado mientras se leía el archivo llega al disco", async () => {
  const ruta = "C:/vault-c";
  D.archivos.set(ruta, act.serializar([act.nuevaEntrada({ op: "abrir", resultado: "hecho", efecto: "previa" })]));
  await store.getState().cargar(null);
  const cargando = store.getState().cargar(ruta);
  operar(9);
  await cargando;
  await vaciar();
  const releidas = await reabrir(ruta);
  assert.deepEqual(releidas.map((e) => e.efecto.slice(0, 6)), ["previa", "Renomb"]);
});

test("cifra: bytes al disco por operación con el registro lleno, antes y después", async () => {
  const ruta = "C:/vault-d";
  await store.getState().cargar(ruta);
  for (let i = 0; i < act.TOPE_ENTRADAS; i++) operar(i);
  await vaciar();
  // Antes: cada operación reescribía las 500 serializadas.
  const antes = act.serializar(store.getState().entradas).length;
  D.bytes = 0;
  D.escrituras = 0;
  D.agregados = 0;
  const N = 1000;
  for (let i = 0; i < N; i++) operar(i);
  await vaciar();
  const despues = D.bytes / N;
  console.log(
    `# registro lleno: antes ${antes} B por operación; después ${despues.toFixed(0)} B de media ` +
      `(${D.agregados} agregados, ${D.escrituras} reescrituras en ${N} operaciones)`,
  );
  assert.ok(despues < antes / 50);
  // Una reescritura cada `MARGEN_COMPACTAR + 1` operaciones (100 agregados y la que recorta).
  assert.equal(D.escrituras, Math.floor(N / (act.MARGEN_COMPACTAR + 1)));
});
