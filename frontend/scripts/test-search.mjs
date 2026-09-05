// Test headless (sin navegador ni Tauri) de la lógica del panel de búsqueda:
// el agrupado de resultados en árbol (`FUN-M-20`) y los ayudantes de HU-21.
//
// Los dos módulos bajo prueba (`lib/search.ts` y `lib/db/fts.ts`) no tienen
// imports en runtime —el único de `search.ts` es `import type`, que TypeScript
// borra— así que se transpilan en el momento y se importan vía data: URL, igual
// que `scripts/test-bases.mjs`.
//
// `lib/db/` es solo-desktop: en `web-cloud` la consulta FTS la arma el backend
// .NET (`SearchEndpoints.BuildFtsQuery`). Los tests de esa mitad se SALTAN allá
// en vez de vivir en otro archivo — así este es el mismo en las dos ramas, y el
// motivo queda dicho en la salida del test en lugar de en la cabeza de alguien.
//
//   node --test scripts/test-search.mjs
//   node scripts/test-search.mjs
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import ts from "typescript";

async function cargar(ruta, opcional = false) {
  let fuente;
  try {
    fuente = await readFile(fileURLToPath(new URL(ruta, import.meta.url)), "utf8");
  } catch (e) {
    if (opcional && e.code === "ENOENT") return null;
    throw e;
  }
  const { outputText } = ts.transpileModule(fuente, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 },
  });
  return import(`data:text/javascript,${encodeURIComponent(outputText)}`);
}

const { agruparEnArbol, folderPath, firstSearchTerm, fragmentToHtml } = await cargar(
  "../lib/search.ts",
);
const fts = await cargar("../lib/db/fts.ts", true);
const soloDesktop = fts === null ? { skip: "lib/db es solo-desktop; acá lo arma el backend .NET" } : {};
const buildFtsQuery = fts?.buildFtsQuery ?? (() => "");
const separarFiltrosPropiedad = fts?.separarFiltrosPropiedad ?? (() => ({ filtros: [], resto: "" }));

// ── Carpetas de prueba ───────────────────────────────────────────────────────
//
//   Proyectos/            (p)
//     Api/                (api)
//     Web/                (web)
//   Archivo/              (arch)

const CARPETAS = [
  { id: "p", nombre: "Proyectos", padreId: null },
  { id: "api", nombre: "Api", padreId: "p" },
  { id: "web", nombre: "Web", padreId: "p" },
  { id: "arch", nombre: "Archivo", padreId: null },
];

const res = (id, carpeta) => ({ nota_id: id, carpeta_id: carpeta });

// ── FUN-M-20: los resultados como árbol ──────────────────────────────────────

test("una carpeta sin resultados NO aparece, ni siquiera de paso", () => {
  const a = agruparEnArbol([res("n1", "api")], CARPETAS);
  // Proyectos entra porque lleva a Api; Web y Archivo no entran.
  assert.equal(a.hijos.length, 1);
  assert.equal(a.hijos[0].nombre, "Proyectos");
  assert.deepEqual(
    a.hijos[0].hijos.map((h) => h.nombre),
    ["Api"],
    "Web no tiene resultados y no debe ocupar una fila",
  );
});

test("una carpeta intermedia entra si alguna descendiente tiene resultados", () => {
  const a = agruparEnArbol([res("n1", "web")], CARPETAS);
  assert.equal(a.hijos[0].nombre, "Proyectos");
  assert.equal(a.hijos[0].resultados.length, 0, "no tiene resultados propios");
  assert.equal(a.hijos[0].total, 1, "pero cuenta el de su hija");
});

test("el total suma lo propio y lo de debajo", () => {
  const a = agruparEnArbol(
    [res("n1", "p"), res("n2", "api"), res("n3", "web"), res("n4", "arch")],
    CARPETAS,
  );
  const proyectos = a.hijos.find((h) => h.nombre === "Proyectos");
  assert.equal(proyectos.resultados.length, 1);
  assert.equal(proyectos.total, 3);
  assert.equal(a.total, 4);
});

test("los resultados de la raíz del vault se quedan en la raíz", () => {
  const a = agruparEnArbol([res("n1", null), res("n2", "api")], CARPETAS);
  assert.deepEqual(
    a.resultados.map((r) => r.nota_id),
    ["n1"],
  );
  assert.equal(a.total, 2);
});

test("una carpeta que el arbol no conoce no se traga el resultado", () => {
  // Pasa de verdad: la carpeta se borro desde fuera y el indice todavia no lo
  // sabe. Perder la nota seria peor que ponerla en la raiz.
  const a = agruparEnArbol([res("n1", "fantasma")], CARPETAS);
  assert.deepEqual(
    a.resultados.map((r) => r.nota_id),
    ["n1"],
  );
  assert.equal(a.hijos.length, 0);
});

test("las carpetas van por nombre; los resultados, en el orden en que llegaron", () => {
  const a = agruparEnArbol([res("n1", "web"), res("n2", "api"), res("n3", "web")], CARPETAS);
  assert.deepEqual(
    a.hijos[0].hijos.map((h) => h.nombre),
    ["Api", "Web"],
    "alfabetico: es como se las busca con la vista",
  );
  const web = a.hijos[0].hijos.find((h) => h.nombre === "Web");
  assert.deepEqual(
    web.resultados.map((r) => r.nota_id),
    ["n1", "n3"],
    "el backend los devuelve por relevancia; reordenarlos tiraria esa informacion",
  );
});

test("sin resultados, el arbol esta vacio y no rompe", () => {
  const a = agruparEnArbol([], CARPETAS);
  assert.equal(a.total, 0);
  assert.deepEqual(a.hijos, []);
  assert.deepEqual(a.resultados, []);
});

// ── FUN-M-20: buscar solo por nombre o solo por contenido ────────────────────

test("por defecto no se restringe ninguna columna", soloDesktop, () => {
  assert.equal(buildFtsQuery("api rest", true), '"api"* "rest"*');
  assert.equal(buildFtsQuery("api rest", true, "ambos"), '"api"* "rest"*');
});

test("el filtro de columna se aplica a CADA termino, no solo al primero", soloDesktop, () => {
  // `titulo : "api"* "rest"*` restringiria solo el primero: el operador alcanza
  // a la frase que le sigue, y `rest` se buscaria en todo el documento.
  assert.equal(buildFtsQuery("api rest", true, "nombre"), 'titulo : "api"* titulo : "rest"*');
  assert.equal(
    buildFtsQuery("api rest", true, "contenido"),
    'contenido : "api"* contenido : "rest"*',
  );
});

test("una frase entrecomillada tambien se restringe", soloDesktop, () => {
  assert.equal(buildFtsQuery('"rediseno del api"', false, "nombre"), 'titulo : "rediseno del api"');
});

test("el modo exacto sigue mandando sobre el prefijo", soloDesktop, () => {
  assert.equal(buildFtsQuery("api", false, "nombre"), 'titulo : "api"');
});

test("`tag:` se traduce a `#tag` antes de restringir", soloDesktop, () => {
  assert.equal(buildFtsQuery("tag:idea", true, "contenido"), 'contenido : "#idea"*');
});

// ── HU-21 / FUN-M-04: lo que ya habia, para no romperlo al tocar el mismo modulo

test("los filtros de propiedad se separan del texto", soloDesktop, () => {
  const { filtros, resto } = separarFiltrosPropiedad('estado:activo "frase exacta" api');
  assert.deepEqual(filtros, [{ clave: "estado", valor: "activo" }]);
  assert.equal(resto, '"frase exacta" api');
});

test("una URL pegada no es un filtro de propiedad", soloDesktop, () => {
  const { filtros, resto } = separarFiltrosPropiedad("https://ejemplo.com/x");
  assert.deepEqual(filtros, []);
  assert.equal(resto, "https://ejemplo.com/x");
});

test("folderPath arma la ruta completa", () => {
  assert.equal(folderPath("api", CARPETAS), "Proyectos / Api");
  assert.equal(folderPath(null, CARPETAS), "");
});

test("firstSearchTerm desarma comillas, tags y filtros", () => {
  assert.equal(firstSearchTerm('"rediseno del api" x'), "rediseno del api");
  assert.equal(firstSearchTerm("tag:idea"), "idea");
  assert.equal(firstSearchTerm("estado:activo"), "activo");
  assert.equal(firstSearchTerm("#idea"), "idea");
});

test("fragmentToHtml escapa el texto antes de resaltar", () => {
  assert.equal(
    fragmentToHtml("<script> y «api»"),
    '&lt;script&gt; y <mark class="mic-search-hit">api</mark>',
  );
});
