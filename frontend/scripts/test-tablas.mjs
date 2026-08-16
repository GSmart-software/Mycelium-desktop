// Test headless (sin navegador ni Tauri) del motor de tablas markdown
// (`FUN-L-19`). `lib/tablas.ts` es puro —sin imports—, así que se transpila en
// el momento con el compilador de TypeScript (devDep ya instalada) y se importa
// vía data: URL, igual que el resto de los núcleos del proyecto.
//
//   node --test scripts/test-tablas.mjs
//   node scripts/test-tablas.mjs
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import ts from "typescript";

const rutaTs = fileURLToPath(new URL("../lib/tablas.ts", import.meta.url));
const { outputText } = ts.transpileModule(await readFile(rutaTs, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 },
});
const {
  alinear,
  celdaDe,
  columnasDe,
  eliminarColumna,
  eliminarFila,
  insertarColumna,
  insertarFila,
  moverColumna,
  moverFila,
  parsear,
  ponerCelda,
  serializar,
} = await import(`data:text/javascript,${encodeURIComponent(outputText)}`);

/** Tabla de referencia, ya normalizada (columnas emparejadas). */
const SIMPLE = ["| Uno | Dos |", "| --- | --- |", "| a   | b   |"].join("\n");

/** Atajo: parsear y comprobar que no devolvió null. */
function tabla(md) {
  const t = parsear(md);
  assert.ok(t, `no se pudo parsear:\n${md}`);
  return t;
}

// ── Parseo básico ─────────────────────────────────────────────────────────────

test("encabezado, alineaciones y filas", () => {
  const t = tabla(SIMPLE);
  assert.deepEqual(t.encabezado, ["Uno", "Dos"]);
  assert.deepEqual(t.alineaciones, ["sin", "sin"]);
  assert.deepEqual(t.filas, [["a", "b"]]);
  assert.equal(t.eol, "\n");
  assert.equal(t.sangria, "");
  assert.equal(columnasDe(t), 2);
});

test("las barras de los extremos son opcionales", () => {
  const t = tabla("Uno | Dos\n--- | ---\na | b");
  assert.deepEqual(t.encabezado, ["Uno", "Dos"]);
  assert.deepEqual(t.filas, [["a", "b"]]);
});

test("sin filas de datos también es una tabla", () => {
  const t = tabla("| Uno | Dos |\n| --- | --- |");
  assert.deepEqual(t.filas, []);
  assert.equal(serializar(t), "| Uno | Dos |\n| --- | --- |");
});

test("lo que no es una tabla devuelve null", () => {
  assert.equal(parsear(""), null);
  assert.equal(parsear("una línea suelta"), null);
  assert.equal(parsear("| Uno | Dos |\n| Uno | Dos |"), null); // sin delimitador
  assert.equal(parsear("| Uno | Dos |\n| --- |"), null); // delimitador desparejo
  assert.equal(parsear("| Uno |\n| --- |\ntexto suelto"), null); // fila sin barras
});

test("un delimitador con prefijo distinto por línea no se toca", () => {
  assert.equal(parsear("> | Uno |\n| --- |\n> | a |"), null);
});

// ── El `|` escapado, que es el corazón del asunto ────────────────────────────

test("`\\|` no parte la celda y vuelve escapado al serializar", () => {
  const md = ["| Qué | Nota |", "| --- | --- |", "| a\\|b | x |"].join("\n");
  const t = tabla(md);
  assert.deepEqual(t.filas, [["a|b", "x"]]);
  // La estructura guarda el `|` de verdad; el documento, el escape.
  assert.ok(serializar(t).includes("a\\|b"));
  assert.deepEqual(tabla(serializar(t)).filas, [["a|b", "x"]]);
});

test("wikilink con alias dentro de una celda (el caso de todos los días)", () => {
  const md = [
    "| Nota | Estado |",
    "| --- | --- |",
    "| [[BACKLOG\\|el backlog]] | activo |",
    "| [[Mapa de documentacion]] | — |",
  ].join("\n");
  const t = tabla(md);
  assert.deepEqual(t.filas, [
    ["[[BACKLOG|el backlog]]", "activo"],
    ["[[Mapa de documentacion]]", "—"],
  ]);
  assert.deepEqual(tabla(serializar(t)).filas, t.filas);
});

test("el markdown de la celda viaja entero", () => {
  const t = tabla("| A | B |\n| --- | --- |\n| **negrita** | `a|b` |");
  // Un `|` sin escapar SÍ separa, también dentro de backticks (así lo define GFM):
  // la fila queda con una celda de más y la tabla se ensancha, sin perder texto.
  assert.equal(columnasDe(t), 3);
  assert.deepEqual(t.filas, [["**negrita**", "`a", "b`"]]);
});

// ── Filas irregulares ────────────────────────────────────────────────────────

test("fila corta: se completa con celdas vacías", () => {
  const t = tabla("| A | B | C |\n| --- | --- | --- |\n| 1 |");
  assert.deepEqual(t.filas, [["1", "", ""]]);
});

test("fila larga: la tabla se ensancha y no se pierde texto", () => {
  const t = tabla("| A | B |\n| --- | --- |\n| 1 | 2 | 3 |");
  assert.deepEqual(t.encabezado, ["A", "B", ""]);
  assert.deepEqual(t.alineaciones, ["sin", "sin", "sin"]);
  assert.deepEqual(t.filas, [["1", "2", "3"]]);
  assert.ok(serializar(t).includes("3"));
});

// ── Fin de línea y sangría ───────────────────────────────────────────────────

test("CRLF se preserva", () => {
  const md = SIMPLE.replace(/\n/g, "\r\n");
  const t = tabla(md);
  assert.equal(t.eol, "\r\n");
  assert.equal(serializar(t), md);
  assert.deepEqual(t.encabezado, ["Uno", "Dos"]);
});

test("tabla dentro de una cita/callout: el `> ` se conserva", () => {
  const md = ["> | Uno | Dos |", "> | --- | --- |", "> | a   | b   |"].join("\n");
  const t = tabla(md);
  assert.equal(t.sangria, "> ");
  assert.deepEqual(t.encabezado, ["Uno", "Dos"]);
  assert.equal(serializar(t), md);
  assert.equal(serializar(insertarFila(t, 1)).split("\n").every((l) => l.startsWith("> ")), true);
});

// ── Idempotencia y realineado ────────────────────────────────────────────────

test("serializar(parsear(md)) no cambia una tabla ya normalizada", () => {
  assert.equal(serializar(tabla(SIMPLE)), SIMPLE);
  // El ancho de cada columna es el de su contenido (mínimo 3, lo que ocupa
  // `:-:`), así que una tabla normalizada no tiene relleno de más.
  const conAlineaciones = [
    "| Izq | Centro | Der | Sin |",
    "| :-- | :----: | --: | --- |",
    "| a   | b      | c   | d   |",
  ].join("\n");
  assert.equal(serializar(tabla(conAlineaciones)), conAlineaciones);
});

test("serializar dos veces da lo mismo (punto fijo)", () => {
  const feo = "|Uno|Dos|\n|-|-:|\n|celda muy larga|x|";
  const una = serializar(tabla(feo));
  assert.equal(serializar(tabla(una)), una);
});

test("las columnas se emparejan al serializar", () => {
  const md = serializar(tabla("|A|Bes|\n|-|-|\n|celdita|x|"));
  assert.equal(
    md,
    ["| A       | Bes |", "| ------- | --- |", "| celdita | x   |"].join("\n"),
  );
});

// ── Alineaciones ─────────────────────────────────────────────────────────────

test("las cuatro alineaciones se leen y se escriben", () => {
  const t = tabla("| a | b | c | d |\n| :-- | :-: | --: | --- |\n| 1 | 2 | 3 | 4 |");
  assert.deepEqual(t.alineaciones, ["izquierda", "centro", "derecha", "sin"]);
  const cambiada = alinear(alinear(t, 0, "centro"), 3, "derecha");
  assert.deepEqual(cambiada.alineaciones, ["centro", "centro", "derecha", "derecha"]);
  assert.deepEqual(tabla(serializar(cambiada)).alineaciones, cambiada.alineaciones);
  // La original no se toca: las operaciones son puras.
  assert.deepEqual(t.alineaciones, ["izquierda", "centro", "derecha", "sin"]);
});

test("alinear fuera de rango no hace nada", () => {
  const t = tabla(SIMPLE);
  assert.equal(alinear(t, 9, "centro"), t);
});

// ── Filas: insertar, eliminar, mover ─────────────────────────────────────────

test("insertar fila deja la nueva en el índice pedido", () => {
  const t = tabla("| A | B |\n| --- | --- |\n| 1 | 2 |\n| 3 | 4 |");
  assert.deepEqual(insertarFila(t, 0).filas, [["", ""], ["1", "2"], ["3", "4"]]);
  assert.deepEqual(insertarFila(t, 1).filas, [["1", "2"], ["", ""], ["3", "4"]]);
  assert.deepEqual(insertarFila(t, 99).filas, [["1", "2"], ["3", "4"], ["", ""]]);
});

test("eliminar la última fila deja una tabla válida", () => {
  const t = tabla(SIMPLE);
  const vacia = eliminarFila(t, 0);
  assert.deepEqual(vacia.filas, []);
  const md = serializar(vacia);
  assert.equal(md, "| Uno | Dos |\n| --- | --- |");
  assert.deepEqual(tabla(md).encabezado, ["Uno", "Dos"]);
  // Fuera de rango: la tabla vuelve tal cual.
  assert.equal(eliminarFila(t, 5), t);
});

test("mover fila", () => {
  const t = tabla("| A |\n| --- |\n| 1 |\n| 2 |\n| 3 |");
  assert.deepEqual(moverFila(t, 0, 2).filas, [["2"], ["3"], ["1"]]);
  assert.deepEqual(moverFila(t, 2, 0).filas, [["3"], ["1"], ["2"]]);
  assert.equal(moverFila(t, 0, 0), t);
  assert.equal(moverFila(t, 0, 9), t);
});

// ── Columnas: insertar, eliminar, mover ──────────────────────────────────────

test("insertar columna la agrega en el encabezado y en cada fila", () => {
  const t = insertarColumna(tabla(SIMPLE), 1);
  assert.deepEqual(t.encabezado, ["Uno", "", "Dos"]);
  assert.deepEqual(t.alineaciones, ["sin", "sin", "sin"]);
  assert.deepEqual(t.filas, [["a", "", "b"]]);
  assert.deepEqual(tabla(serializar(t)).filas, [["a", "", "b"]]);
});

test("eliminar columna", () => {
  const t = tabla("| A | B | C |\n| :-- | :-: | --: |\n| 1 | 2 | 3 |");
  const sinB = eliminarColumna(t, 1);
  assert.deepEqual(sinB.encabezado, ["A", "C"]);
  assert.deepEqual(sinB.alineaciones, ["izquierda", "derecha"]);
  assert.deepEqual(sinB.filas, [["1", "3"]]);
});

test("la última columna no se elimina: la tabla no puede quedar inválida", () => {
  const t = tabla("| Sola |\n| --- |\n| a |");
  assert.equal(columnasDe(t), 1);
  assert.equal(eliminarColumna(t, 0), t);
  assert.equal(serializar(t), "| Sola |\n| ---- |\n| a    |");
});

test("mover columna arrastra encabezado, alineación y celdas", () => {
  const t = tabla("| A | B | C |\n| :-- | :-: | --: |\n| 1 | 2 | 3 |");
  const m = moverColumna(t, 0, 2);
  assert.deepEqual(m.encabezado, ["B", "C", "A"]);
  assert.deepEqual(m.alineaciones, ["centro", "derecha", "izquierda"]);
  assert.deepEqual(m.filas, [["2", "3", "1"]]);
});

// ── Celdas ───────────────────────────────────────────────────────────────────

test("ponerCelda escribe datos y encabezado (-1)", () => {
  const t = tabla(SIMPLE);
  assert.deepEqual(ponerCelda(t, 0, 1, "nuevo").filas, [["a", "nuevo"]]);
  assert.deepEqual(ponerCelda(t, -1, 0, "Título").encabezado, ["Título", "Dos"]);
  assert.equal(celdaDe(t, -1, 1), "Dos");
  assert.equal(celdaDe(t, 0, 0), "a");
  // Sin cambio real, sin tabla nueva.
  assert.equal(ponerCelda(t, 0, 0, "a"), t);
  assert.equal(ponerCelda(t, 9, 0, "x"), t);
});

test("una celda no puede partir la tabla en dos", () => {
  const t = ponerCelda(tabla(SIMPLE), 0, 0, " con\nsalto ");
  assert.deepEqual(t.filas, [["con salto", "b"]]);
  assert.equal(serializar(t).split("\n").length, 3);
});

test("un `|` escrito en una celda vuelve escapado al documento", () => {
  const t = ponerCelda(tabla(SIMPLE), 0, 0, "[[Nota|alias]]");
  assert.ok(serializar(t).includes("[[Nota\\|alias]]"));
  assert.deepEqual(tabla(serializar(t)).filas, [["[[Nota|alias]]", "b"]]);
});

// ── Casos borde ──────────────────────────────────────────────────────────────

test("tabla de una sola columna", () => {
  const t = tabla("| Sola |\n| --- |\n| a |\n| b |");
  assert.deepEqual(t.encabezado, ["Sola"]);
  assert.deepEqual(t.filas, [["a"], ["b"]]);
  assert.equal(serializar(t), "| Sola |\n| ---- |\n| a    |\n| b    |");
});

test("celda vacía y celda de solo espacios", () => {
  const t = tabla("| A | B |\n| --- | --- |\n|  |    |");
  assert.deepEqual(t.filas, [["", ""]]);
  assert.equal(serializar(t), "| A   | B   |\n| --- | --- |\n|     |     |");
  assert.deepEqual(tabla(serializar(t)).filas, [["", ""]]);
});

test("encabezado vacío", () => {
  const t = tabla("|  | B |\n| --- | --- |\n| 1 | 2 |");
  assert.deepEqual(t.encabezado, ["", "B"]);
  assert.deepEqual(tabla(serializar(t)).encabezado, ["", "B"]);
});
