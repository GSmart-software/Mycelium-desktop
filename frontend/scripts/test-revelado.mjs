// Test headless del revelado con niebla del grafo (`FUN-L-25` · Parte E,
// `DEF-109`): `components/graph/revelado.ts` (easing, avance en el tiempo,
// radio a cubrir y anillos del borde difuso). El módulo es puro; se transpila
// en el momento y se importa vía data: URL, como `scripts/test-ciclo.mjs`.
//
// Lo que NO se prueba acá: el dibujo del fundido (recorte y copia de la capa
// en el lienzo). Eso lo confirma el usuario en la app.
//
//   node --test scripts/test-revelado.mjs
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import ts from "typescript";

const fuente = await readFile(
  fileURLToPath(new URL("../components/graph/revelado.ts", import.meta.url)),
  "utf8",
);
const R = await import(
  `data:text/javascript,${encodeURIComponent(
    ts.transpileModule(fuente, {
      compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 },
    }).outputText,
  )}`
);

test("suavizar: de 0 a 1, creciente, sale rápido y se frena al final", () => {
  assert.equal(R.suavizar(0), 0);
  assert.equal(R.suavizar(1), 1);
  assert.equal(R.suavizar(-1), 0);
  assert.equal(R.suavizar(2), 1);
  let antes = 0;
  for (let t = 0.05; t <= 1; t += 0.05) {
    const v = R.suavizar(t);
    assert.ok(v > antes, `creciente en ${t}`);
    antes = v;
  }
  // Ease-out: a mitad de camino ya recorrió más de la mitad, y el último
  // tramo avanza menos que el primero.
  assert.ok(R.suavizar(0.5) > 0.8);
  assert.ok(R.suavizar(1) - R.suavizar(0.9) < R.suavizar(0.1) - R.suavizar(0));
});

test("progresoRevelado: proporcional al tiempo y acotado", () => {
  assert.equal(R.DURACION_REVELADO_MS, 600);
  assert.equal(R.progresoRevelado(0), 0);
  assert.equal(R.progresoRevelado(300), 0.5);
  assert.equal(R.progresoRevelado(600), 1);
  assert.equal(R.progresoRevelado(5000), 1);
  assert.equal(R.progresoRevelado(-10), 0);
  assert.equal(R.progresoRevelado(10, 0), 1); // sin duración: revelado inmediato
});

test("radioMaximo: la esquina más lejana, también con el centro fuera del lienzo", () => {
  assert.equal(R.radioMaximo(50, 50, 100, 100), Math.hypot(50, 50));
  assert.equal(R.radioMaximo(0, 0, 300, 400), 500);
  assert.equal(R.radioMaximo(300, 400, 300, 400), 500);
  assert.equal(R.radioMaximo(-100, 0, 200, 0), 300);
});

test("anillosNiebla: nada al empezar, todo opaco al terminar", () => {
  assert.deepEqual(R.anillosNiebla(0, 1000), []);
  const fin = R.anillosNiebla(1, 1000);
  assert.equal(fin[0].interior, 0);
  assert.equal(fin[0].alfa, 1);
  assert.ok(fin[0].exterior >= 1000, "el disco opaco cubre hasta la esquina más lejana");
});

test("anillosNiebla: coronas contiguas con opacidad decreciente hacia el frente", () => {
  const rMax = 1000;
  const banda = rMax * R.BANDA_NIEBLA;
  for (const avance of [0.05, 0.2, 0.5, 0.8]) {
    const a = R.anillosNiebla(avance, rMax);
    assert.ok(a.length > 0 && a.length <= R.ANILLOS_NIEBLA);
    assert.equal(a[0].interior, 0, "el primero es un disco");
    for (let j = 1; j < a.length; j++) {
      assert.ok(Math.abs(a[j].interior - a[j - 1].exterior) < 1e-9, "sin huecos ni solapes");
      assert.ok(a[j].alfa < a[j - 1].alfa, "más transparente hacia afuera");
    }
    for (const x of a) assert.ok(x.exterior > x.interior && x.alfa > 0 && x.alfa <= 1);
    // El frente (borde exterior del último anillo) avanza con el revelado.
    const frente = avance * (rMax + banda);
    assert.ok(Math.abs(a[a.length - 1].exterior - frente) < 1e-9);
  }
});

test("anillosNiebla: el frente crece de forma monótona con el tiempo", () => {
  let antes = 0;
  for (let t = 0; t <= 600; t += 16) {
    const a = R.anillosNiebla(R.suavizar(R.progresoRevelado(t)), 800);
    const frente = a.length ? a[a.length - 1].exterior : 0;
    assert.ok(frente >= antes);
    antes = frente;
  }
});
