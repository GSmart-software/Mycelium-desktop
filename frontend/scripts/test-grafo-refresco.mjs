// Test headless del refresco del grafo tras un guardado (`FUN-M-58`):
//
//   - `mismoGrafo` (`lib/grafoEquivalente.ts`): mismos nodos —id, título, grado,
//     etiquetas, fecha— y mismas aristas, en el mismo orden; cualquier diferencia
//     cuenta;
//   - `useGraphStore.fetch` conserva el objeto `data` anterior si la respuesta
//     dibuja lo mismo —así `MiniGraph`, que depende de sus arrays, no rehace el
//     layout ni vacía el lienzo— y lo reemplaza si cambió un enlace.
//
// Que el editor marque el grafo `stale` solo cuando cambian los enlaces sale de
// `putContenido` (`enlacesCambiaron`), probado con SQLite en
// `scripts/test-enlaces-nota.mjs`. Lo visible (el lienzo que ya no parpadea) lo
// confirma el usuario en la app.
//
//   node --test scripts/test-grafo-refresco.mjs
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { test } from "node:test";
import ts from "typescript";

const aUrl = (codigo) => `data:text/javascript,${encodeURIComponent(codigo)}`;
const ZUSTAND = pathToFileURL(fileURLToPath(new URL("../node_modules/zustand/esm/index.mjs", import.meta.url))).href;

async function fuente(ruta, mapa = {}) {
  const texto = await readFile(fileURLToPath(new URL(ruta, import.meta.url)), "utf8");
  let { outputText } = ts.transpileModule(texto, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  });
  for (const [especificador, url] of Object.entries(mapa)) {
    outputText = outputText.split(`"${especificador}"`).join(`"${url}"`);
  }
  return aUrl(outputText);
}

const EQUIVALENTE = await fuente("../lib/grafoEquivalente.ts");
const { mismoGrafo } = await import(EQUIVALENTE);
// `api` devuelve lo que el test deja en `globalThis.__grafo` (una copia nueva cada vez).
const API = aUrl(`
export class ApiError extends Error {}
export async function api() { globalThis.__pedidos++; return structuredClone(globalThis.__grafo); }
`);
const AUTH = aUrl(`export const useAuthStore = { getState: () => ({ accessToken: null }) };`);
const { useGraphStore } = await import(
  await fuente("../stores/graphStore.ts", {
    zustand: ZUSTAND,
    "@/lib/api": API,
    "@/lib/grafoEquivalente": EQUIVALENTE,
    "@/stores/authStore": AUTH,
  })
);

const GRAFO = {
  nodos: [
    { id: "A.md", titulo: "A", conexiones: 2, tags: ["x"], creadoEn: "2026-01-01" },
    { id: "B.md", titulo: "B", conexiones: 1, tags: [], creadoEn: "2026-01-02" },
    { id: "C.md", titulo: "C", conexiones: 1, tags: [], creadoEn: "2026-01-03" },
  ],
  aristas: [
    { source: "A.md", target: "B.md" },
    { source: "C.md", target: "A.md" },
  ],
};

test("mismoGrafo: igual contenido en arrays nuevos es el mismo grafo; cualquier cambio no", () => {
  assert.equal(mismoGrafo(GRAFO, structuredClone(GRAFO)), true);
  const con = (f) => {
    const g = structuredClone(GRAFO);
    f(g);
    return mismoGrafo(GRAFO, g);
  };
  assert.equal(con((g) => g.aristas.push({ source: "B.md", target: "C.md" })), false, "arista nueva");
  assert.equal(con((g) => (g.aristas[0].target = "C.md")), false, "otro destino");
  assert.equal(con((g) => (g.nodos[1].conexiones = 2)), false, "otro grado");
  assert.equal(con((g) => (g.nodos[0].titulo = "A2")), false, "otro título");
  assert.equal(con((g) => g.nodos[0].tags.push("y")), false, "otra etiqueta");
  assert.equal(con((g) => (g.nodos[0].tags = ["z"])), false, "etiqueta distinta");
  assert.equal(con((g) => (g.nodos[2].creadoEn = "2026-02-01")), false, "otra fecha (orden de aparición)");
  assert.equal(con((g) => g.nodos.reverse()), false, "otro orden");
  // Sin etiquetas ni fecha (el mini-grafo del panel): se comparan igual.
  const mini = { nodos: [{ id: "A.md", titulo: "A", conexiones: 1 }], aristas: [] };
  assert.equal(mismoGrafo(mini, structuredClone(mini)), true);
});

test("useGraphStore.fetch: un refresco con lo mismo conserva `data`; un enlace nuevo lo reemplaza", async () => {
  globalThis.__pedidos = 0;
  globalThis.__grafo = GRAFO;
  const s = useGraphStore.getState;
  await s().fetch("vault");
  const primero = s().data;
  assert.deepEqual(primero, GRAFO);

  // Un guardado que no cambió enlaces (o un cambio de afuera que tampoco).
  s().markStale();
  await s().fetch("vault", { force: true });
  assert.equal(globalThis.__pedidos, 2);
  assert.equal(s().data, primero, "el MISMO objeto: MiniGraph no se reinicia");
  assert.equal(s().stale, false);

  // Un enlace nuevo.
  const conEnlace = structuredClone(GRAFO);
  conEnlace.aristas.push({ source: "B.md", target: "C.md" });
  conEnlace.nodos[1].conexiones = 2;
  conEnlace.nodos[2].conexiones = 2;
  globalThis.__grafo = conEnlace;
  s().markStale();
  await s().fetch("vault", { force: true });
  assert.notEqual(s().data, primero);
  assert.deepEqual(s().data, conEnlace);

  // Otro vault con el mismo contenido: no se reusa lo del anterior.
  const previo = s().data;
  await s().fetch("otro", { force: true });
  assert.notEqual(s().data, previo);
  s().reset();
});
