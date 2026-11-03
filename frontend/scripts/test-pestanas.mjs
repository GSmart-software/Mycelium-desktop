// Test headless del árbol de pestañas (`stores/tabsStore.ts`) en lo que tocan
// `FUN-S-34` (un enlace abierto en pestaña nueva hereda el historial) y
// `FUN-S-35` («Dividir» muestra el mismo archivo en los dos lados). Se
// transpilan el store y `lib/pestanas.ts` en el momento, con los módulos que
// tocan Tauri o íconos reemplazados por stubs; zustand es el de verdad.
//
//   node --test scripts/test-pestanas.mjs
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

// Un `data:` no resuelve paquetes: zustand va por su ruta absoluta.
const ZUSTAND = pathToFileURL(require.resolve("zustand")).href;
const ZUSTAND_MW = pathToFileURL(require.resolve("zustand/middleware")).href;

const ICONOS = aUrl(
  ["ICONO_CALENDARIO", "ICONO_CONSOLA", "ICONO_GRAFO", "ICONO_OTRO_ARCHIVO", "ICONO_REFERENCIAS", "ICONO_SALUD"]
    .map((n) => `export const ${n} = {};`)
    .join("\n") + "\nexport const ICONO_POR_TIPO = {};",
);
const OTROS = aUrl(`
export const esTabArchivo = (id) => id.startsWith("archivo:");
export const rutaDeTabArchivo = (id) => id.slice("archivo:".length);
export const nombreDeRuta = (r) => r.split("/").pop();`);
const TERMINAL = aUrl(`
export const esTabTerminal = (id) => id.startsWith("terminal:");
export const termIdDe = (id) => id.slice("terminal:".length);`);
const PREFS = aUrl(`
export const prefs = { previewTabs: false };
export const usePreferencesStore = { getState: () => ({ prefs }) };`);

const PESTANAS = await fuente("../lib/pestanas.ts", {
  "@/lib/iconosDeTipo": ICONOS,
  "@/lib/otrosArchivos": OTROS,
  "@/lib/terminalBase": TERMINAL,
});
const HISTORIAL = await fuente("../lib/historialPestana.ts");
const STORE = await fuente("../stores/tabsStore.ts", {
  zustand: ZUSTAND,
  "zustand/middleware": ZUSTAND_MW,
  "@/lib/pestanas": PESTANAS,
  "@/lib/historialPestana": HISTORIAL,
  "@/stores/preferencesStore": PREFS,
});

const { seDuplicaAlDividir, tipoDePestana, esSentinela, tituloDePestana, SALUD_TAB_ID } = await import(PESTANAS);
const { useTabsStore, allLeaves } = await import(STORE);

const estado = () => useTabsStore.getState();
const hojas = () => allLeaves(estado().root);

/** Arranca de cero con las notas abiertas, en orden, en un solo pane. */
function conNotas(...ids) {
  useTabsStore.setState(useTabsStore.getInitialState());
  for (const id of ids) estado().openNote(id);
  return hojas()[0];
}

const activa = (pane) => pane.tabs.find((t) => t.id === pane.activeTabId);

test("seDuplicaAlDividir: notas y bases sí; lienzos, dibujos, diagramas y sentinelas no", () => {
  assert.equal(seDuplicaAlDividir("a.md"), true);
  assert.equal(seDuplicaAlDividir("a.md", "markdown"), true);
  assert.equal(seDuplicaAlDividir("t.base", "base"), true);
  assert.equal(seDuplicaAlDividir("l.canvas", "canvas"), false);
  assert.equal(seDuplicaAlDividir("d.excalidraw", "excalidraw"), false);
  assert.equal(seDuplicaAlDividir("d.drawio", "drawio"), false);
  assert.equal(seDuplicaAlDividir("terminal:1"), false);
  assert.equal(seDuplicaAlDividir("archivo:foto.png"), false);
  assert.equal(seDuplicaAlDividir("graph:global"), false);
  assert.equal(seDuplicaAlDividir("calendario:global"), false);
  assert.equal(seDuplicaAlDividir("salud:global"), false);
});

test("la pestaña de salud del vault (FUN-L-32) es sentinela, con su título, y no se descarta al reconciliar", () => {
  assert.equal(SALUD_TAB_ID, "salud:global");
  assert.equal(tipoDePestana(SALUD_TAB_ID), "salud");
  assert.equal(esSentinela(SALUD_TAB_ID), true);
  assert.equal(tituloDePestana(SALUD_TAB_ID, [], {}), "Salud del vault");
  const pane = conNotas("a.md", SALUD_TAB_ID);
  assert.equal(activa(pane).preview, false, "no es pestaña de preview");
  estado().reconcileNotes(new Set(["a.md"]));
  assert.deepEqual(hojas()[0].tabs.map((t) => t.notaId), ["a.md", SALUD_TAB_ID]);
});

test("Dividir con duplicar deja la nota en los dos panes, aunque el pane tenga varias pestañas", () => {
  const pane = conNotas("a.md", "b.md");
  estado().splitActivePane(pane.id, "right", true);
  const [izq, der] = hojas();
  assert.deepEqual(izq.tabs.map((t) => t.notaId), ["a.md", "b.md"]);
  assert.equal(activa(izq).notaId, "b.md");
  assert.deepEqual(der.tabs.map((t) => t.notaId), ["b.md"]);
  assert.notEqual(der.tabs[0].id, activa(izq).id, "cada lado es su propia instancia");
  assert.equal(estado().activePaneId, der.id);
});

test("Dividir sin duplicar mueve la pestaña, como antes", () => {
  const pane = conNotas("a.md", "l.canvas");
  estado().splitActivePane(pane.id, "bottom", false);
  const [arriba, abajo] = hojas();
  assert.deepEqual(arriba.tabs.map((t) => t.notaId), ["a.md"]);
  assert.deepEqual(abajo.tabs.map((t) => t.notaId), ["l.canvas"]);
});

test("la copia de Dividir conserva el historial de la pestaña", () => {
  const pane = conNotas("a.md");
  estado().abrirEnPestanaNueva("b.md", { foco: true });
  estado().splitActivePane(pane.id, "right", true);
  const der = hojas()[1];
  assert.equal(estado().destinoHistorial(der.id, -1), "a.md");
});

test("Ctrl+clic: la pestaña nueva nace al lado, con foco, y Atrás vuelve al origen", () => {
  const pane = conNotas("a.md", "x.md");
  estado().activateTab(pane.id, pane.tabs[0].id);
  estado().abrirEnPestanaNueva("b.md", { foco: true, origen: { paneId: pane.id, tabId: pane.tabs[0].id } });
  const despues = hojas()[0];
  assert.deepEqual(despues.tabs.map((t) => t.notaId), ["a.md", "b.md", "x.md"]);
  assert.equal(activa(despues).notaId, "b.md");
  assert.equal(estado().destinoHistorial(despues.id, -1), "a.md");
  // El origen no cambió de línea.
  assert.deepEqual(despues.tabs[0].historial, ["a.md"]);
  estado().navegarHistorial(despues.id, -1);
  assert.equal(activa(hojas()[0]).notaId, "a.md");
});

test("rueda en un enlace: segundo plano, la pestaña activa no cambia", () => {
  const pane = conNotas("a.md");
  const antes = pane.activeTabId;
  estado().abrirEnPestanaNueva("b.md", { foco: false });
  const despues = hojas()[0];
  assert.equal(despues.activeTabId, antes);
  const nueva = despues.tabs.find((t) => t.notaId === "b.md");
  assert.deepEqual(nueva.historial, ["a.md", "b.md"]);
});

test("rueda en la flecha Atrás: pestaña nueva con la línea entera, parada en el paso", () => {
  const pane = conNotas("a.md");
  estado().abrirEnPestanaNueva("b.md", { foco: true });
  estado().abrirPasoAparte(pane.id, -1);
  const despues = hojas()[0];
  assert.equal(activa(despues).notaId, "b.md", "la actual no se mueve");
  const ultima = despues.tabs.at(-1);
  assert.equal(ultima.notaId, "a.md");
  assert.deepEqual(ultima.historial, ["a.md", "b.md"]);
  assert.equal(ultima.indice, 0);
});

test("desde una consola, la pestaña nueva arranca su propia línea", () => {
  const pane = conNotas("terminal:1");
  estado().abrirEnPestanaNueva("b.md", { foco: true, origen: { paneId: pane.id, tabId: pane.tabs[0].id } });
  assert.equal(estado().destinoHistorial(hojas()[0].id, -1), null);
});
