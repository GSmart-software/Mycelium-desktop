// Test headless (sin navegador ni Tauri) de la capa de datos del desktop tras
// `FUN-L-24` (auditoría de la capa de datos, 2026-09-26):
//
//   - sin vault ni índice abiertos, la capa de datos LANZA en vez de caer en otra
//     base (el «modo SQLite clásico», retirado);
//   - las preferencias del vault llevan la apariencia (tema, modo oscuro y el
//     resto de `preferencesStore`), saneada al cargar;
//   - la migración única de `lib/db/legado.ts` lleva a `preferencias.json` y
//     `snippets.json` lo que una versión anterior dejó en `apariencia.json` o en
//     las tablas viejas del índice, y borra `apariencia.json`;
//   - `cssStore` lee y escribe `snippets.json` directo.
//
// Los módulos bajo prueba importan `zustand`, `@tauri-apps/api/core` y otros
// módulos del repo. Se transpilan en el momento y cada import se reemplaza por
// una data: URL: los del repo, por el módulo real ya transpilado (la MISMA URL
// en todos lados, así comparten instancia: `setExecutor` en el test es el mismo
// que usa el repo); `zustand` y Tauri, por dobles mínimos. El executor SQL es un
// doble que responde las pocas consultas que estos módulos hacen.
//
//   node --test scripts/test-capa-datos.mjs
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { beforeEach, test } from "node:test";
import ts from "typescript";

const aUrl = (codigo) => `data:text/javascript,${encodeURIComponent(codigo)}`;

/** Transpila un `.ts` del repo y reemplaza sus imports según `mapa`. */
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

// ── Dobles ────────────────────────────────────────────────────────────────────

/** `zustand` mínimo: `create(init)` → hook con `getState`. */
const ZUSTAND = aUrl(`
export function create(init) {
  let estado;
  const get = () => estado;
  const set = (p) => { estado = { ...estado, ...(typeof p === "function" ? p(estado) : p) }; };
  estado = init(set, get);
  const hook = (sel) => (sel ? sel(estado) : estado);
  hook.getState = get;
  return hook;
}
`);

/** `invoke` de Tauri: delega en `globalThis.__invoke`, que arma cada test. */
const TAURI = aUrl(`export const invoke = (cmd, args) => globalThis.__invoke(cmd, args);`);

/**
 * `.mycelium/` en memoria, con los mismos comandos y la misma lista cerrada que
 * `prefs_vault.rs` (los legados se leen y se borran, no se escriben).
 */
function mycelium(inicial = {}) {
  const archivos = new Map(Object.entries(inicial));
  const ESTADOS = ["preferencias.json", "snippets.json", "papelera.json", "recordatorios.json"];
  const LEGADOS = ["apariencia.json"];
  const comprobar = (nombre, permitidos) => {
    if (!permitidos.includes(nombre)) throw `Archivo de estado desconocido: ${nombre}`;
  };
  globalThis.__invoke = async (cmd, { nombre, contenido }) => {
    if (cmd === "leer_estado_vault") {
      comprobar(nombre, [...ESTADOS, ...LEGADOS]);
      return archivos.get(nombre) ?? null;
    }
    if (cmd === "escribir_estado_vault") {
      comprobar(nombre, ESTADOS);
      archivos.set(nombre, contenido);
      return null;
    }
    if (cmd === "borrar_estado_vault") {
      comprobar(nombre, LEGADOS);
      archivos.delete(nombre);
      return null;
    }
    throw `comando inesperado: ${cmd}`;
  };
  return archivos;
}

/**
 * Executor SQL que simula un índice: `tablas` dice cuáles existen y con qué
 * filas. Solo entiende las consultas de `legado.ts`.
 */
function indice(tablas = {}) {
  return {
    async select(sql, params = []) {
      if (sql.includes("sqlite_master")) return tablas[params[0]] ? [{ name: params[0] }] : [];
      if (sql.includes("FROM usuarios")) return tablas.usuarios ?? [];
      if (sql.includes("FROM css_snippets")) return tablas.css_snippets ?? [];
      throw new Error(`consulta inesperada: ${sql}`);
    },
    async execute() {
      throw new Error("la migración no escribe en el índice");
    },
  };
}

// ── Módulos bajo prueba ──────────────────────────────────────────────────────

const ERRORS = await fuente("../lib/db/errors.ts");
const CLIENT = await fuente("../lib/db/client.ts", { "./errors": ERRORS });
const CONTEXTO = await fuente("../lib/db/vaultContext.ts", { "./errors": ERRORS });
const NOMBRES = await fuente("../lib/db/nombres.ts");
const LEGADO = await fuente("../lib/db/legado.ts", {
  "./client": CLIENT,
  "./nombres": NOMBRES,
  "@tauri-apps/api/core": TAURI,
});
// El tema guardado se valida con `lib/temas.ts` (`FUN-M-51`), que a su vez usa
// las atmósferas y el filtro del modo dev.
const TEMAS = await fuente("../lib/temas.ts", {
  "./atmosferas": await fuente("../lib/atmosferas.ts"),
  "./modoDev": await fuente("../lib/modoDev.ts"),
});
const PREFS_VAULT = await fuente("../stores/prefsVaultStore.ts", {
  zustand: ZUSTAND,
  "@tauri-apps/api/core": TAURI,
  "@/lib/temas": TEMAS,
});
const CSS = await fuente("../stores/cssStore.ts", {
  zustand: ZUSTAND,
  "@tauri-apps/api/core": TAURI,
  "@/lib/db/vaultContext": CONTEXTO,
});

const { DbError } = await import(ERRORS);
const client = await import(CLIENT);
const contexto = await import(CONTEXTO);
const legado = await import(LEGADO);
const prefsVault = await import(PREFS_VAULT);
const { useCssStore } = await import(CSS);

const VAULT = "C:/vaults/prueba";
const leerJson = (archivos, nombre) => JSON.parse(archivos.get(nombre));

beforeEach(() => {
  client.setExecutor(null);
  contexto.setVaultActual(null);
});

// ── Sin vault no hay capa de datos (D1) ──────────────────────────────────────

test("getVaultActual lanza sin vault abierto, en vez de devolver null", () => {
  assert.throws(() => contexto.getVaultActual(), (e) => e instanceof DbError && e.status === 409);
  contexto.setVaultActual(VAULT);
  assert.equal(contexto.getVaultActual(), VAULT);
  contexto.setVaultActual(null);
  assert.throws(() => contexto.getVaultActual(), DbError);
});

test("sin índice abierto, select y execute lanzan: no hay base por defecto", async () => {
  await assert.rejects(client.select("SELECT 1"), DbError);
  await assert.rejects(client.execute("DELETE FROM notas"), DbError);
});

test("con un executor inyectado, los atajos van a ese executor", async () => {
  const llamadas = [];
  client.setExecutor({
    select: async (sql, params) => (llamadas.push(["select", sql, params]), [{ n: 1 }]),
    execute: async (sql, params) => (llamadas.push(["execute", sql, params]), { rowsAffected: 2 }),
  });
  assert.deepEqual(await client.select("SELECT ?", [1]), [{ n: 1 }]);
  assert.deepEqual(await client.execute("UPDATE x SET y = ?", [3]), { rowsAffected: 2 });
  assert.deepEqual(llamadas.map((l) => l[0]), ["select", "execute"]);
  client.setExecutor(null);
  await assert.rejects(client.select("SELECT 1"), DbError);
});

test("LOCAL_VAULT_ID sigue siendo el id que llevan las filas de índices existentes", () => {
  // Cambiarlo dejaría huérfanas todas las filas de los índices ya creados.
  assert.equal(contexto.LOCAL_VAULT_ID, "local-vault");
});

// ── Preferencias del vault con la apariencia (D3) ───────────────────────────

test("un vault sin preferencias arranca con la apariencia de siempre", () => {
  const p = prefsVault.normalizar(null);
  assert.equal(p.tema, "bioluminiscencia");
  assert.equal(p.modoOscuro, true);
  assert.deepEqual(p.preferencias, {});
  assert.equal(p.numerosDeLinea, false);
});

test("normalizar conserva la apariencia válida y descarta la inválida", () => {
  const ok = prefsVault.normalizar({
    tema: "cantarela",
    modoOscuro: false,
    preferencias: { editorSize: 18 },
    numerosDeLinea: true,
  });
  assert.equal(ok.tema, "cantarela");
  assert.equal(ok.modoOscuro, false);
  assert.deepEqual(ok.preferencias, { editorSize: 18 });
  assert.equal(ok.numerosDeLinea, true);

  // Arrecife (`FUN-M-51`) se conserva aunque el modo dev esté apagado: al
  // reiniciar no cae al predeterminado.
  assert.equal(prefsVault.normalizar({ tema: "arrecife" }).tema, "arrecife");

  const mal = prefsVault.normalizar({ tema: "neon", modoOscuro: "si", preferencias: [1, 2] });
  assert.equal(mal.tema, "bioluminiscencia");
  assert.equal(mal.modoOscuro, true);
  assert.deepEqual(mal.preferencias, {});
});

test("sanearContraDefectos deja pasar solo claves conocidas con su tipo", () => {
  const defectos = { editorSize: 16, editorFont: "mono", previewTabs: true, graphColorGroups: [] };
  const limpio = prefsVault.sanearContraDefectos(
    {
      editorSize: "grande",
      editorFont: "serif",
      previewTabs: false,
      graphColorGroups: { no: "es una lista" },
      claveDesconocida: 1,
    },
    defectos,
  );
  assert.deepEqual(limpio, { editorFont: "serif", previewTabs: false });
  assert.deepEqual(prefsVault.sanearContraDefectos({ editorSize: Number.NaN }, defectos), {});
  assert.deepEqual(prefsVault.sanearContraDefectos(null, defectos), {});
  assert.deepEqual(prefsVault.sanearContraDefectos({ graphColorGroups: [] }, defectos), {
    graphColorGroups: [],
  });
});

test("cargar lee preferencias.json con el comando de estado del vault", async () => {
  mycelium({ "preferencias.json": JSON.stringify({ tema: "cantarela", numerosDeLinea: true }) });
  const store = prefsVault.usePrefsVaultStore;
  await store.getState().cargar(null);
  await store.getState().cargar(VAULT);
  assert.equal(store.getState().ruta, VAULT);
  assert.equal(store.getState().prefs.tema, "cantarela");
  assert.equal(store.getState().prefs.numerosDeLinea, true);
  await store.getState().cargar(null);
});

// ── Migración única (`lib/db/legado.ts`) ─────────────────────────────────────

test("las funciones puras de la migración", () => {
  assert.equal(legado.yaTieneApariencia({ tema: "cantarela" }), true);
  assert.equal(legado.yaTieneApariencia({ numerosDeLinea: true }), false);
  assert.equal(legado.yaTieneApariencia(null), false);
  assert.deepEqual(
    legado.aparienciaDeArchivo({ version: 1, tema: "cantarela", modoOscuro: false, preferencias: null }),
    { tema: "cantarela", modoOscuro: false, preferencias: {} },
  );
  assert.equal(legado.aparienciaDeArchivo({ modoOscuro: true }), null);
  assert.deepEqual(
    legado.fusionarApariencia(
      { numerosDeLinea: true },
      { tema: "cantarela", modoOscuro: false, preferencias: { editorSize: 18 } },
    ),
    { numerosDeLinea: true, tema: "cantarela", modoOscuro: false, preferencias: { editorSize: 18 } },
  );
});

test("apariencia.json se funde en preferencias.json y desaparece (criterio 3)", async () => {
  client.setExecutor(indice());
  const archivos = mycelium({
    "apariencia.json": JSON.stringify({
      version: 1,
      tema: "cantarela",
      modoOscuro: false,
      preferencias: { editorSize: 20, atmosferaClaro: "bruma" },
    }),
    "preferencias.json": JSON.stringify({ numerosDeLinea: true, nombresGrafo: "vecinos" }),
  });
  await legado.migrarEstadoLegado(VAULT);

  assert.equal(archivos.has("apariencia.json"), false, "el archivo viejo se borra");
  const prefs = leerJson(archivos, "preferencias.json");
  assert.equal(prefs.tema, "cantarela");
  assert.equal(prefs.modoOscuro, false);
  assert.deepEqual(prefs.preferencias, { editorSize: 20, atmosferaClaro: "bruma" });
  assert.equal(prefs.numerosDeLinea, true, "lo que preferencias.json ya tenía no se pierde");
  assert.equal(prefs.nombresGrafo, "vecinos");
});

test("un índice de la 2.1.0 entrega su apariencia y sus snippets a los archivos", async () => {
  client.setExecutor(
    indice({
      usuarios: [{ tema: "cantarela", modo_oscuro: 0, preferencias_json: '{"editorSize":14}' }],
      css_snippets: [
        { id: "s1", nombre: "Titulos", activo: 1, contenido: "h1{color:red}" },
        { id: "s2", nombre: "Apagado", activo: 0, contenido: "p{}" },
      ],
    }),
  );
  const archivos = mycelium();
  await legado.migrarEstadoLegado(VAULT);

  const prefs = leerJson(archivos, "preferencias.json");
  assert.equal(prefs.tema, "cantarela");
  assert.equal(prefs.modoOscuro, false);
  assert.deepEqual(prefs.preferencias, { editorSize: 14 });
  assert.deepEqual(leerJson(archivos, "snippets.json"), {
    version: 1,
    snippets: [
      { id: "s1", nombre: "Titulos", activo: true, contenido: "h1{color:red}" },
      { id: "s2", nombre: "Apagado", activo: false, contenido: "p{}" },
    ],
  });
});

test("ya migrado, no pisa nada: ni la apariencia ni los snippets", async () => {
  client.setExecutor(
    indice({
      usuarios: [{ tema: "bioluminiscencia", modo_oscuro: 1, preferencias_json: null }],
      css_snippets: [{ id: "viejo", nombre: "Viejo", activo: 1, contenido: "" }],
    }),
  );
  const prefsAntes = JSON.stringify({ tema: "cantarela", modoOscuro: false, preferencias: {} });
  const snippetsAntes = JSON.stringify({ version: 1, snippets: [] });
  const archivos = mycelium({
    "preferencias.json": prefsAntes,
    "snippets.json": snippetsAntes,
    // Uno que quedó de una migración cortada después de escribir: solo se borra.
    "apariencia.json": JSON.stringify({ tema: "bioluminiscencia", modoOscuro: true }),
  });
  await legado.migrarEstadoLegado(VAULT);

  assert.equal(archivos.get("preferencias.json"), prefsAntes);
  assert.equal(archivos.get("snippets.json"), snippetsAntes);
  assert.equal(archivos.has("apariencia.json"), false);
});

test("un vault nuevo, con un índice nuevo, no escribe nada", async () => {
  client.setExecutor(indice());
  const archivos = mycelium();
  await legado.migrarEstadoLegado(VAULT);
  assert.equal(archivos.size, 0);
});

test("un fallo de la migración no impide abrir el vault", async () => {
  client.setExecutor(null); // sin índice: las consultas lanzan
  mycelium();
  const errores = [];
  const original = console.error;
  console.error = (...a) => errores.push(a);
  try {
    await legado.migrarEstadoLegado(VAULT); // no debe lanzar
  } finally {
    console.error = original;
  }
  assert.ok(errores.length > 0, "el fallo queda registrado");
});

// ── Snippets CSS directo en `.mycelium/snippets.json` ────────────────────────

test("cssStore lee y escribe snippets.json sin pasar por el índice", async () => {
  const archivos = mycelium({
    "snippets.json": JSON.stringify({
      version: 1,
      snippets: [
        { id: "a", nombre: "A", activo: true, contenido: "a{}", creadoEn: "2026-01-01" },
        { id: "roto" }, // sin CSS: se descarta
      ],
    }),
  });
  contexto.setVaultActual(VAULT);
  const css = useCssStore.getState();
  await css.load();
  assert.deepEqual(useCssStore.getState().snippets, [
    { id: "a", nombre: "A", activo: true, contenido: "a{}" },
  ]);

  await useCssStore.getState().toggle("a", false);
  const nuevo = await useCssStore.getState().importSnippet("B", "b{}");
  await useCssStore.getState().rename("a", "A2");
  const guardado = leerJson(archivos, "snippets.json");
  assert.equal(guardado.version, 1);
  assert.deepEqual(guardado.snippets, [
    { id: "a", nombre: "A2", activo: false, contenido: "a{}" },
    { id: nuevo.id, nombre: "B", activo: true, contenido: "b{}" },
  ]);

  await useCssStore.getState().remove("a");
  assert.deepEqual(leerJson(archivos, "snippets.json").snippets.map((s) => s.id), [nuevo.id]);
});

test("sin vault abierto, cssStore queda vacío en vez de fallar", async () => {
  mycelium({ "snippets.json": JSON.stringify({ version: 1, snippets: [{ id: "x", contenido: "" }] }) });
  await useCssStore.getState().load();
  assert.deepEqual(useCssStore.getState().snippets, []);
});
