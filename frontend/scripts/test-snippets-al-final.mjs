// Los snippets CSS siguen ganando cuando una hoja llega tarde (`FUN-M-58`).
//
// Desde que KaTeX y Excalidraw no van en el layout raíz, sus hojas entran al
// `<head>` cuando se carga su trozo, detrás del `<style>` de los snippets, y le
// ganarían a una regla del usuario de la misma especificidad. `snippetsAlFinal`
// vuelve a poner los snippets últimos.
//
//   node --test scripts/test-snippets-al-final.mjs
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import ts from "typescript";

const { outputText } = ts.transpileModule(
  await readFile(new URL("../lib/snippetsAlFinal.ts", import.meta.url), "utf8"),
  { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } },
);
const S = await import(`data:text/javascript,${encodeURIComponent(outputText)}`);

const nodo = (tagName, id = "", rel = null) => ({ tagName, id, getAttribute: (n) => (n === "rel" ? rel : null) });
function cabeza(...hijos) {
  const lista = [...hijos];
  return {
    get children() {
      return lista;
    },
    appendChild(n) {
      const i = lista.indexOf(n);
      if (i !== -1) lista.splice(i, 1);
      lista.push(n);
    },
    orden: () => lista.map((n) => n.id || `${n.tagName}`),
  };
}

test("una hoja que llega detrás de los snippets los devuelve al final, en su orden", () => {
  const h = cabeza(
    nodo("LINK", "app", "stylesheet"),
    nodo("STYLE", "mic-custom-css"),
    nodo("STYLE", "mic-css-preview"),
    nodo("LINK", "excalidraw", "stylesheet"),
  );
  assert.equal(S.snippetsAlFinal(h), true);
  assert.deepEqual(h.orden(), ["app", "excalidraw", "mic-custom-css", "mic-css-preview"]);
  // Ya están últimos: la segunda vuelta (la que dispara el propio movimiento) no hace nada.
  assert.equal(S.snippetsAlFinal(h), false);
});

test("lo que no es una hoja (un script, una precarga) no los mueve", () => {
  const h = cabeza(nodo("STYLE", "mic-custom-css"), nodo("SCRIPT", "s"), nodo("LINK", "fuente", "preload"));
  assert.equal(S.snippetsAlFinal(h), false);
  assert.deepEqual(h.orden(), ["mic-custom-css", "s", "fuente"]);
});

test("sin snippets no hay nada que mover", () => {
  const h = cabeza(nodo("LINK", "a", "stylesheet"), nodo("STYLE", "b"));
  assert.equal(S.snippetsAlFinal(h), false);
});

test("un `<style>` de otra hoja que llega tarde también cuenta", () => {
  const h = cabeza(nodo("STYLE", "mic-custom-css"), nodo("STYLE", ""));
  assert.equal(S.snippetsAlFinal(h), true);
  assert.equal(h.orden().at(-1), "mic-custom-css");
});
