// Test headless de lo que se recuerda por pestaña (`FUN-M-58`): el caché del
// editor (`lib/cachePestanas.ts`) tiene que vivir lo que vive la pestaña, y el
// de las conexiones del panel (`lib/cacheLru.ts`) no puede crecer con cada
// nota visitada. Se transpilan los módulos en el momento, con los stores de
// pestañas y del panel lateral de verdad (zustand real) y stubs para lo que
// toca Tauri o íconos.
//
//   node --test scripts/test-cache-pestanas.mjs
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { test } from "node:test";
import ts from "typescript";

const require = createRequire(import.meta.url);
const aUrl = (codigo) => `data:text/javascript,${encodeURIComponent(codigo)}`;

async function fuente(ruta, mapa = {}) {
  const texto = await readFile(fileURLToPath(new URL(ruta, import.meta.url)), "utf8");
  let { outputText } = ts.transpileModule(texto, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 },
  });
  for (const [especificador, url] of Object.entries(mapa)) {
    outputText = outputText.split(`"${especificador}"`).join(`"${url}"`);
  }
  return aUrl(outputText);
}

const ZUSTAND = pathToFileURL(require.resolve("zustand")).href;
const ZUSTAND_MW = pathToFileURL(require.resolve("zustand/middleware")).href;

// El barrido se suscribe a los stores solo en el navegador; el `persist` de los
// stores escribe en un `localStorage` de memoria.
const memoria = new Map();
globalThis.localStorage ??= {
  getItem: (k) => memoria.get(k) ?? null,
  setItem: (k, v) => void memoria.set(k, String(v)),
  removeItem: (k) => void memoria.delete(k),
};
globalThis.window ??= globalThis;

const PESTANAS = aUrl(`
export const esSentinela = (id) => /^(graph|calendario|terminal|archivo|enlaces):/.test(id);
export const seDuplicaAlDividir = () => true;`);
const PREFS = aUrl(`
export const prefs = { previewTabs: false };
export const usePreferencesStore = { getState: () => ({ prefs }) };`);
const HISTORIAL = await fuente("../lib/historialPestana.ts");
const TABS = await fuente("../stores/tabsStore.ts", {
  zustand: ZUSTAND,
  "zustand/middleware": ZUSTAND_MW,
  "@/lib/pestanas": PESTANAS,
  "@/lib/historialPestana": HISTORIAL,
  "@/stores/preferencesStore": PREFS,
});
const LATERAL = await fuente("../stores/sidebarViewerStore.ts", {
  zustand: ZUSTAND,
  "zustand/middleware": ZUSTAND_MW,
  "@/lib/pestanas": PESTANAS,
});

const CACHE = await fuente("../lib/cachePestanas.ts", {
  "@/stores/tabsStore": TABS,
  "@/stores/sidebarViewerStore": LATERAL,
});

const { useTabsStore, allLeaves } = await import(TABS);
const { useSidebarViewerStore } = await import(LATERAL);
const { atarAPestanas, pestanaAbierta, claveViva, CLAVE_LATERAL_EDITOR } = await import(CACHE);
const { CacheLru } = await import(await fuente("../lib/cacheLru.ts"));

const estado = () => useTabsStore.getState();
const hojas = () => allLeaves(estado().root);
const todas = () => hojas().flatMap((h) => h.tabs);

/**
 * Lo que hace el editor (`NoteEditor`) con su caché: al desmontarse guarda el
 * estado de la pestaña, pero solo si sigue abierta.
 */
const cache = atarAPestanas(new Map());
function desmontar(tabId, doc = `texto de ${tabId}`) {
  if (pestanaAbierta(tabId)) cache.set(tabId, { doc, anchor: 3, head: 3, plegadosEdicion: [{ from: 0, to: 2 }] });
}

function deCero() {
  useTabsStore.setState(useTabsStore.getInitialState());
  useSidebarViewerStore.setState({ tabs: [], activeTab: "", editing: {} });
  cache.clear();
}

test("abrir y cerrar N pestañas deja en el caché solo las abiertas", () => {
  deCero();
  const N = 200;
  for (let i = 0; i < N; i++) {
    estado().openNote(`n${i}.md`);
    // Pasar a la siguiente desmonta la anterior: se guarda su estado.
    const t = todas().find((x) => x.notaId === `n${i}.md`);
    desmontar(t.id);
  }
  assert.equal(cache.size, N);
  // Se cierran todas menos 5, unas visibles y otras ocultas.
  const pane = hojas()[0].id;
  for (const t of todas().slice(0, N - 5)) estado().closeTab(pane, t.id);
  assert.equal(todas().length, 5);
  assert.equal(cache.size, 5);
  for (const t of todas()) assert.ok(cache.has(t.id), "lo de las abiertas sigue ahí");
  assert.deepEqual(cache.get(todas()[0].id).plegadosEdicion, [{ from: 0, to: 2 }]);
});

test("cerrar la pestaña VISIBLE: el barrido pasa antes de desmontar y el desmontaje no la resucita", () => {
  deCero();
  estado().openNote("a.md");
  const pane = hojas()[0].id;
  const id = todas()[0].id;
  // Ya había estado oculta una vez: tiene entrada.
  desmontar(id);
  assert.equal(cache.size, 1);
  // El store se actualiza primero (el barrido la suelta)…
  estado().closeTab(pane, id);
  assert.equal(cache.size, 0);
  // …y después React desmonta el editor: no vuelve a guardarla.
  desmontar(id);
  assert.equal(cache.size, 0);
  assert.equal(pestanaAbierta(id), false);
});

test("la misma nota en dos paneles: cerrar una pestaña no toca la de la otra", () => {
  deCero();
  estado().openNote("a.md");
  const src = hojas()[0];
  const tab = src.tabs[0];
  estado().splitWithTab(src.id, tab.id, src.id, "right", true);
  const [p1, p2] = hojas();
  assert.equal(p1.tabs[0].notaId, "a.md");
  assert.equal(p2.tabs[0].notaId, "a.md");
  assert.notEqual(p1.tabs[0].id, p2.tabs[0].id);
  desmontar(p1.tabs[0].id, "uno");
  desmontar(p2.tabs[0].id, "dos");
  assert.equal(cache.size, 2);
  estado().closeTab(p1.id, p1.tabs[0].id);
  assert.equal(cache.size, 1);
  assert.equal(cache.get(p2.tabs[0].id).doc, "dos");
});

test("navegar a otra nota en la pestaña (le cambia el id) suelta lo de la nota anterior", () => {
  deCero();
  estado().openNote("a.md");
  const pane = hojas()[0].id;
  // Abrir b en la misma pestaña: con previewTabs apagado se abre otra, así que
  // se arma la línea a mano con navegarHistorial.
  useTabsStore.setState({
    root: { ...hojas()[0], tabs: [{ ...todas()[0], historial: ["a.md", "b.md"], indice: 0 }] },
  });
  const antes = todas()[0].id;
  desmontar(antes);
  estado().navegarHistorial(pane, 1);
  const despues = todas()[0].id;
  assert.notEqual(antes, despues);
  assert.equal(cache.has(antes), false);
});

test("mover una pestaña a otro panel conserva su estado (el id no cambia)", () => {
  deCero();
  estado().openNote("a.md");
  estado().openNote("b.md");
  const src = hojas()[0];
  const b = src.tabs.find((t) => t.notaId === "b.md");
  estado().splitWithTab(src.id, src.tabs[0].id, src.id, "right", true);
  const dst = hojas()[1];
  desmontar(b.id, "de b");
  estado().moveTabToPane(src.id, b.id, dst.id);
  assert.ok(todas().some((t) => t.id === b.id));
  assert.equal(cache.get(b.id).doc, "de b");
});

test("Ctrl+Shift+T abre una pestaña nueva: no lee lo de la cerrada", () => {
  deCero();
  estado().openNote("a.md");
  const pane = hojas()[0].id;
  const id = todas()[0].id;
  desmontar(id);
  estado().closeTab(pane, id);
  estado().reopenLastClosed();
  const nueva = todas()[0];
  assert.equal(nueva.notaId, "a.md");
  assert.notEqual(nueva.id, id);
  assert.equal(cache.size, 0);
});

test("el panel lateral: vive mientras el documento siga anclado", () => {
  deCero();
  const clave = `${CLAVE_LATERAL_EDITOR}a.md`;
  useSidebarViewerStore.getState().dock("a.md");
  desmontar(clave);
  // Cambiar el árbol de pestañas no lo toca: no es una pestaña del árbol.
  estado().openNote("x.md");
  assert.ok(cache.has(clave));
  useSidebarViewerStore.getState().cerrar("a.md");
  assert.equal(cache.has(clave), false);
  desmontar(clave);
  assert.equal(cache.has(clave), false);
});

test("cambiar de vault (el árbol se reemplaza) suelta todo lo del vault anterior", () => {
  deCero();
  estado().openNote("a.md");
  estado().openNote("b.md");
  for (const t of todas()) desmontar(t.id);
  assert.equal(cache.size, 2);
  const otro = { id: "pane-otro", type: "leaf", tabs: [{ id: "t-otro", notaId: "c.md", preview: false }], activeTabId: "t-otro", linkedTo: null, linkedScrollSync: false };
  useTabsStore.setState({ root: otro, activePaneId: otro.id });
  assert.equal(cache.size, 0);
});

test("claveViva distingue pestañas del árbol y documentos del panel lateral", () => {
  const abiertas = new Set(["t1"]);
  assert.equal(claveViva("t1", abiertas, []), true);
  assert.equal(claveViva("t2", abiertas, []), false);
  assert.equal(claveViva("sidebar-a.md", abiertas, ["a.md"]), true);
  assert.equal(claveViva("sidebar-a.md", abiertas, []), false);
});

test("CacheLru: no pasa del tope y suelta lo usado hace más tiempo", () => {
  const c = new CacheLru(3);
  for (let i = 0; i < 1000; i++) c.set(`n${i}`, i);
  assert.equal(c.size, 3);
  assert.equal(c.get("n996"), undefined);
  assert.equal(c.get("n997"), 997);
  // Leer n997 lo hizo el más reciente: el próximo en caer es n998.
  c.set("x", 0);
  assert.equal(c.get("n998"), undefined);
  assert.equal(c.get("n997"), 997);
  c.clear();
  assert.equal(c.size, 0);
});
