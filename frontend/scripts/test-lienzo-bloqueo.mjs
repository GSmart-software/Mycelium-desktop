// Test headless de los lienzos bloqueados (`FUN-S-39`): la lista de rutas que
// vive en las preferencias del vault y sigue al lienzo al renombrarlo o moverlo.
// `lib/lienzoBloqueo.ts` es puro —sin imports—, así que se transpila en el
// momento y se importa vía data: URL, igual que `test-historial-canvas.mjs`.
//
//   node --test scripts/test-lienzo-bloqueo.mjs
//   node scripts/test-lienzo-bloqueo.mjs
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import ts from "typescript";

const rutaTs = fileURLToPath(new URL("../lib/lienzoBloqueo.ts", import.meta.url));
const { outputText } = ts.transpileModule(await readFile(rutaTs, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 },
});
const { estaBloqueado, alternarBloqueo, fijarBloqueo, seguirRenombre, seguirCarpeta, normalizarLienzosBloqueados } =
  await import(`data:text/javascript,${encodeURIComponent(outputText)}`);

test("alternar bloquea y desbloquea", () => {
  const una = alternarBloqueo([], "Mapas/Proyecto.canvas");
  assert.deepEqual(una, ["Mapas/Proyecto.canvas"]);
  assert.equal(estaBloqueado(una, "Mapas/Proyecto.canvas"), true);
  assert.equal(estaBloqueado(una, "Otro.canvas"), false);
  assert.deepEqual(alternarBloqueo(una, "Mapas/Proyecto.canvas"), []);
});

test("fijar no cambia la lista si ya estaba así", () => {
  const lista = ["a.canvas"];
  assert.equal(fijarBloqueo(lista, "a.canvas", true), lista);
  assert.equal(fijarBloqueo(lista, "b.canvas", false), lista);
  assert.deepEqual(fijarBloqueo(lista, "b.canvas", true), ["a.canvas", "b.canvas"]);
  assert.deepEqual(fijarBloqueo(lista, "a.canvas", false), []);
});

test("renombrar o mover el lienzo lo sigue", () => {
  const lista = ["Mapas/Viejo.canvas", "Otro.canvas"];
  assert.deepEqual(seguirRenombre(lista, "Mapas/Viejo.canvas", "Archivo/Nuevo.canvas"), [
    "Otro.canvas",
    "Archivo/Nuevo.canvas",
  ]);
  // Un lienzo que no estaba bloqueado: la lista es la misma.
  assert.equal(seguirRenombre(lista, "Suelto.canvas", "Movido.canvas"), lista);
  assert.equal(seguirRenombre(lista, "Otro.canvas", "Otro.canvas"), lista);
  // Si la ruta nueva ya figuraba, no queda repetida.
  assert.deepEqual(seguirRenombre(["a.canvas", "b.canvas"], "a.canvas", "b.canvas"), ["b.canvas"]);
});

test("renombrar o mover la carpeta lleva a los lienzos de adentro, a cualquier profundidad", () => {
  const lista = ["Mapas/A.canvas", "Mapas/Sub/B.canvas", "Mapas2/C.canvas", "D.canvas"];
  assert.deepEqual(seguirCarpeta(lista, "Mapas", "Archivo/Mapas"), [
    "Archivo/Mapas/A.canvas",
    "Archivo/Mapas/Sub/B.canvas",
    "Mapas2/C.canvas",
    "D.canvas",
  ]);
  // `Mapas2` no es parte de `Mapas`: un prefijo de texto no basta.
  const sinTocar = ["Mapas2/C.canvas"];
  assert.equal(seguirCarpeta(sinTocar, "Mapas", "X"), sinTocar);
});

test("lo leído del archivo se sanea", () => {
  assert.deepEqual(normalizarLienzosBloqueados(undefined), []);
  assert.deepEqual(normalizarLienzosBloqueados("a.canvas"), []);
  assert.deepEqual(normalizarLienzosBloqueados({ a: 1 }), []);
  assert.deepEqual(normalizarLienzosBloqueados(["a.canvas", 3, "", "  ", null, "a.canvas", "b.canvas"]), [
    "a.canvas",
    "b.canvas",
  ]);
});
