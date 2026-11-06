// Test headless de las pestañas con un conflicto pendiente con el disco
// (`DEF-138`, `DEF-177`): ningún camino que reemplace o cierre la pestaña
// puede llevarse lo que el usuario escribió sin preguntar o sin guardarle una
// copia. Se transpilan los módulos en el momento, con los stores de pestañas y
// del panel lateral de verdad (zustand real) y stubs para la pregunta, el
// vault y el disco.
//
//   node --test scripts/test-conflictos-abiertos.mjs
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

const memoria = new Map();
globalThis.localStorage ??= {
  getItem: (k) => memoria.get(k) ?? null,
  setItem: (k, v) => void memoria.set(k, String(v)),
  removeItem: (k) => void memoria.delete(k),
};
globalThis.window ??= globalThis;

// Lo que los stubs dejan ver: las preguntas, los avisos y lo escrito en disco.
globalThis.__def177 = { respuesta: true, preguntas: [], avisos: [], escritos: [] };

const PESTANAS = aUrl(`
export const esSentinela = (id) => /^(graph|calendario|terminal|archivo|enlaces|bandeja):/.test(id);
export const seDuplicaAlDividir = () => true;
export const BANDEJA_PERSONAL_ID = "bandeja:personal";
export const TITULO_BANDEJA_PERSONAL = "Bandeja personal";`);
const PREFS = aUrl(`
export const prefs = { previewTabs: false };
export const usePreferencesStore = { getState: () => ({ prefs }) };`);
const CONFIRMAR = aUrl(`
export async function confirmar(mensaje, boton) {
  globalThis.__def177.preguntas.push({ mensaje, boton });
  return globalThis.__def177.respuesta;
}`);
const VAULT = aUrl(`
export const useVaultStore = { getState: () => ({ notas: [{ id: "a.md", titulo: "A" }, { id: "b.md", titulo: "B" }] }) };`);
const AVISOS = aUrl(`export const avisar = (texto) => void globalThis.__def177.avisos.push(texto);`);
const VAULT_FS = aUrl(`
export async function escribirNota(vault, ruta, contenido) {
  globalThis.__def177.escritos.push({ vault, ruta, contenido });
  return 1;
}`);
const VAULT_CTX = aUrl(`export const getVaultActual = () => "C:/vault";`);

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
const CONFLICTOS = await fuente("../lib/conflictosAbiertos.ts", {
  "@/lib/cachePestanas": CACHE,
  "@/lib/confirmar": CONFIRMAR,
  "@/lib/conflictoExterno": await fuente("../lib/conflictoExterno.ts"),
  "@/lib/db/vaultContext": VAULT_CTX,
  "@/lib/db/vaultFs": VAULT_FS,
  "@/lib/pestanas": PESTANAS,
  "@/stores/avisosStore": AVISOS,
  "@/stores/tabsStore": TABS,
  "@/stores/vaultStore": VAULT,
});

const { useTabsStore, allLeaves } = await import(TABS);
const { useSidebarViewerStore } = await import(LATERAL);
const { barrerPestanasCerradas } = await import(CACHE);
const C = await import(CONFLICTOS);

const estado = () => useTabsStore.getState();
const hojas = () => allLeaves(estado().root);
const todas = () => hojas().flatMap((h) => h.tabs);
const espera = () => new Promise((r) => setTimeout(r, 0));

/** Lo que el editor registra al entrar en conflicto, con un contador de copias. */
function enConflicto(tab, texto = "lo mío", { falla = false } = {}) {
  const registro = { copias: 0 };
  C.registrarConflicto(
    tab.id,
    tab.notaId,
    async () => {
      registro.copias++;
      if (falla) return false;
      // Lo que hace `guardarCopia` del editor al terminar bien.
      C.olvidarConflicto(tab.id);
      return true;
    },
    () => texto,
  );
  return registro;
}

function deCero({ respuesta = true } = {}) {
  useTabsStore.setState(useTabsStore.getInitialState());
  useSidebarViewerStore.setState({ tabs: [], activeTab: "", editing: {} });
  for (const t of todas()) C.olvidarConflicto(t.id);
  barrerPestanasCerradas();
  Object.assign(globalThis.__def177, { respuesta, preguntas: [], avisos: [], escritos: [] });
}

/** Una pestaña de a.md con b.md adelante en su historial. */
function pestanaConHistorial() {
  estado().openNote("a.md");
  const hoja = hojas()[0];
  useTabsStore.setState({
    root: { ...hoja, tabs: [{ ...hoja.tabs[0], historial: ["a.md", "b.md"], indice: 0 }] },
  });
  return { paneId: hoja.id, tab: todas()[0] };
}

test("adelante en una pestaña con conflicto pregunta, guarda la copia y navega", async () => {
  deCero();
  const { paneId, tab } = pestanaConHistorial();
  const r = enConflicto(tab);
  assert.equal(await C.navegarHistorialSinPerder(paneId, 1), true);
  assert.equal(globalThis.__def177.preguntas.length, 1);
  assert.equal(globalThis.__def177.preguntas[0].boton, "Guardar copia y seguir");
  assert.match(globalThis.__def177.preguntas[0].mensaje, /«A»/);
  assert.equal(r.copias, 1);
  assert.equal(todas()[0].notaId, "b.md");
  await espera();
  assert.equal(r.copias, 1, "el barrido no hace una segunda copia");
});

test("adelante y el usuario cancela: la pestaña se queda con lo suyo", async () => {
  deCero({ respuesta: false });
  const { paneId, tab } = pestanaConHistorial();
  const r = enConflicto(tab);
  assert.equal(await C.navegarHistorialSinPerder(paneId, 1), false);
  assert.equal(r.copias, 0);
  assert.equal(todas()[0].id, tab.id);
  assert.equal(C.hayConflicto(tab.id), true);
});

test("adelante sin conflicto no pregunta", async () => {
  deCero();
  const { paneId } = pestanaConHistorial();
  assert.equal(await C.navegarHistorialSinPerder(paneId, 1), true);
  assert.equal(globalThis.__def177.preguntas.length, 0);
  assert.equal(todas()[0].notaId, "b.md");
  assert.equal(await C.navegarHistorialSinPerder(paneId, 1), false, "no hay adelante");
});

test("DEF-177: navegar por el store, sin preguntar, ya no tira lo escrito: guarda la copia sola", async () => {
  deCero();
  const { paneId, tab } = pestanaConHistorial();
  const r = enConflicto(tab);
  estado().navegarHistorial(paneId, 1);
  barrerPestanasCerradas();
  await espera();
  assert.equal(C.hayConflicto(tab.id), false);
  assert.equal(r.copias, 1);
});

test("la IA borra la nota (closeNotaEverywhere): copia sin preguntar", async () => {
  deCero();
  estado().openNote("a.md");
  estado().openNote("b.md");
  const tabA = todas().find((t) => t.notaId === "a.md");
  const r = enConflicto(tabA);
  estado().closeNotaEverywhere("a.md");
  barrerPestanasCerradas();
  await espera();
  assert.equal(r.copias, 1);
  assert.equal(globalThis.__def177.preguntas.length, 0);
});

test("si la copia falla, lo escrito va a un archivo de emergencia y se avisa", async () => {
  deCero();
  estado().openNote("a.md");
  const tab = todas()[0];
  enConflicto(tab, "texto a salvo", { falla: true });
  estado().closeTab(hojas()[0].id, tab.id);
  barrerPestanasCerradas();
  await espera();
  await espera();
  const { escritos, avisos } = globalThis.__def177;
  assert.equal(escritos.length, 1);
  assert.equal(escritos[0].contenido, "texto a salvo");
  assert.match(escritos[0].ruta, /^a \(copia local \d{4}-\d\d-\d\d \d{6}\)\.md$/);
  assert.equal(avisos.length, 1);
});

test("una pestaña de vista previa en conflicto queda fija: abrir otra nota no la reemplaza", () => {
  deCero();
  estado().openNote("a.md");
  const hoja = hojas()[0];
  useTabsStore.setState({ root: { ...hoja, tabs: [{ ...hoja.tabs[0], preview: true }] } });
  const tab = todas()[0];
  enConflicto(tab);
  assert.equal(todas()[0].preview, false);
});

test("cerrar con la X sigue preguntando «Guardar copia y cerrar»", async () => {
  deCero();
  estado().openNote("a.md");
  const tab = todas()[0];
  const r = enConflicto(tab);
  assert.equal(await C.cerrarPestanaSinPerder(hojas()[0].id, tab.id), true);
  assert.equal(globalThis.__def177.preguntas[0].boton, "Guardar copia y cerrar");
  assert.equal(r.copias, 1);
  assert.equal(todas().length, 0);
  await espera();
  assert.equal(r.copias, 1);
});

test("salir del vault: una sola pregunta por todas, y una copia por conflicto", async () => {
  deCero();
  estado().openNote("a.md");
  estado().openNote("b.md");
  const [ta, tb] = todas();
  const ra = enConflicto(ta);
  const rb = enConflicto(tb);
  assert.equal(await C.guardarConflictosSinPerder("salir del vault", "Guardar copia y salir"), true);
  assert.equal(globalThis.__def177.preguntas.length, 1);
  assert.match(globalThis.__def177.preguntas[0].mensaje, /^2 notas tienen/);
  assert.equal(ra.copias + rb.copias, 2);
  assert.equal(C.hayConflicto(ta.id) || C.hayConflicto(tb.id), false);
});

test("salir del vault y cancelar: no se guarda nada y se sigue en conflicto", async () => {
  deCero({ respuesta: false });
  estado().openNote("a.md");
  const tab = todas()[0];
  const r = enConflicto(tab);
  assert.equal(await C.guardarConflictosSinPerder("salir del vault", "Guardar copia y salir"), false);
  assert.equal(r.copias, 0);
  assert.equal(C.hayConflicto(tab.id), true);
});

test("la red de salir(): resguarda todo sin preguntar", async () => {
  deCero();
  estado().openNote("a.md");
  const r = enConflicto(todas()[0]);
  await C.resguardarConflictos();
  assert.equal(r.copias, 1);
  assert.equal(globalThis.__def177.preguntas.length, 0);
  // Después se sueltan las pestañas (cambio de almacén): no hay segunda copia.
  useTabsStore.setState({ root: { ...hojas()[0], tabs: [], activeTabId: null } });
  await espera();
  assert.equal(r.copias, 1);
});

test("cerrar la ventana: copia de emergencia de cada conflicto, también de las pestañas que no se ven", () => {
  deCero();
  estado().openNote("a.md");
  estado().openNote("b.md");
  estado().splitWithTab(hojas()[0].id, todas()[0].id, hojas()[0].id, "right", true);
  const [a1, b, a2] = todas();
  assert.equal(a1.notaId, "a.md");
  assert.equal(a2.notaId, "a.md");
  enConflicto(a1, "uno");
  enConflicto(a2, "uno"); // la misma nota en dos paneles, con el mismo texto
  enConflicto(b, "de b");
  const ahora = new Date(2026, 10, 2, 9, 5, 7);
  const rutas = C.escribirCopiasDeEmergencia(ahora);
  assert.deepEqual(rutas, ["a (copia local 2026-11-02 090507).md", "b (copia local 2026-11-02 090507).md"]);
  // Con textos distintos, una por texto y sin pisarse.
  C.registrarConflicto(a2.id, "a.md", async () => true, () => "dos");
  const otras = C.escribirCopiasDeEmergencia(ahora);
  assert.ok(otras.includes("a (copia local 2026-11-02 090508).md"));
  assert.equal(new Set(otras).size, otras.length);
});

test("la Bandeja personal (FUN-L-33): su copia de emergencia va a la raíz del vault, con su título", () => {
  deCero();
  estado().openNote("bandeja:personal");
  const [tab] = todas();
  enConflicto(tab, "lo mío");
  const rutas = C.escribirCopiasDeEmergencia(new Date(2026, 10, 6, 10, 0, 0));
  // Nada de «bandeja:personal (…)»: los dos puntos no valen en un nombre de Windows.
  assert.deepEqual(rutas, ["Bandeja personal (copia local 2026-11-06 100000).md"]);
  C.olvidarConflicto(tab.id);
});
