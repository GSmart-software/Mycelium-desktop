// `EVENTO_RECARGA` con las rutas que cambiaron (`FUN-M-58`).
//
// Antes, las reparaciones de enlaces (renombrar, mover, re-enlazar, deshacer)
// avisaban SIN detalle aunque sabían qué notas reescribieron, y todos los
// editores, lienzos, dibujos y diagramas abiertos volvían a leer su archivo del
// disco. Ahora todo pasa por `avisarRecarga`, que lleva las rutas, y solo la
// reconstrucción del índice avisa «todas».
//
//   node --test scripts/test-aviso-recarga.mjs
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import ts from "typescript";

const FRONTEND = join(dirname(fileURLToPath(import.meta.url)), "..");

async function importarTs(ruta) {
  const { outputText } = ts.transpileModule(await readFile(join(FRONTEND, ruta), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  });
  return import(`data:text/javascript,${encodeURIComponent(outputText)}`);
}

globalThis.window = new EventTarget();
const E = await importarTs("lib/eventos.ts");
const R = await importarTs("lib/recargaExterna.ts");

/** Diez editores abiertos que releen el disco con el mismo criterio que la app. */
function editores(ids) {
  const lecturas = [];
  const oyentes = ids.map((id) => (ev) => {
    if (R.avisoTocaA(ev, id)) lecturas.push(id);
  });
  for (const o of oyentes) window.addEventListener(E.EVENTO_RECARGA, o);
  return {
    lecturas,
    soltar: () => oyentes.forEach((o) => window.removeEventListener(E.EVENTO_RECARGA, o)),
  };
}

const ABIERTAS = Array.from({ length: 10 }, (_, i) => `Notas/n${i}.md`);

test("antes: un aviso sin detalle hacía releer a los diez editores", () => {
  const ed = editores(ABIERTAS);
  window.dispatchEvent(new Event(E.EVENTO_RECARGA));
  ed.soltar();
  assert.equal(ed.lecturas.length, 10);
});

test("con las rutas reescritas, relee solo la que está entre ellas", () => {
  const ed = editores(ABIERTAS);
  E.avisarRecarga(["Notas/n3.md", "Cerrada.md"]);
  ed.soltar();
  assert.deepEqual(ed.lecturas, ["Notas/n3.md"]);
});

test("una lista vacía no emite nada", () => {
  let avisos = 0;
  const o = () => avisos++;
  window.addEventListener(E.EVENTO_RECARGA, o);
  E.avisarRecarga([]);
  window.removeEventListener(E.EVENTO_RECARGA, o);
  assert.equal(avisos, 0);
});

test("«todas» sigue llegando a todos (reconstruir el índice)", () => {
  const ed = editores(ABIERTAS);
  E.avisarRecarga("todas");
  ed.soltar();
  assert.equal(ed.lecturas.length, 10);
});

test("la lista emitida es una copia: quien emite puede seguir usando la suya", () => {
  let recibida = null;
  const o = (ev) => (recibida = ev.detail.rutas);
  window.addEventListener(E.EVENTO_RECARGA, o);
  const propia = ["a.md"];
  E.avisarRecarga(propia);
  window.removeEventListener(E.EVENTO_RECARGA, o);
  assert.deepEqual(recibida, ["a.md"]);
  assert.notEqual(recibida, propia);
});

async function fuentes(dir) {
  const salida = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name.startsWith(".") || e.name === "out" || e.name === "src-tauri") continue;
    const ruta = join(dir, e.name);
    if (e.isDirectory()) salida.push(...(await fuentes(ruta)));
    else if (/\.(ts|tsx)$/.test(e.name)) salida.push(ruta);
  }
  return salida;
}

test("nadie emite EVENTO_RECARGA a mano: todo pasa por avisarRecarga", async () => {
  const aMano = [];
  for (const archivo of await fuentes(FRONTEND)) {
    const rel = relative(FRONTEND, archivo).replace(/\\/g, "/");
    if (rel === "lib/eventos.ts") continue;
    const texto = await readFile(archivo, "utf8");
    if (/new (?:Custom)?Event\(\s*EVENTO_RECARGA/.test(texto)) aMano.push(rel);
  }
  assert.deepEqual(aMano, []);
});

test("solo la reconstrucción del índice y el watcher sin rutas avisan «todas»", async () => {
  const conTodas = [];
  for (const archivo of await fuentes(FRONTEND)) {
    const rel = relative(FRONTEND, archivo).replace(/\\/g, "/");
    if (rel === "lib/eventos.ts") continue;
    if (/avisarRecarga\([^;]*"todas"/.test(await readFile(archivo, "utf8"))) conTodas.push(rel);
  }
  assert.deepEqual(conTodas.sort(), ["lib/vaultWatch.ts", "stores/vaultSessionStore.ts"]);
});
