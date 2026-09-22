// Test headless (sin navegador ni Tauri) del almacén de consolas
// (`stores/terminalStore.ts`), que con `DEF-099`/`DEF-100` pasó a ser **por
// vault**: una clave de `localStorage` por carpeta abierta, y las preferencias
// —que son del usuario— en la suya.
//
// El store no es un módulo puro: usa zustand y `localStorage`. Así que se
// transpila igual que en los otros tests, pero además se le **reescriben los
// imports** de zustand a la ruta real de su build ESM (un `data:` URL no puede
// resolver especificadores desnudos) y se le monta un `localStorage` de mentira
// antes de cargarlo.
//
//   node --test scripts/test-consolas.mjs
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { test } from "node:test";
import ts from "typescript";

const RUTA_STORE = new URL("../stores/terminalStore.ts", import.meta.url);
const ESM = (archivo) =>
  pathToFileURL(fileURLToPath(new URL(`../node_modules/zustand/esm/${archivo}`, import.meta.url)))
    .href;

const fuente = await readFile(fileURLToPath(RUTA_STORE), "utf8");
let cargas = 0;

/** Un almacén de mentira con la misma superficie que `localStorage`. */
function almacenFalso(inicial = {}) {
  const datos = new Map(Object.entries(inicial));
  return {
    getItem: (k) => (datos.has(k) ? datos.get(k) : null),
    setItem: (k, v) => void datos.set(k, String(v)),
    removeItem: (k) => void datos.delete(k),
    clear: () => datos.clear(),
    claves: () => [...datos.keys()].sort(),
    crudo: datos,
  };
}

/**
 * Carga una instancia NUEVA del store sobre el almacén dado.
 *
 * Cada carga es un módulo distinto —el `data:` URL lleva un comentario único—,
 * y eso es lo que permite probar lo que pasa **al arrancar**: la migración de
 * las preferencias corre una sola vez, al crearse el store.
 */
async function cargarStore(almacen) {
  globalThis.localStorage = almacen;
  globalThis.window = { localStorage: almacen };
  const { outputText } = ts.transpileModule(fuente, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 },
  });
  const js =
    `// carga ${++cargas}\n` +
    outputText
      .replace(/from ["']zustand["']/g, `from "${ESM("index.mjs")}"`)
      .replace(/from ["']zustand\/middleware["']/g, `from "${ESM("middleware.mjs")}"`);
  const mod = await import(`data:text/javascript,${encodeURIComponent(js)}`);
  return mod.useTerminalStore;
}

const sesion = (titulo) => ({ shellId: null, cwd: null, titulo });

test("las consolas se guardan en la clave del vault, no en una global", async () => {
  const almacen = almacenFalso();
  const store = await cargarStore(almacen);

  await store.getState().usarAlmacenDeVault("C:/vaults/Trabajo");
  store.getState().registrar("t1", { shellId: null, cwd: null });

  assert.deepEqual(almacen.claves(), ["mic-consolas:C:/vaults/Trabajo"]);
  const guardado = JSON.parse(almacen.getItem("mic-consolas:C:/vaults/Trabajo"));
  assert.deepEqual(Object.keys(guardado.state.sesiones), ["t1"]);
});

test("cambiar de vault deja la lista vacía y NO pisa la del anterior", async () => {
  const almacen = almacenFalso();
  const store = await cargarStore(almacen);

  await store.getState().usarAlmacenDeVault("/vaults/A");
  store.getState().registrar("a1", { shellId: null, cwd: "/vaults/A" });

  await store.getState().usarAlmacenDeVault("/vaults/B");
  assert.deepEqual(
    store.getState().sesiones,
    {},
    "el vault nuevo arranca sin consolas: era el sintoma del DEF-099",
  );

  const deA = JSON.parse(almacen.getItem("mic-consolas:/vaults/A"));
  assert.deepEqual(
    Object.keys(deA.state.sesiones),
    ["a1"],
    "vaciar antes de reapuntar habria borrado las consolas del vault que se deja",
  );
});

test("volver al vault restaura sus consolas, con su cwd", async () => {
  const almacen = almacenFalso();
  const store = await cargarStore(almacen);

  await store.getState().usarAlmacenDeVault("/vaults/A");
  store.getState().registrar("a1", { shellId: "pwsh", cwd: "/vaults/A/notas" });
  store.getState().guardarScrollback("a1", "> hola");

  await store.getState().usarAlmacenDeVault("/vaults/B");
  store.getState().registrar("b1", { shellId: null, cwd: null });
  await store.getState().usarAlmacenDeVault("/vaults/A");

  const { sesiones } = store.getState();
  assert.deepEqual(Object.keys(sesiones), ["a1"]);
  assert.equal(sesiones.a1.cwd, "/vaults/A/notas");
  assert.equal(sesiones.a1.scrollback, "> hola");
});

test("dos ventanas con vaults distintos no comparten la lista (DEF-100)", async () => {
  // Las dos ventanas son dos webviews del mismo origen: **el mismo**
  // `localStorage`. Lo que las separa es la clave, y no pueden colisionar
  // porque un vault solo se abre en una ventana (`FUN-L-16`).
  const almacen = almacenFalso();
  const ventanaA = await cargarStore(almacen);
  const ventanaB = await cargarStore(almacen);

  await ventanaA.getState().usarAlmacenDeVault("/vaults/A");
  ventanaA.getState().registrar("a1", { shellId: null, cwd: null });
  await ventanaB.getState().usarAlmacenDeVault("/vaults/B");
  ventanaB.getState().registrar("b1", { shellId: null, cwd: null });

  assert.deepEqual(Object.keys(ventanaA.getState().sesiones), ["a1"]);
  assert.deepEqual(Object.keys(ventanaB.getState().sesiones), ["b1"]);
  assert.deepEqual(almacen.claves(), ["mic-consolas:/vaults/A", "mic-consolas:/vaults/B"]);
});

test("la numeración de las consolas es por vault", async () => {
  const almacen = almacenFalso();
  const store = await cargarStore(almacen);

  await store.getState().usarAlmacenDeVault("/vaults/A");
  assert.equal(store.getState().registrar("a1", { shellId: null, cwd: null }), "Terminal 1");
  assert.equal(store.getState().registrar("a2", { shellId: null, cwd: null }), "Terminal 2");

  await store.getState().usarAlmacenDeVault("/vaults/B");
  assert.equal(
    store.getState().registrar("b1", { shellId: null, cwd: null }),
    "Terminal 1",
    "un vault sin consolas empieza por 1, aunque otro tenga dos abiertas",
  );
});

test("las preferencias son del usuario: sobreviven al cambio de vault", async () => {
  const almacen = almacenFalso();
  const store = await cargarStore(almacen);

  await store.getState().usarAlmacenDeVault("/vaults/A");
  store.getState().setPref("shellPorDefecto", "git-bash");
  store.getState().setPref("restaurarScrollback", false);

  await store.getState().usarAlmacenDeVault("/vaults/B");
  assert.equal(store.getState().prefs.shellPorDefecto, "git-bash");
  assert.equal(store.getState().prefs.restaurarScrollback, false);

  assert.deepEqual(
    JSON.parse(almacen.getItem("mic-consolas:/vaults/B")).state,
    { sesiones: {} },
    "el vault nuevo escribe su propia clave, vacia, sin arrastrar nada del anterior",
  );
  assert.deepEqual(
    JSON.parse(almacen.getItem("mic-consolas-prefs")),
    { shellPorDefecto: "git-bash", restaurarSesiones: true, restaurarScrollback: false },
    "las preferencias viven en su propia clave, fuera de la del vault",
  );
});

test("las preferencias no viajan dentro de la clave del vault", async () => {
  const almacen = almacenFalso();
  const store = await cargarStore(almacen);

  await store.getState().usarAlmacenDeVault("/vaults/A");
  store.getState().setPref("shellPorDefecto", "pwsh");
  store.getState().registrar("a1", { shellId: null, cwd: null });

  const guardado = JSON.parse(almacen.getItem("mic-consolas:/vaults/A"));
  assert.deepEqual(Object.keys(guardado.state), ["sesiones"]);
});

test("al arrancar se migran las preferencias de la clave heredada", async () => {
  const almacen = almacenFalso({
    "mic-terminales": JSON.stringify({
      version: 2,
      state: {
        sesiones: { viejo: sesion("Terminal 1") },
        prefs: { shellPorDefecto: "wsl", restaurarSesiones: false, restaurarScrollback: true },
      },
    }),
  });
  const store = await cargarStore(almacen);

  assert.equal(store.getState().prefs.shellPorDefecto, "wsl");
  assert.equal(store.getState().prefs.restaurarSesiones, false);
  assert.equal(
    almacen.getItem("mic-terminales"),
    null,
    "la clave heredada se descarta: sus sesiones no se sabe de que vault eran",
  );
  assert.deepEqual(store.getState().sesiones, {});
});

test("un almacén roto no impide abrir una consola", async () => {
  const roto = almacenFalso({ "mic-consolas-prefs": "{esto no es JSON" });
  const store = await cargarStore(roto);

  assert.deepEqual(store.getState().prefs, {
    shellPorDefecto: null,
    restaurarSesiones: true,
    restaurarScrollback: true,
  });
  await store.getState().usarAlmacenDeVault("/vaults/A");
  assert.equal(store.getState().registrar("a1", { shellId: null, cwd: null }), "Terminal 1");
});
