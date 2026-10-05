// Test headless del árbol del explorador en vivo (`lib/arbolVivo.ts`, FUN-M-42):
// aplicar al árbol los cambios del watcher sin esperar al índice, la
// reconciliación contra un recorrido del disco y el registro de pendientes que
// `loadTree` vuelve a aplicar sobre lo que lee del índice. El módulo es puro
// (solo importa tipos), así que se transpila en el momento.
//
//   node --test scripts/test-arbol-vivo.mjs
import assert from "node:assert/strict";
import { test } from "node:test";
import { importarTs } from "./lib-vault-fixture.mjs";

const {
  aplicarCambios,
  diferenciasConDisco,
  compararNocase,
  tipoDeNotaPorRuta,
  anotarPendientes,
  quitarPendientes,
  pendientesActuales,
  vaciarPendientes,
} = await importarTs("lib/arbolVivo.ts");

const carpeta = (id) => {
  const i = id.lastIndexOf("/");
  return { id, padreId: i === -1 ? null : id.slice(0, i), nombre: id.slice(i + 1) };
};
const nota = (id, tipo = "markdown") => {
  const i = id.lastIndexOf("/");
  return {
    id,
    carpetaId: i === -1 ? null : id.slice(0, i),
    titulo: id.slice(i + 1).replace(/\.[^.]+$/, ""),
    tipo,
    actualizadoEn: "2026-10-04T00:00:00.000Z",
  };
};
const otro = (ruta) => {
  const i = ruta.lastIndexOf("/");
  const nombre = ruta.slice(i + 1);
  return { ruta, nombre, extension: nombre.slice(nombre.lastIndexOf(".") + 1), carpetaId: i === -1 ? null : ruta.slice(0, i) };
};
const cambio = (ruta, estado, tipo = "", mtime = 1_700_000_000_000) => ({ ruta, estado, tipo, mtime });

/** Un árbol como lo deja `loadTree`: carpetas y notas ordenadas como `COLLATE NOCASE`. */
function arbol({ carpetas = [], notas = [], otros = [] } = {}) {
  return {
    carpetas: carpetas.map(carpeta).sort((a, b) => compararNocase(a.nombre, b.nombre)),
    notas: notas.map((n) => (typeof n === "string" ? nota(n) : n)).sort((a, b) => compararNocase(a.titulo, b.titulo)),
    otros: otros.map(otro),
  };
}

const ids = (lista) => lista.map((x) => x.id ?? x.ruta);

test("una nota nueva entra al instante, en su lugar del orden y con sus carpetas", () => {
  const antes = arbol({ notas: ["Alfa.md", "zeta.md"] });
  const r = aplicarCambios(antes, [cambio("Proyectos/2026/beta.md", "nota", "markdown")]);
  assert.deepEqual(ids(r.notas), ["Alfa.md", "Proyectos/2026/beta.md", "zeta.md"]);
  // Por nombre, como `tree()`: «2026» antes que «Proyectos».
  assert.deepEqual(ids(r.carpetas), ["Proyectos/2026", "Proyectos"]);
  const beta = r.notas[1];
  assert.equal(beta.titulo, "beta");
  assert.equal(beta.carpetaId, "Proyectos/2026");
  assert.equal(beta.tipo, "markdown");
  // El árbol de entrada no se tocó.
  assert.deepEqual(ids(antes.notas), ["Alfa.md", "zeta.md"]);
  assert.deepEqual(antes.carpetas, []);
});

test("aplicar lo que ya está no cambia nada (un guardado propio, o reaplicar pendientes)", () => {
  const antes = arbol({ carpetas: ["A"], notas: ["A/x.md"], otros: ["A/foto.png"] });
  assert.equal(aplicarCambios(antes, [cambio("A/x.md", "nota", "markdown")]), null);
  assert.equal(aplicarCambios(antes, [cambio("A", "carpeta"), cambio("A/foto.png", "otro", "png")]), null);
  assert.equal(aplicarCambios(antes, [cambio("no-estaba.md", "ausente")]), null);
  // Y dos veces lo mismo: la segunda es nula.
  const una = aplicarCambios(antes, [cambio("B/y.drawio", "nota", "drawio")]);
  assert.equal(aplicarCambios(una, [cambio("B/y.drawio", "nota", "drawio")]), null);
});

test("las listas que no cambian conservan su referencia", () => {
  const antes = arbol({ carpetas: ["A"], notas: ["A/x.md"], otros: ["A/foto.png"] });
  const r = aplicarCambios(antes, [cambio("A/doc.pdf", "otro", "pdf")]);
  assert.equal(r.notas, antes.notas);
  assert.equal(r.carpetas, antes.carpetas);
  assert.notEqual(r.otros, antes.otros);
  assert.deepEqual(ids(r.otros), ["A/foto.png", "A/doc.pdf"]);
  assert.equal(r.otros[1].extension, "pdf");
  assert.equal(r.otros[1].carpetaId, "A");
});

test("una carpeta que se va se lleva todo lo que tenía adentro", () => {
  const antes = arbol({
    carpetas: ["A", "A/sub", "Ab"],
    notas: ["A/x.md", "A/sub/y.md", "Ab/z.md", "suelta.md"],
    otros: ["A/sub/foto.png", "Ab/doc.pdf"],
  });
  const r = aplicarCambios(antes, [cambio("A", "ausente")]);
  assert.deepEqual(ids(r.carpetas), ["Ab"], "`Ab` no cuelga de `A`");
  assert.deepEqual(ids(r.notas).sort(), ["Ab/z.md", "suelta.md"]);
  assert.deepEqual(ids(r.otros), ["Ab/doc.pdf"]);
});

test("un renombrado (origen ausente, destino nota) mueve la nota", () => {
  const antes = arbol({ carpetas: ["A"], notas: ["A/vieja.md", "Otra.md"] });
  const r = aplicarCambios(antes, [cambio("A/vieja.md", "ausente"), cambio("A/Nueva.md", "nota", "markdown")]);
  assert.deepEqual(ids(r.notas), ["A/Nueva.md", "Otra.md"]);
  // Una carpeta renombrada: el origen se va con su contenido y el destino llega
  // expandido por el watcher.
  const r2 = aplicarCambios(r, [
    cambio("A", "ausente"),
    cambio("B", "carpeta"),
    cambio("B/Nueva.md", "nota", "markdown"),
  ]);
  assert.deepEqual(ids(r2.carpetas), ["B"]);
  assert.deepEqual(ids(r2.notas), ["B/Nueva.md", "Otra.md"]);
});

test("una ruta que cambia de clase reemplaza a la anterior", () => {
  // Un archivo que pasa a ser carpeta, y una carpeta que pasa a ser archivo.
  const antes = arbol({ carpetas: ["C"], notas: ["X", "C/y.md"] });
  const r = aplicarCambios(antes, [cambio("X", "carpeta"), cambio("C", "otro", "")]);
  assert.deepEqual(ids(r.carpetas), ["X"]);
  assert.deepEqual(ids(r.notas), []);
  assert.deepEqual(ids(r.otros), ["C"]);
  // Una nota con el tipo equivocado en el árbol se corrige con el del disco.
  const n = aplicarCambios(arbol({ notas: [nota("d.canvas", "markdown")] }), [cambio("d.canvas", "nota", "canvas")]);
  assert.equal(n.notas[0].tipo, "canvas");
  assert.equal(n.notas.length, 1);
});

test("el orden es el de COLLATE NOCASE de SQLite", () => {
  assert.ok(compararNocase("a", "B") < 0);
  assert.ok(compararNocase("Zeta", "alfa") > 0);
  assert.ok(compararNocase("_x", "A") < 0, "`_` va antes que las letras, como en SQLite");
  assert.equal(compararNocase("Hola", "hOLA"), 0);
  assert.ok(compararNocase("plan", "plan 2") < 0);
  const r = aplicarCambios(arbol({ carpetas: ["beta", "Delta"] }), [cambio("Alfa", "carpeta"), cambio("charlie", "carpeta")]);
  assert.deepEqual(ids(r.carpetas), ["Alfa", "beta", "charlie", "Delta"]);
});

test("el tipo de nota por extensión, como `tipo_de` en Rust", () => {
  assert.equal(tipoDeNotaPorRuta("a/b.md"), "markdown");
  assert.equal(tipoDeNotaPorRuta("a/b.MD"), "markdown");
  assert.equal(tipoDeNotaPorRuta("x.excalidraw"), "excalidraw");
  assert.equal(tipoDeNotaPorRuta("x.drawio"), "drawio");
  assert.equal(tipoDeNotaPorRuta("foto.png"), null);
  assert.equal(tipoDeNotaPorRuta(".md"), null);
  assert.equal(tipoDeNotaPorRuta("sin-extension"), null);
});

test("la reconciliación encuentra lo que el watcher perdió, y aplicada deja el árbol igual al disco", () => {
  const antes = arbol({
    carpetas: ["A", "Vieja"],
    notas: ["A/x.md", "Vieja/borrada.md", "suelta.md"],
    otros: ["A/foto.png", "perdido.pdf"],
  });
  const recorrido = {
    archivosMeta: [
      { rutaRelativa: "A/x.md", mtime: 1, tipo: "markdown" },
      { rutaRelativa: "suelta.md", mtime: 1, tipo: "markdown" },
      { rutaRelativa: "Nueva/sub/n.canvas", mtime: 2, tipo: "canvas" },
    ],
    otros: [
      { rutaRelativa: "A/foto.png", mtime: 1, tipo: "png" },
      { rutaRelativa: "Nueva/datos.csv", mtime: 3, tipo: "csv" },
    ],
    directorios: ["A", "Nueva", "Nueva/sub", "Vacia"],
  };
  const dif = diferenciasConDisco(antes, recorrido);
  const resumen = dif.map((c) => `${c.estado}:${c.ruta}`).sort();
  assert.deepEqual(resumen, [
    "ausente:Vieja",
    "ausente:Vieja/borrada.md",
    "ausente:perdido.pdf",
    "carpeta:Nueva",
    "carpeta:Nueva/sub",
    "carpeta:Vacia",
    "nota:Nueva/sub/n.canvas",
    "otro:Nueva/datos.csv",
  ]);
  // Primero lo que sobra.
  const primeraAlta = dif.findIndex((c) => c.estado !== "ausente");
  assert.ok(dif.slice(primeraAlta).every((c) => c.estado !== "ausente"));

  const despues = aplicarCambios(antes, dif);
  assert.deepEqual(ids(despues.carpetas).sort(), ["A", "Nueva", "Nueva/sub", "Vacia"]);
  assert.deepEqual(ids(despues.notas).sort(), ["A/x.md", "Nueva/sub/n.canvas", "suelta.md"]);
  assert.deepEqual(ids(despues.otros).sort(), ["A/foto.png", "Nueva/datos.csv"]);
  // Y ya sin diferencias.
  assert.deepEqual(diferenciasConDisco(despues, recorrido), []);
});

test("los pendientes: se quitan solo si son el mismo cambio, y en orden cronológico", () => {
  vaciarPendientes();
  const a1 = cambio("A", "ausente");
  const x = cambio("A/x.md", "nota", "markdown");
  anotarPendientes([a1]);
  anotarPendientes([x]);
  const a2 = cambio("A", "carpeta");
  anotarPendientes([a2]); // la carpeta volvió: pasa al final
  assert.deepEqual(pendientesActuales().map((c) => `${c.estado}:${c.ruta}`), ["nota:A/x.md", "carpeta:A"]);
  // Reaplicados sobre un árbol vacío dan el estado de ahora.
  const r = aplicarCambios(arbol(), pendientesActuales());
  assert.deepEqual(ids(r.notas), ["A/x.md"]);
  // Terminó el indexado de la ráfaga vieja (`a1`): `A` sigue pendiente (es `a2`).
  quitarPendientes([a1, x]);
  assert.deepEqual(pendientesActuales(), [a2]);
  quitarPendientes([a2]);
  assert.deepEqual(pendientesActuales(), []);
});
