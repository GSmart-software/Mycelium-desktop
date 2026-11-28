// Test headless de `lib/posicionPaneles.ts` (`FUN-S-44`): la posición en
// palabras de cada panel, calculada de la geometría del árbol de divisiones, y
// el camino inverso, de un texto como «arriba a la izquierda» al panel. Se
// transpila el módulo en el momento.
//
//   node --test scripts/test-posicion-paneles.mjs
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import ts from "typescript";

const aUrl = (codigo) => `data:text/javascript,${encodeURIComponent(codigo)}`;

async function fuente(ruta) {
  const texto = await readFile(fileURLToPath(new URL(ruta, import.meta.url)), "utf8");
  const { outputText } = ts.transpileModule(texto, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 },
  });
  return aUrl(outputText);
}

const { ubicarPaneles, rectangulos, interpretarPosicion, panelesEnPosicion } = await import(
  await fuente("../lib/posicionPaneles.ts")
);

const hoja = (id) => ({ type: "leaf", id });
const fila = (children, sizes) => ({ type: "split", direction: "row", children, sizes: sizes ?? children.map(() => 1 / children.length) });
const columna = (children, sizes) => ({ type: "split", direction: "column", children, sizes: sizes ?? children.map(() => 1 / children.length) });
const posiciones = (raiz) => ubicarPaneles(raiz).map((p) => p.posicion);

// ── Posiciones ─────────────────────────────────────────────────────────────

test("un solo panel es «único»", () => {
  assert.deepEqual(posiciones(hoja("a")), ["único"]);
});

test("dos lado a lado: izquierda y derecha", () => {
  assert.deepEqual(posiciones(fila([hoja("a"), hoja("b")])), ["izquierda", "derecha"]);
});

test("dos uno sobre otro: arriba y abajo", () => {
  assert.deepEqual(posiciones(columna([hoja("a"), hoja("b")])), ["arriba", "abajo"]);
});

test("un divisor arrastrado al 70/30 no convierte al grande en «centro»", () => {
  assert.deepEqual(posiciones(fila([hoja("a"), hoja("b")], [0.7, 0.3])), ["izquierda", "derecha"]);
});

test("tres en fila, planos o anidados: izquierda, centro, derecha", () => {
  assert.deepEqual(posiciones(fila([hoja("a"), hoja("b"), hoja("c")])), ["izquierda", "centro", "derecha"]);
  assert.deepEqual(posiciones(fila([hoja("a"), fila([hoja("b"), hoja("c")])])), ["izquierda", "centro", "derecha"]);
});

test("cuatro en fila: los del medio comparten «centro»", () => {
  assert.deepEqual(posiciones(fila([hoja("a"), hoja("b"), hoja("c"), hoja("d")])), ["izquierda", "centro", "centro", "derecha"]);
});

test("grilla de 2×2: las cuatro esquinas", () => {
  const raiz = columna([fila([hoja("a"), hoja("b")]), fila([hoja("c"), hoja("d")])]);
  assert.deepEqual(posiciones(raiz), ["arriba a la izquierda", "arriba a la derecha", "abajo a la izquierda", "abajo a la derecha"]);
});

test("una alta a la izquierda y dos a la derecha: solo se nombran los ejes compartidos", () => {
  const raiz = fila([hoja("a"), columna([hoja("b"), hoja("c")])]);
  assert.deepEqual(posiciones(raiz), ["izquierda", "arriba a la derecha", "abajo a la derecha"]);
});

test("una arriba de todo el ancho y tres abajo", () => {
  const raiz = columna([hoja("a"), fila([hoja("b"), hoja("c"), hoja("d")])]);
  assert.deepEqual(posiciones(raiz), ["arriba", "abajo a la izquierda", "abajo al centro", "abajo a la derecha"]);
});

test("grilla de 3×3: la del medio es «centro» y las laterales «centro a la …»", () => {
  const filaDe3 = (p) => fila([hoja(`${p}1`), hoja(`${p}2`), hoja(`${p}3`)]);
  const raiz = columna([filaDe3("a"), filaDe3("b"), filaDe3("c")]);
  assert.deepEqual(posiciones(raiz).slice(3, 6), ["centro a la izquierda", "centro", "centro a la derecha"]);
});

test("los rectángulos se calculan con las fracciones y se normalizan", () => {
  const r = rectangulos(fila([hoja("a"), columna([hoja("b"), hoja("c")], [1, 3])], [2, 2]));
  assert.deepEqual(r.map((x) => x.id), ["a", "b", "c"]);
  assert.deepEqual(r[0].rect, { x: 0, y: 0, ancho: 0.5, alto: 1 });
  assert.deepEqual(r[1].rect, { x: 0.5, y: 0, ancho: 0.5, alto: 0.25 });
  assert.deepEqual(r[2].rect, { x: 0.5, y: 0.25, ancho: 0.5, alto: 0.75 });
});

// ── Texto → panel ──────────────────────────────────────────────────────────

const grilla = ubicarPaneles(columna([fila([hoja("a"), hoja("b")]), fila([hoja("c"), hoja("d")])]));
const enL = ubicarPaneles(fila([hoja("a"), columna([hoja("b"), hoja("c")])]));
const tres = ubicarPaneles(fila([hoja("a"), hoja("b"), hoja("c")]));

test("tolera mayúsculas, tildes, orden y sinónimos", () => {
  for (const t of [
    "arriba a la izquierda",
    "Arriba Izquierda",
    "izquierda arriba",
    "superior izquierdo",
    "SUPERIOR-IZQUIERDA",
    "la de arriba a la izquierda",
  ]) {
    assert.deepEqual(panelesEnPosicion(t, grilla), [0], t);
  }
  assert.deepEqual(panelesEnPosicion("centro inferior", ubicarPaneles(columna([hoja("a"), fila([hoja("b"), hoja("c"), hoja("d")])]))), [2]);
  assert.deepEqual(panelesEnPosicion("la de la derecha", tres), [2]);
  assert.deepEqual(panelesEnPosicion("Centro", tres), [1]);
  assert.deepEqual(panelesEnPosicion("del medio", tres), [1]);
});

test("una posición parcial que abarca varios paneles los devuelve a todos (AMBIGUO)", () => {
  assert.deepEqual(panelesEnPosicion("derecha", grilla), [1, 3]);
  assert.deepEqual(panelesEnPosicion("inferior", grilla), [2, 3]);
  assert.deepEqual(panelesEnPosicion("derecha", enL), [1, 2]);
  assert.deepEqual(panelesEnPosicion("izquierda", enL), [0]);
  assert.deepEqual(panelesEnPosicion("abajo derecha", enL), [2]);
});

test("lo que no coincide con ningún panel es una lista vacía", () => {
  assert.deepEqual(panelesEnPosicion("abajo", tres), []);
  assert.deepEqual(panelesEnPosicion("centro", grilla), []);
  assert.deepEqual(panelesEnPosicion("izquierda", ubicarPaneles(hoja("a"))), []);
});

test("«único» solo con un panel; un número escrito vale como número", () => {
  assert.deepEqual(panelesEnPosicion("único", ubicarPaneles(hoja("a"))), [0]);
  assert.deepEqual(panelesEnPosicion("unico", tres), []);
  assert.deepEqual(panelesEnPosicion("2", tres), [1]);
  assert.deepEqual(panelesEnPosicion(" 7 ", tres), []);
});

test("lo que no es una posición, o se contradice, no se interpreta", () => {
  assert.equal(interpretarPosicion("el de las notas"), null);
  assert.equal(interpretarPosicion("izquierda derecha"), null);
  assert.equal(interpretarPosicion("arriba abajo"), null);
  assert.equal(interpretarPosicion("   "), null);
  assert.equal(panelesEnPosicion("cualquiera", tres), null);
});
