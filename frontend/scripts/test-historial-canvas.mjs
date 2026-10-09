// Test headless del historial de deshacer/rehacer del lienzo (`DEF-137`).
// `lib/historialCanvas.ts` es puro —sin imports—, así que se transpila en el
// momento y se importa vía data: URL, igual que `test-canvas.mjs`.
//
//   node --test scripts/test-historial-canvas.mjs
//   node scripts/test-historial-canvas.mjs
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import ts from "typescript";

const rutaTs = fileURLToPath(new URL("../lib/historialCanvas.ts", import.meta.url));
const { outputText } = ts.transpileModule(await readFile(rutaTs, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 },
});
const {
  abrir,
  accionDeTecla,
  cerrar,
  deshacer,
  historialVacio,
  LIMITE_HISTORIAL,
  puedeDeshacer,
  puedeRehacer,
  registrar,
  rehacer,
} = await import(`data:text/javascript,${encodeURIComponent(outputText)}`);

// Documentos de juguete: lo único que el historial hace con ellos es guardarlos
// y compararlos por referencia, como hace el lienzo con sus `Canvas`.
const doc = (nombre) => ({ nombre });
const A = doc("A");
const B = doc("B");
const C = doc("C");

test("un cambio suelto es un paso; deshacer y rehacer vuelven a cada estado", () => {
  let h = registrar(historialVacio(), A, B);
  h = registrar(h, B, C);
  assert.ok(puedeDeshacer(h, C));
  assert.ok(!puedeRehacer(h, C));

  let r = deshacer(h, C);
  assert.equal(r.documento, B);
  r = deshacer(r.historial, B);
  assert.equal(r.documento, A);
  assert.equal(deshacer(r.historial, A), null, "no hay nada antes del primer paso");

  r = rehacer(r.historial, A);
  assert.equal(r.documento, B);
  r = rehacer(r.historial, B);
  assert.equal(r.documento, C);
  assert.equal(rehacer(r.historial, C), null);
});

test("un cambio que no cambia nada no deja paso", () => {
  const h = registrar(historialVacio(), A, A);
  assert.equal(h.pasado.length, 0);
  assert.ok(!puedeDeshacer(h, A));
});

test("un paso nuevo después de deshacer olvida lo deshecho", () => {
  let h = registrar(historialVacio(), A, B);
  const r = deshacer(h, B);
  h = registrar(r.historial, A, C);
  assert.ok(!puedeRehacer(h, C));
  assert.equal(rehacer(h, C), null);
  assert.equal(deshacer(h, C).documento, A);
});

test("un arrastre entero es UN paso, no uno por movimiento", () => {
  let h = abrir(historialVacio(), "arrastre", A);
  // Durante el gesto el documento cambia muchas veces sin tocar el historial.
  const intermedios = Array.from({ length: 50 }, (_, i) => doc(`x${i}`));
  const fin = intermedios.at(-1);
  h = cerrar(h, "arrastre", fin);
  assert.equal(h.pasado.length, 1);
  assert.equal(h.pendiente, null);
  assert.equal(deshacer(h, fin).documento, A);
});

test("un gesto que no cambió nada (un clic en el asa) no deja paso", () => {
  let h = abrir(historialVacio(), "arrastre", A);
  h = cerrar(h, "arrastre", A);
  assert.equal(h.pasado.length, 0);
  assert.equal(h.pendiente, null);
});

test("cerrar con otra clave no cierra el gesto abierto", () => {
  // El blur del texto llega cuando ya empezó el arrastre que lo provocó.
  let h = abrir(historialVacio(), "texto:a", A);
  h = abrir(h, "arrastre", B); // cierra la edición: A → B es un paso
  h = cerrar(h, "texto:a", B); // el blur tardío no toca el arrastre
  assert.equal(h.pendiente?.clave, "arrastre");
  h = cerrar(h, "arrastre", C);
  assert.equal(h.pasado.length, 2);
  let r = deshacer(h, C);
  assert.equal(r.documento, B);
  r = deshacer(r.historial, B);
  assert.equal(r.documento, A);
});

test("abrir dos veces el mismo gesto conserva el estado del principio", () => {
  // Crear una tarjeta de texto abre el gesto antes de crearla; el doble clic
  // posterior en la misma tarjeta no debe correr ese inicio.
  let h = abrir(historialVacio(), "texto:n1", A);
  h = abrir(h, "texto:n1", B);
  h = cerrar(h, "texto:n1", C);
  assert.equal(h.pasado.length, 1);
  assert.equal(deshacer(h, C).documento, A, "deshacer se lleva tarjeta y texto juntos");
});

test("deshacer con un gesto abierto lo cierra primero y lo deshace", () => {
  let h = registrar(historialVacio(), A, B);
  h = abrir(h, "texto:x", B);
  assert.ok(puedeDeshacer(h, C));
  const r = deshacer(h, C);
  assert.equal(r.documento, B);
  assert.equal(r.historial.pendiente, null);
  assert.equal(deshacer(r.historial, B).documento, A);
});

test("un cambio suelto con un gesto abierto cierra el gesto en su lugar", () => {
  let h = abrir(historialVacio(), "texto:x", A);
  h = registrar(h, B, C); // el gesto llevó A → B; el cambio suelto, B → C
  assert.equal(h.pasado.length, 2);
  assert.equal(h.pendiente, null);
  let r = deshacer(h, C);
  assert.equal(r.documento, B);
  r = deshacer(r.historial, B);
  assert.equal(r.documento, A);
});

test("rehacer no aplica si un gesto abierto ya cambió el documento", () => {
  let h = registrar(historialVacio(), A, B);
  h = deshacer(h, B).historial; // en A, con B por rehacer
  h = abrir(h, "arrastre", A);
  assert.ok(!puedeRehacer(h, C));
  assert.equal(rehacer(h, C), null);
  // Si el gesto no cambió nada, rehacer sigue disponible.
  assert.ok(puedeRehacer(h, A));
  assert.equal(rehacer(h, A).documento, B);
});

test("el historial no pasa del límite: se olvidan los pasos más viejos", () => {
  const docs = Array.from({ length: LIMITE_HISTORIAL + 20 }, (_, i) => doc(`d${i}`));
  let h = historialVacio();
  for (let i = 1; i < docs.length; i++) h = registrar(h, docs[i - 1], docs[i]);
  assert.equal(h.pasado.length, LIMITE_HISTORIAL);
  let actual = docs.at(-1);
  let pasos = 0;
  for (;;) {
    const r = deshacer(h, actual);
    if (r === null) break;
    h = r.historial;
    actual = r.documento;
    pasos++;
  }
  assert.equal(pasos, LIMITE_HISTORIAL);
  assert.equal(actual, docs[docs.length - 1 - LIMITE_HISTORIAL]);
});

test("el límite se puede pasar como parámetro", () => {
  let h = historialVacio();
  h = registrar(h, A, B, 2);
  h = registrar(h, B, C, 2);
  h = registrar(h, C, A, 2);
  assert.deepEqual(h.pasado, [B, C]);
});

test("las funciones no mutan el historial que reciben", () => {
  const h0 = registrar(historialVacio(), A, B);
  const copia = { pasado: [...h0.pasado], futuro: [...h0.futuro], pendiente: h0.pendiente };
  registrar(h0, B, C);
  abrir(h0, "g", B);
  deshacer(h0, B);
  rehacer(h0, B);
  assert.deepEqual(h0, copia);
});

test("atajos: Ctrl+Z deshace; Ctrl+Y y Ctrl+Shift+Z rehacen; lo demás no", () => {
  const t = (key, mods = {}) =>
    accionDeTecla({ key, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...mods });
  assert.equal(t("z", { ctrlKey: true }), "deshacer");
  assert.equal(t("Z", { ctrlKey: true, shiftKey: true }), "rehacer");
  assert.equal(t("y", { ctrlKey: true }), "rehacer");
  assert.equal(t("z", { metaKey: true }), "deshacer", "Cmd en macOS");
  assert.equal(t("z"), null, "sin Ctrl es una z");
  assert.equal(t("z", { ctrlKey: true, altKey: true }), null, "AltGr no es deshacer");
  assert.equal(t("Delete", { ctrlKey: true }), null);
  assert.equal(t("Y", { ctrlKey: true, shiftKey: true }), null);
});
