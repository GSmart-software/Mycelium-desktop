// Test headless de `FUN-M-58` parte 1d: el árbol del vault NO se recarga ni
// cambia de identidad cuando nada cambió, y SÍ cuando cambió algo que muestra.
//
// Corre el `vaultWatch.ts` y el `vaultStore.ts` reales (transpilados en el
// momento, con zustand de `node_modules`) contra un «índice» y un «disco» de
// mentira: `api("/vaults/…/tree")`, `indexarRutas`, `indexarVault` y el
// `recorrer_vault` de Tauri son dobles que cuentan sus llamadas. Así se ve, por
// ciclo del watcher, cuántas veces se leyó el árbol, cuántas se refrescaron las
// vistas en vivo y si `notas` cambió de identidad.
//
//   node --test scripts/test-arbol-sin-recarga.mjs
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

// ── Entorno de navegador mínimo ─────────────────────────────────────────────
globalThis.window = new EventTarget();
globalThis.document = Object.assign(new EventTarget(), { visibilityState: "visible" });
const almacen = new Map();
globalThis.localStorage = {
  getItem: (k) => almacen.get(k) ?? null,
  setItem: (k, v) => almacen.set(k, String(v)),
  removeItem: (k) => almacen.delete(k),
};
window.localStorage = globalThis.localStorage;

// ── Dobles ──────────────────────────────────────────────────────────────────
/** Lo que cuentan los dobles; se pone a cero en cada test. */
const C = (globalThis.__cuentas = { arbol: 0, refrescos: 0, indexarRutas: 0, indexarVault: 0, recorrer: 0 });
/** El «índice»: lo que devuelve `GET /vaults/{id}/tree`. */
const I = (globalThis.__indice = { carpetas: [], notas: [] });
/** Lo que devuelve el próximo `indexarRutas` / `indexarVault`. */
const R = (globalThis.__resultados = { rutas: null, vault: null, oyenteTauri: null, disco: null });

const STUB = {
  api: aUrl(`export async function api(ruta) {
    if (/\\/tree$/.test(ruta)) { globalThis.__cuentas.arbol++; return structuredClone(globalThis.__indice); }
    throw new Error("api no esperada: " + ruta);
  }`),
  livePreview: aUrl(`export function refreshAllLiveViews() { globalThis.__cuentas.refrescos++; }`),
  vacio: aUrl(`export const SIN_REPARACION = {}; export const alternarAliasDeNota = () => {};
    export const carpetaDeRuta = () => null; export const cambioRenombrar = () => {}; export const extensionDeRuta = () => "";
    export const leerPrevia = () => {}; export const movidosPorCarpeta = () => []; export const repararTrasOperacion = () => {};
    export const tituloDeRuta = () => ""; export const coincidencias = () => []; export const textoAviso = () => null;
    export const trasTraslados = () => []; export const avisoCaracteresReemplazados = () => null; export const sanearNombre = (x) => x;
    export const avisar = () => {}; export const TITULO_POR_DEFECTO = {};`),
  // La Bandeja (`FUN-L-33`): la protección y la preferencia, que acá no importan.
  bandeja: aUrl(`export const rutaTrasMoverCarpeta = () => null;
    export const protegerBandeja = () => {}; export const protegerCarpetaConBandeja = () => {};
    export const rutaBandeja = () => "Bandeja.md";
    export const usePreferencesStore = { getState: () => ({ prefs: {}, setPref: () => {} }) };`),
  authStore: aUrl(`export const useAuthStore = { getState: () => ({ accessToken: null, vaults: [{ id: "v" }] }) };`),
  graphStore: aUrl(`export const useGraphStore = { getState: () => ({ markStale() {} }) };`),
  tabsStore: aUrl(`export const useTabsStore = { getState: () => ({}) };`),
  sesionStore: aUrl(`export const useVaultSessionStore = { getState: () => ({ rutaActual: "C:/vault" }) };`),
  sesionesIa: aUrl(`export const useSesionesIaStore = { getState: () => ({ anotarExternos() {} }) };`),
  vaultFs: aUrl(`export const esEscrituraPropia = () => false;`),
  renombres: aUrl(`export const prepararRenombres = async () => []; export const ofrecerRenombres = () => {};`),
  otros: aUrl(`export function otrosDesdeMeta(filas) { return filas.map((f) => {
    const i = f.rutaRelativa.lastIndexOf("/");
    return { ruta: f.rutaRelativa, nombre: f.rutaRelativa.slice(i + 1), extension: f.tipo, carpetaId: i === -1 ? null : f.rutaRelativa.slice(0, i) };
  }); }`),
  indexer: aUrl(`export async function indexarRutas() { globalThis.__cuentas.indexarRutas++; return globalThis.__resultados.rutas(); }
    export async function indexarVault() { globalThis.__cuentas.indexarVault++; return globalThis.__resultados.vault(); }`),
  core: aUrl(`export async function invoke(cmd) {
    if (cmd !== "recorrer_vault") throw new Error(cmd);
    globalThis.__cuentas.recorrer++; return structuredClone(globalThis.__resultados.disco);
  }`),
  ventana: aUrl(`export function getCurrentWebviewWindow() { return { listen: async (_e, cb) => { globalThis.__resultados.oyenteTauri = cb; return () => {}; } }; }`),
};

const requerir = createRequire(import.meta.url);
const zustandDir = requerir.resolve("zustand/package.json").replace(/package\.json$/, "");
const ZUSTAND = pathToFileURL(`${zustandDir}esm/vanilla.mjs`).href;
const ZUSTAND_MW = pathToFileURL(`${zustandDir}esm/middleware.mjs`).href;
// El store usa `create` de zustand (el de React); en Node basta el de vanilla,
// que expone `getState`/`setState`/`subscribe` igual.
const ZUSTAND_CREATE = aUrl(`import { createStore } from "${ZUSTAND}"; export const create = () => (f) => createStore(f);`);

const EVENTOS = await fuente("../lib/eventos.ts");
const ARBOL_VIVO = await fuente("../lib/arbolVivo.ts");
const VAULT_STORE = await fuente("../stores/vaultStore.ts", {
  zustand: ZUSTAND_CREATE,
  "zustand/middleware": ZUSTAND_MW,
  "@/lib/api": STUB.api,
  "@/lib/eventos": EVENTOS,
  "@/lib/repararEnlaces": STUB.vacio,
  "@/lib/homonimos": STUB.vacio,
  "@/lib/db/nombres": STUB.vacio,
  "@/stores/avisosStore": STUB.vacio,
  "@/lib/arbolVivo": ARBOL_VIVO,
  "@/stores/authStore": STUB.authStore,
  "@/stores/graphStore": STUB.graphStore,
  "@/stores/tabsStore": STUB.tabsStore,
  "@/lib/editor/refrescoVivo": STUB.livePreview,
  "@/lib/extensionesDeTipo": STUB.vacio,
  "@/lib/bandeja": STUB.bandeja,
  "@/lib/bandejaRuta": STUB.bandeja,
  "@/stores/preferencesStore": STUB.bandeja,
});
const { useVaultStore } = await import(VAULT_STORE);
const { escucharCambiosVault, refrescarVault } = await import(
  await fuente("../lib/vaultWatch.ts", {
    "@/lib/arbolVivo": ARBOL_VIVO,
    "@/lib/eventos": EVENTOS,
    "@/lib/editor/refrescoVivo": STUB.livePreview,
    "@/lib/otrosArchivos": STUB.otros,
    "@/lib/db/indexer": STUB.indexer,
    "@/lib/db/vaultFs": STUB.vaultFs,
    "@/lib/renombresExternos": STUB.renombres,
    "@/stores/authStore": STUB.authStore,
    "@/stores/graphStore": STUB.graphStore,
    "@/stores/vaultSessionStore": STUB.sesionStore,
    "@/stores/vaultStore": VAULT_STORE,
    "@/stores/sesionesIaStore": STUB.sesionesIa,
    "@tauri-apps/api/core": STUB.core,
    "@tauri-apps/api/webviewWindow": STUB.ventana,
  })
);

// ── Datos sintéticos ────────────────────────────────────────────────────────
const crudaNota = (id, extra = {}) => {
  const i = id.lastIndexOf("/");
  return {
    id,
    carpeta_id: i === -1 ? null : id.slice(0, i),
    titulo: id.slice(i + 1).replace(/\.[^.]+$/, ""),
    tipo: "markdown",
    actualizado_en: "2026-11-01T10:00:00.000Z",
    ...extra,
  };
};
const crudaCarpeta = (id) => {
  const i = id.lastIndexOf("/");
  return { id, padre_id: i === -1 ? null : id.slice(0, i), nombre: id.slice(i + 1) };
};
const cambio = (ruta, estado, tipo = "", mtime = Date.now()) => ({ ruta, estado, tipo, mtime });
const espera = (ms) => new Promise((r) => setTimeout(r, ms));
/** Lo que tarda un ciclo: el debounce del watcher (300 ms) y un margen. */
const ciclo = () => espera(380);

async function preparar() {
  I.carpetas = [crudaCarpeta("Proyectos")];
  I.notas = [crudaNota("Alfa.md"), crudaNota("Proyectos/Beta.md", { aliases: ["B"] })];
  R.rutas = () => ({ reindexadas: 1, rutas: [], estructural: false });
  R.disco = {
    archivosMeta: [
      { rutaRelativa: "Alfa.md", mtime: 1, tipo: "markdown" },
      { rutaRelativa: "Proyectos/Beta.md", mtime: 1, tipo: "markdown" },
    ],
    otros: [{ rutaRelativa: "foto.png", mtime: 1, tipo: "png" }],
    directorios: ["Proyectos"],
  };
  R.vault = () => ({ notas: 2, carpetas: 1, reindexadas: 0, otros: [], rutas: [] });
  useVaultStore.getState().reset();
  await useVaultStore.getState().loadTree("v");
  useVaultStore.getState().setOtros([{ ruta: "foto.png", nombre: "foto.png", extension: "png", carpetaId: null }]);
  for (const k of Object.keys(C)) C[k] = 0;
}

const desuscribir = await escucharCambiosVault();
const emitir = (cambios) => R.oyenteTauri({ payload: cambios });

test("la primera carga deja el árbol y refresca las vistas (DEF-122)", async () => {
  useVaultStore.getState().reset();
  for (const k of Object.keys(C)) C[k] = 0;
  I.carpetas = [crudaCarpeta("Proyectos")];
  I.notas = [crudaNota("Alfa.md")];
  assert.equal(await useVaultStore.getState().loadTree("v"), true);
  assert.equal(C.refrescos, 1);
  assert.deepEqual(useVaultStore.getState().notas.map((n) => n.id), ["Alfa.md"]);
});

test("loadTree con el índice igual: misma identidad, sin set ni refresco", async () => {
  await preparar();
  const antes = useVaultStore.getState();
  let avisos = 0;
  const fuera = useVaultStore.subscribe(() => avisos++);
  // Solo cambia `actualizado_en`, que el árbol no muestra.
  I.notas = I.notas.map((n) => ({ ...n, actualizado_en: "2026-11-01T11:00:00.000Z" }));
  assert.equal(await useVaultStore.getState().loadTree("v"), false);
  fuera();
  const despues = useVaultStore.getState();
  assert.equal(despues.notas, antes.notas);
  assert.equal(despues.carpetas, antes.carpetas);
  assert.equal(despues.otros, antes.otros);
  assert.equal(avisos, 0, "no hubo set");
  assert.equal(C.refrescos, 0);
});

test("loadTree con UNA nota distinta: lista nueva, las demás conservan su objeto", async () => {
  await preparar();
  const antes = useVaultStore.getState().notas;
  I.notas = [crudaNota("Alfa.md"), crudaNota("Proyectos/Beta.md", { aliases: ["B", "Bê"] })];
  assert.equal(await useVaultStore.getState().loadTree("v"), true);
  const despues = useVaultStore.getState().notas;
  assert.notEqual(despues, antes);
  assert.equal(despues[0], antes[0], "Alfa es el mismo objeto");
  assert.deepEqual(despues[1].aliases, ["B", "Bê"]);
  assert.equal(C.refrescos, 1);
});

test("setOtros con la misma lista no cambia la identidad", async () => {
  await preparar();
  const antes = useVaultStore.getState().otros;
  useVaultStore.getState().setOtros([{ ruta: "foto.png", nombre: "foto.png", extension: "png", carpetaId: null }]);
  assert.equal(useVaultStore.getState().otros, antes);
  useVaultStore.getState().setOtros([]);
  assert.deepEqual(useVaultStore.getState().otros, []);
});

test("cambio externo de CONTENIDO de una nota: no se relee el árbol y se refresca una vez", async () => {
  await preparar();
  const antes = useVaultStore.getState().notas;
  emitir([cambio("Alfa.md", "nota", "markdown")]);
  await ciclo();
  assert.equal(C.indexarRutas, 1);
  assert.equal(C.arbol, 0, "sin recarga del árbol");
  assert.equal(C.refrescos, 1, "un solo refresco de las vistas en vivo");
  assert.equal(useVaultStore.getState().notas, antes);
});

test("cambio externo de alias: llega al árbol por el evento, sin releerlo", async () => {
  await preparar();
  R.rutas = () => {
    // Lo que hace `escribirNotas` al ver que cambiaron los alias.
    window.dispatchEvent(new CustomEvent("micelio:alias-cambiados", { detail: { aliases: { "Alfa.md": ["Primera"] } } }));
    return { reindexadas: 1, rutas: ["Alfa.md"], estructural: false };
  };
  emitir([cambio("Alfa.md", "nota", "markdown")]);
  await ciclo();
  assert.equal(C.arbol, 0);
  assert.deepEqual(useVaultStore.getState().notas.find((n) => n.id === "Alfa.md").aliases, ["Primera"]);
});

test("creación externa: el árbol la muestra al instante y se recarga tras indexar", async () => {
  await preparar();
  emitir([cambio("Gamma.md", "nota", "markdown")]);
  assert.ok(useVaultStore.getState().notas.some((n) => n.id === "Gamma.md"), "en el acto");
  I.notas = [...I.notas, crudaNota("Gamma.md")];
  R.rutas = () => ({ reindexadas: 1, rutas: ["Gamma.md"], estructural: true });
  C.refrescos = 0;
  await ciclo();
  assert.equal(C.arbol, 1, "se recargó");
  // La recarga dejó el árbol igual al que ya mostraba: no refresca; el aviso sí.
  assert.equal(C.refrescos, 1);
  assert.ok(useVaultStore.getState().notas.some((n) => n.id === "Gamma.md"));
});

test("borrado y renombre externos: se recarga el árbol", async () => {
  await preparar();
  emitir([cambio("Alfa.md", "ausente"), cambio("Proyectos/Alfa2.md", "nota", "markdown")]);
  I.notas = [crudaNota("Proyectos/Alfa2.md"), crudaNota("Proyectos/Beta.md", { aliases: ["B"] })];
  R.rutas = () => ({ reindexadas: 1, rutas: ["Proyectos/Alfa2.md", "Alfa.md"], estructural: true });
  await ciclo();
  assert.equal(C.arbol, 1);
  assert.deepEqual(useVaultStore.getState().notas.map((n) => n.id).sort(), ["Proyectos/Alfa2.md", "Proyectos/Beta.md"]);
});

test("si el evento cambió el árbol, se recarga aunque el índice diga que no fue estructural", async () => {
  await preparar();
  // Un archivo que no es nota: el índice no lo guarda, pero tocó el árbol.
  emitir([cambio("doc.pdf", "otro", "pdf")]);
  await ciclo();
  assert.equal(C.arbol, 1);
  assert.ok(useVaultStore.getState().otros.some((o) => o.ruta === "doc.pdf"));
});

test("reconciliación (foco tras 30 s) sin cambios: no recarga el árbol ni avisa", async () => {
  await preparar();
  const antes = useVaultStore.getState();
  let recargas = 0;
  const oyente = () => recargas++;
  window.addEventListener("micelio:vault-recargar", oyente);
  const ahora = Date.now;
  Date.now = () => ahora() + 31_000;
  try {
    window.dispatchEvent(new Event("focus"));
    await espera(50);
  } finally {
    Date.now = ahora;
  }
  assert.equal(C.recorrer, 1, "el foco disparó la reconciliación");
  await refrescarVault(); // y el botón «Refrescar», por la misma cola
  window.removeEventListener("micelio:vault-recargar", oyente);
  assert.equal(C.recorrer, 2);
  assert.equal(C.arbol, 0);
  assert.equal(C.refrescos, 0);
  assert.equal(recargas, 0);
  const despues = useVaultStore.getState();
  assert.equal(despues.notas, antes.notas);
  assert.equal(despues.otros, antes.otros);
});

test("reconciliación con cambios: corrige el árbol, lo recarga y avisa", async () => {
  await preparar();
  R.disco.archivosMeta.push({ rutaRelativa: "Perdida.md", mtime: 2, tipo: "markdown" });
  I.notas = [...I.notas, crudaNota("Perdida.md")];
  R.vault = () => ({ notas: 3, carpetas: 1, reindexadas: 1, otros: [], rutas: ["Perdida.md"] });
  let rutas = null;
  const oyente = (e) => (rutas = e.detail?.rutas ?? null);
  window.addEventListener("micelio:vault-recargar", oyente);
  await refrescarVault();
  window.removeEventListener("micelio:vault-recargar", oyente);
  assert.equal(C.arbol, 1);
  assert.deepEqual(rutas, ["Perdida.md"]);
  assert.ok(useVaultStore.getState().notas.some((n) => n.id === "Perdida.md"));
  // Dos refrescos, en dos momentos: el de `aplicarCambios` al corregir el árbol
  // (la nota apareció) y el del aviso tras indexar. La recarga del árbol, que
  // quedó igual, no suma un tercero.
  assert.equal(C.refrescos, 2);
});

test("reconciliación con solo contenido cambiado: avisa, y la recarga no cambia la identidad", async () => {
  await preparar();
  const antes = useVaultStore.getState().notas;
  I.notas = I.notas.map((n) => ({ ...n, actualizado_en: "2026-11-01T12:00:00.000Z" }));
  R.vault = () => ({ notas: 2, carpetas: 1, reindexadas: 1, otros: [], rutas: ["Alfa.md"] });
  await refrescarVault();
  assert.equal(useVaultStore.getState().notas, antes);
  assert.equal(C.refrescos, 1, "el del aviso, una vez");
});

test.after(() => desuscribir());
