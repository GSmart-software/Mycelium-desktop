// Test headless (sin navegador ni Tauri) de las consultas al índice del MCP de
// control (`FUN-M-45`): la lógica pura de `lib/mcpIndiceLogica.ts` —validar,
// paginar, armar los enlaces de una nota, evaluar una vista `.base` con el
// motor de la app— y las líneas de cada enlace (`ocurrenciasDeEnlaces`, en
// `lib/enlacesNota.ts`), que tienen que contar EXACTAMENTE lo mismo que
// `derivarEnlaces`, lo que el indexador guarda.
//
//   node --test scripts/test-mcp-indice.mjs
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import ts from "typescript";

const aUrl = (codigo) => `data:text/javascript,${encodeURIComponent(codigo)}`;

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

const EXTENSIONES = await fuente("../lib/extensionesDeTipo.ts");
const WIKILINKS = await fuente("../lib/wikilinks.ts", { "@/lib/extensionesDeTipo": EXTENSIONES });
const ENLACES_NOTA = await fuente("../lib/enlacesNota.ts", {
  "@/lib/canvas": await fuente("../lib/canvas.ts"),
  "@/lib/extensionesDeTipo": EXTENSIONES,
  "@/lib/frontmatter": await fuente("../lib/frontmatter.ts"),
  "@/lib/sinCodigo": await fuente("../lib/sinCodigo.ts"),
  "@/lib/wikilinks": WIKILINKS,
});
const BASES = await fuente("../lib/bases.ts");
const LOGICA = await fuente("../lib/mcpIndiceLogica.ts", { "@/lib/bases": BASES, "@/lib/enlacesNota": ENLACES_NOTA });

const { derivarEnlaces, ocurrenciasDeEnlaces, lineasPorEnlace } = await import(ENLACES_NOTA);
const { parsearBase } = await import(BASES);
const L = await import(LOGICA);

// ── Las líneas de los enlaces ────────────────────────────────────────────────

const NOTA = [
  "---", // 1
  'relacionado: "[[Madre]]"', // 2
  "---", // 3
  "Ver [[Plan]] y [[Plan|el plan]].", // 4
  "```", // 5
  "[[EnBloque]]", // 6
  "```", // 7
  "Un `[[EnLinea]]` no cuenta; ![[foto.png]] sí, y [[Plan#Objetivos]].", // 8
  "Propio: [[#Arriba]]", // 9
  "| [[Tabla\\|alias]] | x |", // 10
].join("\n");

test("ocurrenciasDeEnlaces: una por aparición, con su línea, y sin el código", () => {
  assert.deepEqual(
    ocurrenciasDeEnlaces(NOTA, "markdown").map((o) => `${o.tipo}:${o.texto}@${o.linea}`),
    ["enlace:Madre@2", "enlace:Plan@4", "enlace:Plan@4", "embed:foto.png@8", "enlace:Plan#Objetivos@8", "enlace:Tabla@10"],
  );
});

test("ocurrenciasDeEnlaces cuenta lo mismo que derivarEnlaces (lo que guarda el índice)", () => {
  for (const [texto, tipo] of [
    [NOTA, "markdown"],
    ['{"text":"[[A]] y [[A]] y ![[B]]"}', "excalidraw"],
    [JSON.stringify({ nodes: [{ id: "a", type: "text", text: "[[X]] [[X]]" }, { id: "b", type: "file", file: "d/Y.md" }] }), "canvas"],
    ["", "markdown"],
    ["filtro: '[[Algo]]'", "base"],
  ]) {
    const contadas = new Map();
    for (const o of ocurrenciasDeEnlaces(texto, tipo)) {
      const k = `${o.tipo}:${o.texto}`;
      contadas.set(k, (contadas.get(k) ?? 0) + 1);
    }
    assert.deepEqual(
      [...contadas].map(([k, n]) => `${k}×${n}`),
      derivarEnlaces(texto, tipo).map((e) => `${e.tipo}:${e.texto}×${e.n}`),
      `${tipo}: ${texto.slice(0, 30)}`,
    );
  }
});

test("lineasPorEnlace: por (tipo, texto); un canvas no tiene líneas", () => {
  const m = lineasPorEnlace(NOTA, "markdown");
  assert.deepEqual(m.get("enlace\u0000Plan"), [4, 4]);
  assert.deepEqual(m.get("embed\u0000foto.png"), [8]);
  const c = lineasPorEnlace(JSON.stringify({ nodes: [{ id: "a", type: "text", text: "[[X]]" }] }), "canvas");
  assert.deepEqual(c.get("canvas\u0000X"), []);
});

// ── mycelium_buscar ──────────────────────────────────────────────────────────

test("validarBuscar: valores por defecto, topes y campos desconocidos", () => {
  assert.deepEqual(L.validarBuscar({ consulta: "  plan " }), {
    ok: true,
    valor: { consulta: "plan", campo: "ambos", exacto: false, limite: 20, desde: 0 },
  });
  assert.equal(L.validarBuscar({}).error.datos.campo, "consulta");
  assert.equal(L.validarBuscar({ consulta: "x", campo: "titulo" }).error.datos.campo, "campo");
  assert.equal(L.validarBuscar({ consulta: "x", limite: 51 }).error.datos.campo, "limite");
  assert.equal(L.validarBuscar({ consulta: "x", desde: -1 }).error.datos.campo, "desde");
  assert.equal(L.validarBuscar({ consulta: "x", exacto: "si" }).error.datos.campo, "exacto");
  const r = L.validarBuscar({ consulta: "x", pagina: 2 });
  assert.equal(r.error.codigo, "INVALIDO");
  assert.match(r.error.mensaje, /`pagina`: no es un campo/);
});

test("paginaDeBusqueda: uno de más dice si hay otra página, y desde dónde", () => {
  const pedido = { consulta: "plan", campo: "ambos", exacto: false, limite: 2, desde: 4 };
  const filas = [
    { nota_id: "a.md", titulo: "a", fragmento: "el «plan»\n de" },
    { nota_id: "b.base", titulo: "b", fragmento: "" },
    { nota_id: "c.md", titulo: "c", fragmento: "" },
  ];
  const tipos = new Map([["b.base", "base"]]);
  const p = L.paginaDeBusqueda(pedido, filas, (id) => tipos.get(id));
  assert.equal(p.resultados.length, 2);
  assert.equal(p.resultados[0].fragmento, "el «plan» de");
  assert.equal(p.resultados[1].tipo, "base");
  assert.equal(p.hay_mas, true);
  assert.equal(p.siguiente, 6);
  const ultima = L.paginaDeBusqueda(pedido, filas.slice(0, 2), () => undefined);
  assert.equal(ultima.hay_mas, false);
  assert.equal(ultima.siguiente, null);
});

// ── mycelium_enlaces ─────────────────────────────────────────────────────────

test("resolverArchivo: un enlace a un archivo que no es nota, por nombre y pista de carpeta", () => {
  const idx = L.indexarOtros(["img/foto.png", "otra/foto.png", "docs/Informe.pdf"]);
  assert.equal(L.resolverArchivo({ tipo: "embed", texto: "foto.png" }, idx), "img/foto.png");
  assert.equal(L.resolverArchivo({ tipo: "embed", texto: "otra/foto.png" }, idx), "otra/foto.png");
  assert.equal(L.resolverArchivo({ tipo: "enlace", texto: "Informe.pdf#page=3" }, idx), "docs/Informe.pdf");
  assert.equal(L.resolverArchivo({ tipo: "enlace", texto: "nada/foto.png" }, idx), null, "pista que no calza");
  assert.equal(L.resolverArchivo({ tipo: "enlace", texto: "Informe" }, idx), null, "sin extensión es una nota");
  assert.equal(L.resolverArchivo({ tipo: "archivo", texto: "docs/Informe.pdf" }, idx), "docs/Informe.pdf");
});

test("enlacesParaIa: salientes con su estado y línea; backlinks por nota, sin ella misma", () => {
  const notas = new Map(
    [
      { id: "A.md", titulo: "A", tipo: "markdown" },
      { id: "x/B.md", titulo: "B", tipo: "markdown" },
      { id: "C.md", titulo: "C", tipo: "markdown" },
      { id: "L.canvas", titulo: "L", tipo: "canvas" },
    ].map((n) => [n.id, n]),
  );
  const salientes = [
    { desde: "A.md", texto: "B#Sec", tipo: "enlace", destino: "x/B.md", n: 2 },
    { desde: "A.md", texto: "foto.png", tipo: "embed", destino: null, n: 1 },
    { desde: "A.md", texto: "Nada", tipo: "enlace", destino: null, n: 1 },
    { desde: "A.md", texto: "A", tipo: "enlace", destino: "A.md", n: 1 },
  ];
  const entrantes = [
    { desde: "C.md", texto: "A", tipo: "enlace", destino: "A.md", n: 1 },
    { desde: "C.md", texto: "A#Intro", tipo: "enlace", destino: "A.md", n: 1 },
    { desde: "L.canvas", texto: "A.md", tipo: "archivo", destino: "A.md", n: 1 },
  ];
  const lineas = new Map([
    ["A.md", new Map([["enlace\u0000B#Sec", [3, 7]], ["enlace\u0000Nada", [9]]])],
    ["C.md", new Map([["enlace\u0000A", [5]], ["enlace\u0000A#Intro", [2]]])],
  ]);
  const r = L.enlacesParaIa(notas.get("A.md"), salientes, entrantes, notas, L.indexarOtros(["img/foto.png"]), (id) =>
    lineas.get(id),
  );
  assert.deepEqual(
    r.salientes.map((s) => `${s.texto}:${s.estado}:${s.destino?.ruta ?? "-"}:${s.lineas.join(",")}`),
    ["B#Sec:nota:x/B.md:3,7", "foto.png:archivo:img/foto.png:", "Nada:roto:-:9", "A:propia:A.md:"],
  );
  assert.equal(r.rotos, 1);
  assert.deepEqual(
    r.backlinks.map((b) => `${b.ruta}:${b.textos.join("+")}:${b.lineas.join(",")}`),
    ["C.md:A+A#Intro:2,5", "L.canvas:A.md:"],
  );
  assert.equal(r.total_backlinks, 2);
});

// ── mycelium_base ────────────────────────────────────────────────────────────

const BASE = `filters:
  and:
    - file.inFolder("Proyectos")
properties:
  note.estado:
    displayName: Estado
views:
  - type: table
    name: Activos
    filters:
      and:
        - estado == "activo"
    order:
      - file.name
      - note.estado
  - type: table
    name: Todos
    order:
      - file.name
      - note.relacionado
    sort:
      - property: file.name
        direction: DESC
    limit: 2
`;

const notaTabla = (nombre, props, carpeta = "Proyectos") => ({
  id: `${carpeta}/${nombre}.md`,
  nombre,
  ruta: `${carpeta}/${nombre}`,
  carpeta,
  ext: "md",
  ctime: "2026-10-01T00:00:00Z",
  mtime: "2026-10-02T00:00:00Z",
  size: 100,
  tags: [],
  props: Object.entries(props).flatMap(([clave, v]) =>
    (Array.isArray(v) ? v : [v]).map((valor) => ({ clave, valor, tipo: "texto" })),
  ),
});

const NOTAS_TABLA = [
  notaTabla("Huerta", { estado: "activo", relacionado: ["[[Riego|el riego]]", "[[Semillas]]"] }),
  notaTabla("Casa", { estado: "pausado" }),
  notaTabla("Libro", { estado: "activo" }),
  notaTabla("Fuera", { estado: "activo" }, "Otros"),
];

test("validarBase y elegirVista: por nombre sin mayúsculas, la primera por defecto, y NO_ENCONTRADO con las vistas", () => {
  assert.deepEqual(L.validarBase({ ruta: "P", vista: " " }), { ok: true, valor: { ruta: "P", vista: null } });
  assert.equal(L.validarBase({ vista: "x" }).error.datos.campo, "ruta");
  const base = parsearBase(BASE);
  assert.equal(L.elegirVista(base, null).valor.vista.nombre, "Activos");
  assert.equal(L.elegirVista(base, "todos").valor.indice, 1);
  const no = L.elegirVista(base, "Archivados");
  assert.equal(no.error.codigo, "NO_ENCONTRADO");
  assert.deepEqual(no.error.datos.vistas, ["Activos", "Todos"]);
  assert.equal(L.elegirVista({ ...base, vistas: [] }, null).error.codigo, "INVALIDO");
  assert.equal(parsearBase("filters:\n  and: []\n").vistas[0].nombre, "Tabla", "sin vistas, el motor arma una");
});

test("tablaParaIa: el motor de la app, en texto plano, con la ruta de cada fila", () => {
  const base = parsearBase(BASE);
  const activos = L.tablaParaIa(base, L.elegirVista(base, "Activos").valor, NOTAS_TABLA);
  assert.equal(activos.ok, true);
  assert.deepEqual(activos.valor.columnas, ["Nombre", "Estado"]);
  assert.deepEqual(
    activos.valor.filas.map((f) => `${f.ruta}=${f.celdas.join("|")}`),
    ["Proyectos/Huerta.md=Huerta|activo", "Proyectos/Libro.md=Libro|activo"],
  );
  assert.equal(activos.valor.total, 2);

  const todos = L.tablaParaIa(base, L.elegirVista(base, "Todos").valor, NOTAS_TABLA);
  assert.equal(todos.valor.total, 3, "el filtro de la base deja fuera la de Otros");
  assert.equal(todos.valor.recortadas_por_vista, 1, "el limit de la vista");
  assert.deepEqual(todos.valor.filas.map((f) => f.celdas[0]), ["Libro", "Huerta"], "el orden de la vista");
  assert.equal(todos.valor.filas[0].celdas[1], "", "sin valor, vacío");
  assert.equal(todos.valor.filas[1].celdas[1], "el riego, Semillas", "enlaces por su alias, listas con coma");

  const tope = L.tablaParaIa(base, L.elegirVista(base, "Activos").valor, NOTAS_TABLA, 1);
  assert.equal(tope.valor.filas.length, 1);
  assert.equal(tope.valor.recortadas_por_tope, 1);
});

test("tablaParaIa: un filtro fuera del subconjunto es INVALIDO con el motivo, como en la pestaña", () => {
  const base = parsearBase(`views:\n  - type: table\n    name: Rara\n    filters:\n      and:\n        - file.hasLink("Plan")\n`);
  const r = L.tablaParaIa(base, L.elegirVista(base, null).valor, NOTAS_TABLA);
  assert.equal(r.ok, false);
  assert.equal(r.error.codigo, "INVALIDO");
  assert.match(r.error.mensaje, /^La vista no se puede evaluar: /);
});
