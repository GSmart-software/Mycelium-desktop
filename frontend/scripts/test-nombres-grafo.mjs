// Test headless de la colocación de los nombres del grafo (`DEF-149`):
// `components/graph/nombres.ts` (opacidad según el zoom y rejilla que elige el
// lado de cada nombre sin pisar nodos ni otros nombres). El módulo es puro; se
// transpila en el momento y se importa vía data: URL, como `test-revelado.mjs`.
//
// Lo que NO se prueba acá: el dibujo (halo, fuente, capas). Eso lo confirma el
// usuario en la app.
//
//   node --test scripts/test-nombres-grafo.mjs
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import ts from "typescript";

const fuente = await readFile(
  fileURLToPath(new URL("../components/graph/nombres.ts", import.meta.url)),
  "utf8",
);
const M = await import(
  `data:text/javascript,${encodeURIComponent(
    ts.transpileModule(fuente, {
      compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 },
    }).outputText,
  )}`
);

const ABAJO = 0;
const ARRIBA = 1;
const DERECHA = 2;
const IZQUIERDA = 3;

/** ¿Se tocan dos cajas? */
const seTocan = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
/** ¿La caja pisa el disco? */
const pisaDisco = (c, d) => {
  const px = Math.min(Math.max(d.x, c.x), c.x + c.w);
  const py = Math.min(Math.max(d.y, c.y), c.y + c.h);
  return (d.x - px) ** 2 + (d.y - py) ** 2 < d.r ** 2;
};

test("opacidadNombres: nada lejos, plena cerca, lineal en el medio", () => {
  assert.equal(M.opacidadNombres(0.1), 0);
  assert.equal(M.opacidadNombres(M.ZOOM_NOMBRES_MIN), 0);
  assert.equal(M.opacidadNombres(M.ZOOM_NOMBRES_PLENO), 1);
  assert.equal(M.opacidadNombres(3), 1);
  const medio = (M.ZOOM_NOMBRES_MIN + M.ZOOM_NOMBRES_PLENO) / 2;
  assert.ok(Math.abs(M.opacidadNombres(medio) - 0.5) < 1e-9);
  let antes = 0;
  for (let s = M.ZOOM_NOMBRES_MIN + 0.01; s < M.ZOOM_NOMBRES_PLENO; s += 0.02) {
    const v = M.opacidadNombres(s);
    assert.ok(v > antes && v < 1, `creciente en ${s}`);
    antes = v;
  }
  assert.equal(M.opacidadNombres(Number.NaN), 0);
});

test("solo: el nombre va debajo del nodo, centrado y sin tocarlo", () => {
  const g = new M.RejillaNombres();
  g.agregarDisco(100, 100, 8);
  const c = g.colocar(100, 100, 8, 60);
  assert.equal(c.lado, ABAJO);
  assert.ok(Math.abs(c.x + c.w / 2 - 100) < 1e-9);
  assert.ok(c.y >= 108);
  assert.equal(c.h, M.ALTO_NOMBRE);
  assert.ok(!pisaDisco(c, { x: 100, y: 100, r: 8 }));
});

test("un nodo debajo empuja el nombre arriba (no lo tapa)", () => {
  const g = new M.RejillaNombres();
  const otro = { x: 100, y: 124, r: 8 }; // justo donde iría el nombre
  g.agregarDisco(100, 100, 8);
  g.agregarDisco(otro.x, otro.y, otro.r);
  const c = g.colocar(100, 100, 8, 60);
  assert.equal(c.lado, ARRIBA);
  assert.ok(!pisaDisco(c, otro));
});

test("abajo y arriba ocupados por nodos: va a un costado", () => {
  const g = new M.RejillaNombres();
  g.agregarDisco(100, 100, 8);
  g.agregarDisco(100, 124, 8);
  g.agregarDisco(100, 76, 8);
  const c = g.colocar(100, 100, 8, 60);
  assert.equal(c.lado, DERECHA);
  assert.ok(c.x > 108);
});

test("dos nodos vecinos: los dos nombres se escriben y no se pisan", () => {
  // El caso del defecto: antes el segundo se SALTABA.
  const g = new M.RejillaNombres();
  g.agregarDisco(100, 100, 6);
  g.agregarDisco(130, 100, 6);
  const a = g.colocar(100, 100, 6, 120);
  const b = g.colocar(130, 100, 6, 120);
  assert.ok(a && b);
  assert.ok(!seTocan(a, b), "no se pisan");
  assert.equal(a.lado, ABAJO);
  assert.equal(b.lado, ARRIBA);
});

test("sin ningún lado libre, igual se escribe: mejor sobre un nombre que sobre un nodo", () => {
  const g = new M.RejillaNombres();
  g.agregarDisco(100, 100, 8);
  // Abajo y arriba: nodos. Derecha e izquierda: nombres ya colocados de otros.
  g.agregarDisco(100, 124, 8);
  g.agregarDisco(100, 76, 8);
  const d1 = g.colocar(200, 100, 0, 150); // caja ancha que cruza la derecha del nodo
  const d2 = g.colocar(0, 100, 0, 150); // y la izquierda
  assert.equal(d1.lado, ABAJO);
  assert.equal(d2.lado, ABAJO);
  const c = g.colocar(100, 100, 8, 60);
  assert.ok(c.lado === DERECHA || c.lado === IZQUIERDA, `lado ${c.lado}`);
  assert.ok(!pisaDisco(c, { x: 100, y: 124, r: 8 }));
  assert.ok(!pisaDisco(c, { x: 100, y: 76, r: 8 }));
});

test("el lado preferido se respeta si está libre (no salta entre repintadas)", () => {
  const g = new M.RejillaNombres();
  g.agregarDisco(100, 100, 8);
  const c = g.colocar(100, 100, 8, 60, IZQUIERDA);
  assert.equal(c.lado, IZQUIERDA);
  // Si el preferido está ocupado, vuelve al orden de siempre.
  const h = new M.RejillaNombres();
  h.agregarDisco(100, 100, 8);
  h.agregarDisco(60, 100, 8);
  assert.equal(h.colocar(100, 100, 8, 60, IZQUIERDA).lado, ABAJO);
});

test("rejilla: cajas que cruzan celdas se detectan igual, y limpiar la vacía", () => {
  const g = new M.RejillaNombres(32);
  g.agregarDisco(95, 95, 4); // cerca del borde de varias celdas
  const a = g.colocar(95, 60, 4, 200); // caja larga que atraviesa varias celdas
  const b = g.colocar(95, 60, 4, 200); // misma posición: ya no puede ir donde a
  assert.ok(!seTocan(a, b));
  g.limpiar();
  assert.equal(g.colocar(95, 60, 4, 200).lado, ABAJO);
});

test("muchos nodos: todos tienen caja y ninguna tapa un nodo ajeno si hay sitio", () => {
  // Rejilla de nodos separados 90 px: siempre hay un lado libre.
  const g = new M.RejillaNombres();
  const nodos = [];
  for (let i = 0; i < 20; i++) {
    for (let j = 0; j < 20; j++) nodos.push({ x: i * 90, y: j * 90, r: 6 });
  }
  for (const n of nodos) g.agregarDisco(n.x, n.y, n.r);
  const cajas = nodos.map((n) => g.colocar(n.x, n.y, n.r, 70));
  assert.equal(cajas.length, 400);
  for (let k = 0; k < cajas.length; k++) {
    for (const n of nodos) assert.ok(!pisaDisco(cajas[k], n), `caja ${k} pisa un nodo`);
  }
});
