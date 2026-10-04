// Test headless (sin navegador ni Tauri) de la lista de coincidencias del
// buscador de la nota en la vista en vivo (`DEF-125`): las del texto del editor
// más las que se VEN dentro de cada tabla renderizada, en orden, y la navegación
// circular entre ellas. `lib/buscarCoincidencias.ts` no tiene imports en
// runtime, así que se transpila en el momento y se importa vía data: URL, igual
// que el resto de los núcleos del proyecto.
//
//   node --test scripts/test-buscar-tablas.mjs
//   node scripts/test-buscar-tablas.mjs
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import ts from "typescript";

const rutaTs = fileURLToPath(new URL("../lib/buscarCoincidencias.ts", import.meta.url));
const { outputText } = ts.transpileModule(await readFile(rutaTs, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 },
});
const {
  combinarCoincidencias,
  indiceActual,
  indiceSiguiente,
  posicionEnContador,
  posicionesDe,
} = await import(`data:text/javascript,${encodeURIComponent(outputText)}`);

/**
 * Las coincidencias del texto como las da el cursor de CodeMirror sobre el
 * documento: TODO el markdown, también el de la tabla que el widget oculta.
 */
function delTexto(doc, termino) {
  return posicionesDe(doc, termino, false).map((i) => ({ desde: i, hasta: i + termino.length }));
}

// «hola» antes, dos en la tabla (una en el encabezado, otra en una celda con
// negrita), y una después.
const ANTES = "hola mundo\n\n";
const TABLA = "| Hola | B |\n| --- | --- |\n| x | **hola** y hola |";
const DESPUES = "\n\nfin hola";
const DOC = ANTES + TABLA + DESPUES;
const T0 = ANTES.length;
const T1 = T0 + TABLA.length;
const BLOQUE = {
  desde: T0,
  hasta: T1,
  // Lo que muestra cada celda: el markdown ya renderizado, sin `**`.
  celdas: [
    { fila: -1, columna: 0, texto: "Hola" },
    { fila: -1, columna: 1, texto: "B" },
    { fila: 0, columna: 0, texto: "x" },
    { fila: 0, columna: 1, texto: "hola y hola" },
  ],
};

test("posicionesDe: sin solaparse, con y sin distinguir mayúsculas", () => {
  assert.deepEqual(posicionesDe("aaaa", "aa", false), [0, 2]);
  assert.deepEqual(posicionesDe("Hola hola", "hola", false), [0, 5]);
  assert.deepEqual(posicionesDe("Hola hola", "hola", true), [5]);
  assert.deepEqual(posicionesDe("algo", "", false), []);
});

test("las de la tabla se cuentan por lo que se VE, en su lugar del documento", () => {
  const lista = combinarCoincidencias(delTexto(DOC, "hola"), [BLOQUE], "hola", false);
  assert.equal(lista.length, 5);
  // Antes de la tabla: la del texto.
  assert.deepEqual(lista[0], { desde: 0, hasta: 4 });
  // Las tres de la tabla, en orden de lectura y con la n de su celda.
  assert.deepEqual(
    lista.slice(1, 4).map((c) => c.celda),
    [
      { tabla: T0, fila: -1, columna: 0, n: 0 },
      { tabla: T0, fila: 0, columna: 1, n: 0 },
      { tabla: T0, fila: 0, columna: 1, n: 1 },
    ],
  );
  // Después de la tabla: la del texto, y ninguna del markdown oculto.
  assert.equal(lista[4].celda, undefined);
  assert.equal(lista[4].desde, DOC.lastIndexOf("hola"));
});

test("lo que solo está en el markdown de la tabla no cuenta", () => {
  // `---` está en la fila separadora y `**` en la negrita: nada de eso se ve.
  assert.equal(combinarCoincidencias(delTexto(DOC, "---"), [BLOQUE], "---", false).length, 0);
  assert.equal(combinarCoincidencias(delTexto(DOC, "**"), [BLOQUE], "**", false).length, 0);
});

test("sin tablas, la lista es la de CodeMirror tal cual", () => {
  const texto = delTexto(DOC, "hola");
  assert.deepEqual(combinarCoincidencias(texto, [], "hola", false), texto);
});

test("una tabla sin coincidencias en el texto igual aporta las suyas", () => {
  // El término está solo en la celda renderizada (p. ej. `**ho**la` no lo tiene
  // en el markdown): la lista no depende de que CodeMirror la encuentre.
  const bloque = { desde: 10, hasta: 20, celdas: [{ fila: 0, columna: 0, texto: "hola" }] };
  const lista = combinarCoincidencias([], [bloque], "hola", false);
  assert.equal(lista.length, 1);
  assert.deepEqual(lista[0].celda, { tabla: 10, fila: 0, columna: 0, n: 0 });
});

test("navegación: circular, de la tabla al texto y vuelta", () => {
  const lista = combinarCoincidencias(delTexto(DOC, "hola"), [BLOQUE], "hola", false);
  // Sin actual y con el cursor al principio: va a la primera.
  let sel = { from: 0, to: 0 };
  let i = indiceSiguiente(lista, indiceActual(lista, null, sel), sel, true);
  assert.equal(i, 0);
  // Seleccionada la del texto, la siguiente es la primera de la tabla.
  sel = { from: 0, to: 4 };
  assert.equal(indiceActual(lista, null, sel), 0);
  i = indiceSiguiente(lista, 0, sel, true);
  assert.equal(i, 1);
  // Marcada una celda, manda la celda y no la selección (que quedó en el borde).
  sel = { from: T0, to: T0 };
  assert.equal(indiceActual(lista, lista[3].celda, sel), 3);
  assert.equal(indiceSiguiente(lista, 3, sel, true), 4);
  // Del final vuelve al principio, y hacia atrás del principio va al final.
  assert.equal(indiceSiguiente(lista, 4, sel, true), 0);
  assert.equal(indiceSiguiente(lista, 0, sel, false), 4);
});

test("navegación sin actual: desde la selección, como findNext/findPrevious", () => {
  const lista = combinarCoincidencias(delTexto(DOC, "hola"), [BLOQUE], "hola", false);
  const enMedio = { from: 6, to: 6 };
  // Adelante: la primera que arranca en la selección o después (la tabla).
  assert.equal(indiceSiguiente(lista, -1, enMedio, true), 1);
  // Atrás: la última que arranca antes.
  assert.equal(indiceSiguiente(lista, -1, enMedio, false), 0);
  // Pasada la última, da la vuelta.
  const alFinal = { from: DOC.length, to: DOC.length };
  assert.equal(indiceSiguiente(lista, -1, alFinal, true), 0);
  assert.equal(indiceSiguiente([], -1, alFinal, true), -1);
});

test("contador: la actual si la hay; si no, las que arrancan hasta la selección", () => {
  const lista = combinarCoincidencias(delTexto(DOC, "hola"), [BLOQUE], "hola", false);
  assert.equal(posicionEnContador(lista, 2, { from: 0 }), 3);
  assert.equal(posicionEnContador(lista, -1, { from: 0 }), 1);
  assert.equal(posicionEnContador(lista, -1, { from: T1 }), 4);
  assert.equal(posicionEnContador([], -1, { from: 0 }), 0);
});
