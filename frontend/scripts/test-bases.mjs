// Test headless (sin navegador ni Tauri) del parser y el evaluador de bases
// (`FUN-L-03`). El módulo bajo prueba (`lib/bases.ts`) es puro —sin imports—,
// así que se transpila en el momento y se importa vía data: URL, igual que
// `scripts/test-frontmatter.mjs` y `scripts/test-esporas.mjs`.
//
//   node --test scripts/test-bases.mjs
//   node scripts/test-bases.mjs
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import ts from "typescript";

const rutaTs = fileURLToPath(new URL("../lib/bases.ts", import.meta.url));
const fuente = await readFile(rutaTs, "utf8");
const { outputText } = ts.transpileModule(fuente, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 },
});
const mod = await import(`data:text/javascript,${encodeURIComponent(outputText)}`);
const {
  parsearBase,
  evaluar,
  construirTabla,
  valoresDe,
  tituloColumna,
  ErrorBase,
  motivosNoEditable,
  condicionAplicable,
  condicionesPlanas,
  filtroDeCondiciones,
  expresionDe,
  serializarBase,
  columnasDisponibles,
} = mod;

// ── Notas de prueba ───────────────────────────────────────────────────────────

const nota = (over = {}) => ({
  id: "n1",
  nombre: "Rediseño del API",
  ruta: "Proyectos/Rediseño del API.md",
  carpeta: "Proyectos",
  ext: "md",
  ctime: "2026-01-15",
  mtime: "2026-08-01",
  size: 1200,
  tags: ["idea", "trabajo"],
  props: [
    { clave: "estado", valor: "activo", tipo: "texto" },
    { clave: "prioridad", valor: "3", tipo: "numero" },
    { clave: "tags", valor: "idea", tipo: "lista" },
    { clave: "tags", valor: "trabajo", tipo: "lista" },
  ],
  ...over,
});

const otra = nota({
  id: "n2",
  nombre: "Migración a v2",
  ruta: "Archivo/Migración a v2.md",
  carpeta: "Archivo",
  tags: [],
  props: [
    { clave: "estado", valor: "archivado", tipo: "texto" },
    { clave: "prioridad", valor: "1", tipo: "numero" },
  ],
});

/** Evalúa una expresión suelta contra una nota. */
const ev = (expr, n = nota()) => evaluar(parsearBase(`filters:\n  and:\n    - ${expr}\n`).filtros, n);

// ── YAML ──────────────────────────────────────────────────────────────────────

test("parsea el ejemplo canónico de Obsidian", () => {
  const b = parsearBase(`
filters:
  and:
    - file.inFolder("Proyectos")
    - estado != "archivado"

properties:
  estado:
    displayName: Estado

views:
  - type: table
    name: Activos
    limit: 50
    order:
      - file.name
      - estado
      - prioridad
    sort:
      - property: prioridad
        direction: DESC
`);
  assert.equal(b.vistas.length, 1);
  assert.equal(b.vistas[0].nombre, "Activos");
  assert.equal(b.vistas[0].limite, 50);
  assert.deepEqual(b.vistas[0].columnas, ["file.name", "estado", "prioridad"]);
  assert.deepEqual(b.vistas[0].orden, [{ propiedad: "prioridad", descendente: true }]);
  assert.equal(b.nombres.estado, "Estado");
  assert.equal(b.filtros.tipo, "and");
  assert.equal(b.filtros.hijos.length, 2);
});

test("sin `views` igual devuelve una tabla usable", () => {
  const b = parsearBase("filters:\n  and:\n    - estado == \"activo\"\n");
  assert.equal(b.vistas.length, 1);
  assert.equal(b.vistas[0].tipo, "table");
});

test("los comentarios y las líneas en blanco se ignoran", () => {
  const b = parsearBase("# un comentario\n\nviews:\n  - type: table\n    name: X\n");
  assert.equal(b.vistas[0].nombre, "X");
});

test("un YAML que no es un mapa arriba de todo es un error", () => {
  assert.throws(() => parsearBase("- suelto\n- otro\n"), ErrorBase);
});

test("las claves de nivel superior desconocidas se declaran, no se tragan", () => {
  const b = parsearBase("formulas:\n  x: \"1+1\"\nviews:\n  - type: table\n");
  assert.deepEqual(b.ignoradas, ["formulas"]);
});

// ── Comparadores ──────────────────────────────────────────────────────────────

test("igualdad y desigualdad de texto", () => {
  assert.equal(ev('estado == "activo"'), true);
  assert.equal(ev('estado == "archivado"'), false);
  assert.equal(ev('estado != "archivado"'), true);
});

test("la comparación de texto no distingue mayúsculas", () => {
  assert.equal(ev('estado == "ACTIVO"'), true);
});

test("comparación numérica de verdad, no alfabética", () => {
  assert.equal(ev("prioridad > 2"), true);
  assert.equal(ev("prioridad >= 3"), true);
  assert.equal(ev("prioridad < 10"), true, "10 > 3 como número; como texto '10' < '3'");
  assert.equal(ev("prioridad > 10"), false);
});

test("un número entrecomillado se compara como texto", () => {
  assert.equal(ev('prioridad == "3"'), true);
});

test("una propiedad que NO existe no es lo mismo que una vacía", () => {
  assert.equal(valoresDe(nota(), "inexistente"), undefined);
  assert.equal(ev('inexistente == "algo"'), false);
  assert.equal(ev('inexistente != "algo"'), true, "no tenerla es distinto de tenerla distinta");
  assert.equal(ev("inexistente.isEmpty()"), true);
});

test("una propiedad de lista casa si CUALQUIER valor casa", () => {
  assert.equal(ev('tags == "trabajo"'), true);
  assert.equal(ev('tags == "ocio"'), false);
});

// ── Campos de archivo ─────────────────────────────────────────────────────────

test("los campos file.* se leen de la nota", () => {
  const n = nota();
  assert.deepEqual(valoresDe(n, "file.name"), ["Rediseño del API"]);
  assert.deepEqual(valoresDe(n, "file.folder"), ["Proyectos"]);
  assert.deepEqual(valoresDe(n, "file.ext"), ["md"]);
  assert.deepEqual(valoresDe(n, "file.tags"), ["idea", "trabajo"]);
  assert.deepEqual(valoresDe(n, "file.size"), ["1200"]);
  assert.equal(valoresDe(n, "file.inventado"), undefined);
});

test("`note.clave` y `clave` a secas son lo mismo", () => {
  assert.deepEqual(valoresDe(nota(), "note.estado"), ["activo"]);
  assert.deepEqual(valoresDe(nota(), "estado"), ["activo"]);
});

test("file.hasTag, con y sin almohadilla", () => {
  assert.equal(ev('file.hasTag("idea")'), true);
  assert.equal(ev('file.hasTag("#idea")'), true);
  assert.equal(ev('file.hasTag("ocio")'), false);
  assert.equal(ev('file.hasTag("ocio", "trabajo")'), true, "varios argumentos = cualquiera");
});

test("file.inFolder alcanza a las subcarpetas", () => {
  const hija = nota({ carpeta: "Proyectos/2026" });
  assert.equal(ev('file.inFolder("Proyectos")', hija), true);
  assert.equal(ev('file.inFolder("Proyectos/")', hija), true);
  assert.equal(ev('file.inFolder("Proyecto")', hija), false, "no basta con ser prefijo del nombre");
  assert.equal(ev('file.inFolder("Archivo")', hija), false);
});

test("file.hasProperty distingue tener de valer", () => {
  assert.equal(ev('file.hasProperty("estado")'), true);
  assert.equal(ev('file.hasProperty("inexistente")'), false);
});

test("métodos de texto", () => {
  assert.equal(ev('estado.contains("act")'), true);
  assert.equal(ev('estado.startsWith("ACT")'), true, "sin distinguir mayúsculas");
  assert.equal(ev('estado.endsWith("vo")'), true);
  assert.equal(ev('estado.endsWith("xx")'), false);
});

// ── Lógica de tres valores: LO IMPORTANTE ─────────────────────────────────────

test("una expresión desconocida NO se ignora: queda indecidible", () => {
  const b = parsearBase('filters:\n  and:\n    - price.toFixed(2) == "1"\n');
  assert.equal(b.filtros.hijos[0].tipo, "opaco");
  assert.equal(evaluar(b.filtros, nota()), null);
});

test("dentro de un `and`, un falso decide aunque haya algo indecidible", () => {
  const b = parsearBase(
    'filters:\n  and:\n    - estado == "archivado"\n    - price.toFixed(2) == "1"\n',
  );
  assert.equal(evaluar(b.filtros, nota()), false, "falso absorbe: no puede estar la nota");
});

test("dentro de un `and`, un verdadero NO alcanza si hay algo indecidible", () => {
  const b = parsearBase(
    'filters:\n  and:\n    - estado == "activo"\n    - price.toFixed(2) == "1"\n',
  );
  assert.equal(
    evaluar(b.filtros, nota()),
    null,
    "ignorar el filtro desconocido ensancharía el resultado",
  );
});

test("dentro de un `or`, un verdadero decide aunque haya algo indecidible", () => {
  const b = parsearBase(
    'filters:\n  or:\n    - estado == "activo"\n    - price.toFixed(2) == "1"\n',
  );
  assert.equal(evaluar(b.filtros, nota()), true);
});

test("dentro de un `or`, un falso NO alcanza si hay algo indecidible", () => {
  const b = parsearBase(
    'filters:\n  or:\n    - estado == "archivado"\n    - price.toFixed(2) == "1"\n',
  );
  assert.equal(evaluar(b.filtros, nota()), null, "descartarla estrecharía el resultado");
});

test("`not` propaga lo indecidible en vez de convertirlo en verdadero", () => {
  const b = parsearBase('filters:\n  not:\n    - price.toFixed(2) == "1"\n');
  assert.equal(evaluar(b.filtros, nota()), null);
});

test("and/or/not anidados", () => {
  const b = parsearBase(`
filters:
  or:
    - and:
        - file.inFolder("Proyectos")
        - estado == "activo"
    - not:
        - file.hasTag("idea")
`);
  assert.equal(evaluar(b.filtros, nota()), true);
  assert.equal(evaluar(b.filtros, otra), true, "no tiene la etiqueta: entra por el `not`");
  const tercera = nota({ id: "n3", carpeta: "Archivo", tags: ["idea"] });
  assert.equal(evaluar(b.filtros, tercera), false);
});

// ── construirTabla ────────────────────────────────────────────────────────────

test("filtra, ordena y recorta", () => {
  const b = parsearBase(`
views:
  - type: table
    name: T
    limit: 1
    order:
      - file.name
      - prioridad
    sort:
      - property: prioridad
        direction: DESC
`);
  const t = construirTabla(b, b.vistas[0], [otra, nota()]);
  assert.equal(t.ok, true);
  assert.equal(t.total, 2);
  assert.equal(t.recortadas, 1);
  assert.equal(t.filas.length, 1);
  assert.equal(t.filas[0].nota.id, "n1", "prioridad 3 antes que 1 con DESC");
  assert.deepEqual(t.filas[0].celdas, [["Rediseño del API"], ["3"]]);
});

test("un filtro indecidible devuelve el motivo, no una tabla a medias", () => {
  const b = parsearBase(
    'filters:\n  and:\n    - estado == "activo"\n    - price.toFixed(2) == "1"\nviews:\n  - type: table\n',
  );
  const t = construirTabla(b, b.vistas[0], [nota()]);
  assert.equal(t.ok, false);
  // Da igual por qué rama cayó (comparación con llamada, o función desconocida):
  // lo que importa es que quedó OPACA y que se conserva el texto exacto para
  // poder mostrárselo al usuario.
  assert.match(t.motivo, /No se puede aplicar un filtro/);
  assert.equal(t.expresion, 'price.toFixed(2) == "1"');
});

test("«ver sin filtrar» sí devuelve las filas, a pedido", () => {
  const b = parsearBase(
    'filters:\n  and:\n    - price.toFixed(2) == "1"\nviews:\n  - type: table\n',
  );
  const t = construirTabla(b, b.vistas[0], [nota(), otra], { ignorarFiltros: true });
  assert.equal(t.ok, true);
  assert.equal(t.filas.length, 2);
});

test("los filtros globales y los de la vista se combinan con AND", () => {
  const b = parsearBase(`
filters:
  and:
    - file.inFolder("Proyectos")
views:
  - type: table
    filters:
      and:
        - estado == "activo"
`);
  const t = construirTabla(b, b.vistas[0], [nota(), otra]);
  assert.equal(t.filas.length, 1);
  assert.equal(t.filas[0].nota.id, "n1");
});

test("una vista que no es tabla se declara, no se dibuja aproximada", () => {
  const b = parsearBase("views:\n  - type: cards\n    name: Fichas\n");
  const t = construirTabla(b, b.vistas[0], [nota()]);
  assert.equal(t.ok, false);
  assert.match(t.motivo, /table/);
});

test("sin columnas, la tabla muestra el nombre", () => {
  const b = parsearBase("views:\n  - type: table\n");
  const t = construirTabla(b, b.vistas[0], [nota()]);
  assert.deepEqual(t.columnas, ["file.name"]);
});

test("la cabecera usa displayName y si no un nombre legible", () => {
  const b = parsearBase("properties:\n  estado:\n    displayName: Situación\n");
  assert.equal(tituloColumna(b, "estado"), "Situación");
  assert.equal(tituloColumna(b, "file.name"), "Nombre");
  assert.equal(tituloColumna(b, "note.otra"), "otra");
});

// Ejecutable como `node scripts/test-bases.mjs` (node:test imprime el resumen).

// ── Edición desde la UI ───────────────────────────────────────────────────────

test("un archivo que Mycelium entiende entero se puede editar", () => {
  const b = parsearBase(`
filters:
  and:
    - file.inFolder("Proyectos")
    - estado == "activo"
views:
  - type: table
    name: Activos
    order:
      - file.name
`);
  assert.deepEqual(motivosNoEditable(b), []);
});

test("`formulas` bloquea la edición por UI en vez de borrarlas al guardar", () => {
  const b = parsearBase('formulas:\n  x: "1+1"\nviews:\n  - type: table\n');
  assert.equal(motivosNoEditable(b).length, 1);
  assert.match(motivosNoEditable(b)[0], /formulas/);
});

test("una clave de vista no modelada tambien la bloquea", () => {
  const b = parsearBase("views:\n  - type: table\n    name: X\n    groupBy:\n      property: estado\n");
  assert.match(motivosNoEditable(b)[0], /groupBy/);
});

test("un filtro no soportado bloquea la edición por UI", () => {
  const b = parsearBase('filters:\n  and:\n    - price.toFixed(2) == "1"\n');
  assert.match(motivosNoEditable(b)[0], /no se entiende/);
});

test("los filtros planos se leen como condiciones del constructor", () => {
  const b = parsearBase(`
filters:
  and:
    - file.inFolder("Proyectos")
    - estado != "archivado"
    - prioridad > 2
    - resumen.contains("api")
    - notas.isEmpty()
`);
  const p = condicionesPlanas(b.filtros);
  assert.equal(p.combinador, "and");
  assert.deepEqual(p.condiciones, [
    { ref: "file", op: "inFolder", valor: "Proyectos" },
    { ref: "estado", op: "!=", valor: "archivado" },
    { ref: "prioridad", op: ">", valor: "2" },
    { ref: "resumen", op: "contains", valor: "api" },
    { ref: "notas", op: "isEmpty", valor: "" },
  ]);
});

test("un filtro ANIDADO no se aplana: el constructor se declara incapaz", () => {
  const b = parsearBase(`
filters:
  or:
    - and:
        - estado == "activo"
        - prioridad > 1
    - file.hasTag("urgente")
`);
  assert.equal(
    condicionesPlanas(b.filtros),
    null,
    "aplanarlo destruiría el filtro real al guardar",
  );
});

test("un `not` tampoco se aplana", () => {
  const b = parsearBase('filters:\n  not:\n    - estado == "activo"\n');
  assert.equal(condicionesPlanas(b.filtros), null);
});

test("hasTag con varios argumentos no es representable en el constructor", () => {
  const b = parsearBase('filters:\n  and:\n    - file.hasTag("a", "b")\n');
  assert.equal(condicionesPlanas(b.filtros), null);
});

test("sin filtros, el constructor arranca vacío (no null)", () => {
  const p = condicionesPlanas(null);
  assert.deepEqual(p, { combinador: "and", condiciones: [] });
});

test("una condición numérica se escribe SIN comillas, para comparar como número", () => {
  assert.equal(expresionDe({ ref: "prioridad", op: ">", valor: "10" }), "prioridad > 10");
  assert.equal(expresionDe({ ref: "estado", op: "==", valor: "activo" }), 'estado == "activo"');
  assert.equal(expresionDe({ ref: "file", op: "hasTag", valor: "idea" }), 'file.hasTag("idea")');
  assert.equal(expresionDe({ ref: "notas", op: "isEmpty", valor: "" }), "notas.isEmpty()");
});

test("las condiciones a medio escribir no llegan al archivo", () => {
  const f = filtroDeCondiciones("and", [
    { ref: "estado", op: "==", valor: "activo" },
    { ref: "prioridad", op: ">", valor: "" },
    { ref: "", op: "==", valor: "x" },
  ]);
  assert.equal(f.hijos.length, 1);
});

test("ida y vuelta: serializar y volver a parsear conserva el modelo", () => {
  const fuente = `
filters:
  and:
    - file.inFolder("Proyectos")
    - estado != "archivado"

properties:
  estado:
    displayName: Situación

views:
  - type: table
    name: Activos
    limit: 20
    order:
      - file.name
      - estado
    sort:
      - property: estado
        direction: DESC
  - type: table
    name: Todo
    order:
      - file.name
`;
  const antes = parsearBase(fuente);
  const despues = parsearBase(serializarBase(antes));
  assert.deepEqual(despues.filtros, antes.filtros);
  assert.deepEqual(despues.nombres, antes.nombres);
  assert.equal(despues.vistas.length, 2);
  assert.deepEqual(
    despues.vistas.map((v) => [v.nombre, v.limite, v.columnas, v.orden]),
    antes.vistas.map((v) => [v.nombre, v.limite, v.columnas, v.orden]),
  );
});

test("ida y vuelta con un filtro por vista", () => {
  const antes = parsearBase(
    'views:\n  - type: table\n    name: X\n    filters:\n      or:\n        - estado == "activo"\n        - prioridad > 5\n',
  );
  const despues = parsearBase(serializarBase(antes));
  assert.deepEqual(despues.vistas[0].filtros, antes.vistas[0].filtros);
});

test("un nombre con acentos y espacios sobrevive a la ida y vuelta", () => {
  const b = parsearBase("views:\n  - type: table\n    name: X\n");
  b.vistas[0].nombre = "Situación: los «activos»";
  const despues = parsearBase(serializarBase(b));
  assert.equal(despues.vistas[0].nombre, "Situación: los «activos»");
});

test("las columnas elegibles combinan campos de archivo y propiedades del vault", () => {
  const refs = columnasDisponibles([nota(), otra]).map((c) => c.ref);
  assert.equal(refs.includes("file.name"), true);
  assert.equal(refs.includes("estado"), true);
  assert.equal(refs.includes("prioridad"), true);
  assert.equal(refs.filter((r) => r === "estado").length, 1, "sin duplicados entre notas");
});

// ── DEF-080: una condición a medias no filtra, pero tampoco se borra ─────────
// La regla vive en `condicionAplicable` y la usan los DOS lados: el que escribe
// el archivo y el constructor, que conserva en pantalla lo que el archivo
// descarta. Si dejaran de coincidir, volvería el defecto.

test("una condicion completa es aplicable", () => {
  assert.equal(condicionAplicable({ ref: "estado", op: "==", valor: "activo" }), true);
});

test("sin campo no es aplicable", () => {
  assert.equal(condicionAplicable({ ref: "", op: "==", valor: "activo" }), false);
});

test("sin valor no es aplicable", () => {
  assert.equal(condicionAplicable({ ref: "estado", op: "==", valor: "" }), false);
});

test("isEmpty no necesita valor: es aplicable igual", () => {
  assert.equal(condicionAplicable({ ref: "estado", op: "isEmpty", valor: "" }), true);
});

test("filtroDeCondiciones descarta las que no son aplicables", () => {
  const f = filtroDeCondiciones("and", [
    { ref: "estado", op: "==", valor: "activo" },
    { ref: "prioridad", op: ">", valor: "" },
  ]);
  assert.equal(f.hijos.length, 1);
  assert.ok(f.hijos[0].fuente.includes("estado"));
});

test("solo condiciones a medias: no hay filtro, y eso NO es un error", () => {
  assert.equal(filtroDeCondiciones("and", [{ ref: "estado", op: "==", valor: "" }]), null);
});
