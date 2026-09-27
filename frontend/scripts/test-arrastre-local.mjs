// Test headless del arrastre local del grafo (`FUN-L-25` · Parte F,
// `DEF-109`): `components/graph/arrastreLocal.ts` (conjunto activo, aristas que
// tocan a los activos y rectángulo sucio). El módulo es puro; se transpila en
// el momento y se importa vía data: URL, como `scripts/test-revelado.mjs`.
//
// Lo que NO se prueba acá: el dibujo sobre la base ni el recorte de la capa en
// el lienzo, ni la física de los congelados (esa está en `test-fisica.mjs`).
// El dibujo lo confirma el usuario en la app.
//
//   node --test scripts/test-arrastre-local.mjs
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import ts from "typescript";

const fuente = await readFile(
  fileURLToPath(new URL("../components/graph/arrastreLocal.ts", import.meta.url)),
  "utf8",
);
const A = await import(
  `data:text/javascript,${encodeURIComponent(
    ts.transpileModule(fuente, {
      compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 },
    }).outputText,
  )}`
);

/**
 * Una cadena 0-1-2-3-4-5 sobre el eje x, de a 100 unidades, más un nodo 6
 * suelto junto al 0 (a 50) y un 7 suelto lejos (a 5.000).
 */
function cadena() {
  const n = 8;
  const pos = new Float64Array(n * 2);
  for (let i = 0; i < 6; i++) pos[i * 2] = i * 100;
  pos[6 * 2 + 1] = 50;
  pos[7 * 2] = 5000;
  const aristas = new Int32Array([0, 1, 1, 2, 2, 3, 3, 4, 4, 5]);
  return { n, pos, aristas };
}

test("adyacencia: vecinos de cada nodo en las dos direcciones", () => {
  const { n, aristas } = cadena();
  const ady = A.adyacencia(n, aristas);
  const vecinosDe = (i) => [...ady.vecinos.slice(ady.inicio[i], ady.inicio[i + 1])].sort();
  assert.deepEqual(vecinosDe(0), [1]);
  assert.deepEqual(vecinosDe(2), [1, 3]);
  assert.deepEqual(vecinosDe(5), [4]);
  assert.deepEqual(vecinosDe(7), []);
});

test("conjuntoActivo: el nodo, sus vecinos a uno y dos saltos, y los cercanos", () => {
  const { n, pos, aristas } = cadena();
  const ady = A.adyacencia(n, aristas);
  // Radio 60: alcanza al 6 (a 50 del 0) y a nadie más por distancia.
  const m = A.conjuntoActivo(0, ady, pos, n, 60);
  assert.deepEqual([...A.indicesActivos(m)], [0, 1, 2, 6]);
  // Desde el medio: dos saltos a cada lado.
  const m2 = A.conjuntoActivo(3, ady, pos, n, 10);
  assert.deepEqual([...A.indicesActivos(m2)], [1, 2, 3, 4, 5]);
});

test("conjuntoActivo: el radio es estricto y la salida se limpia antes", () => {
  const { n, pos, aristas } = cadena();
  const ady = A.adyacencia(n, aristas);
  const salida = new Uint8Array(n).fill(1);
  A.conjuntoActivo(7, ady, pos, n, 50, salida);
  assert.deepEqual([...A.indicesActivos(salida)], [7], "solo, sin vecinos ni nadie a menos de 50");
  // El 6 está a exactamente 50 del 0: con radio 50 no entra, con 50,1 sí.
  assert.equal(A.conjuntoActivo(0, ady, pos, n, 50)[6], 0);
  assert.equal(A.conjuntoActivo(0, ady, pos, n, 50.1)[6], 1);
});

test("aristasQueTocan: las que tienen algún extremo activo, también hacia congelados", () => {
  const { n, aristas } = cadena();
  const m = new Uint8Array(n);
  m[2] = 1;
  assert.deepEqual([...A.aristasQueTocan(m, aristas)], [1, 2]); // 1-2 y 2-3
  m.fill(0);
  assert.deepEqual([...A.aristasQueTocan(m, aristas)], []);
});

test("unirRect y recortarRect: el vacío no suma; bordes enteros hacia afuera, dentro del lienzo", () => {
  const a = { x0: 10, y0: 10, x1: 20, y1: 20 };
  const b = { x0: 15, y0: -5, x1: 30, y1: 12 };
  assert.deepEqual(A.unirRect(a, b), { x0: 10, y0: -5, x1: 30, y1: 20 });
  assert.deepEqual(A.unirRect(A.RECT_VACIO, a), a);
  assert.deepEqual(A.unirRect(a, A.RECT_VACIO), a);
  assert.deepEqual(A.recortarRect({ x0: -3.5, y0: 2.2, x1: 50.1, y1: 7.9 }, 40, 100), { x0: 0, y0: 2, x1: 40, y1: 8 });
  assert.ok(A.rectVacio(A.recortarRect({ x0: 50, y0: 0, x1: 60, y1: 10 }, 40, 100)), "fuera del lienzo");
  assert.ok(A.rectVacio(A.RECT_VACIO));
});

const vista = { scale: 1, ox: 0, oy: 0, dpr: 1, ancho: 1000, alto: 800 };

test("rectSucio: un disco suelto, con el margen, en píxeles del lienzo", () => {
  const pos = Float64Array.of(100, 50);
  const r = A.rectSucio(pos, [10], [-1], [0], [], [], vista, 4);
  // Mundo (100 ± 10, 50 ± 10) → lienzo sumando el centro (500, 400) y el margen.
  assert.deepEqual(r, { x0: 586, y0: 436, x1: 614, y1: 464 });
});

test("rectSucio: zoom, desplazamiento y dpr se aplican como en el dibujo", () => {
  const pos = Float64Array.of(100, 50);
  const r = A.rectSucio(pos, [10], [-1], [0], [], [], { scale: 2, ox: 30, oy: -20, dpr: 1.5, ancho: 1500, alto: 1200 }, 0);
  // px = (x·scale + ox)·dpr + ancho/2
  assert.deepEqual(r, { x0: (90 * 2 + 30) * 1.5 + 750, y0: (40 * 2 - 20) * 1.5 + 600, x1: (110 * 2 + 30) * 1.5 + 750, y1: (60 * 2 - 20) * 1.5 + 600 });
});

test("rectSucio: el nombre ensancha y alarga la caja hacia abajo", () => {
  const pos = Float64Array.of(0, 0);
  const r = A.rectSucio(pos, [5], [100], [0], [], [], vista, 0);
  assert.deepEqual(r, { x0: 450, y0: 395, x1: 550, y1: 400 + 5 + 17 });
});

test("rectSucio: una arista incluye su punto de control (la curva se sale de los extremos)", () => {
  // De (0,0) a (100,0): el control queda en (50, 12), bajo la recta.
  const pos = Float64Array.of(0, 0, 100, 0);
  const r = A.rectSucio(pos, [0, 0], [-1, -1], [], [0, 1], [0], vista, 0);
  assert.deepEqual(r, { x0: 500, y0: 400, x1: 600, y1: 400 + 100 * A.CURVA });
  // Sin nada que dibujar, vacío.
  assert.ok(A.rectVacio(A.rectSucio(pos, [0, 0], [-1, -1], [], [0, 1], [], vista)));
});
