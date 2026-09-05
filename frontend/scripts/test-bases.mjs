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
  arbolDeFiltro,
  filtroDeArbol,
  alternarOrden,
  ordenDeColumna,
  filaCoincide,
  normalizarTexto,
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
  const b = parsearBase(`filters:\n  and:\n    - price.toFixed(2) == "1"\n`);
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
  const b = parsearBase(`filters:\n  not:\n    - price.toFixed(2) == "1"\n`);
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
  const b = parsearBase(`formulas:\n  x: "1+1"\nviews:\n  - type: table\n`);
  assert.equal(motivosNoEditable(b).length, 1);
  assert.match(motivosNoEditable(b)[0], /formulas/);
});

test("una clave de vista no modelada tambien la bloquea", () => {
  const b = parsearBase("views:\n  - type: table\n    name: X\n    groupBy:\n      property: estado\n");
  assert.match(motivosNoEditable(b)[0], /groupBy/);
});

test("un filtro no soportado bloquea la edición por UI", () => {
  const b = parsearBase(`filters:\n  and:\n    - price.toFixed(2) == "1"\n`);
  assert.match(motivosNoEditable(b)[0], /no se entiende/);
});

test("una condición numérica se escribe SIN comillas, para comparar como número", () => {
  assert.equal(expresionDe({ ref: "prioridad", op: ">", valor: "10" }), "prioridad > 10");
  assert.equal(expresionDe({ ref: "estado", op: "==", valor: "activo" }), 'estado == "activo"');
  assert.equal(expresionDe({ ref: "file", op: "hasTag", valor: "idea" }), 'file.hasTag("idea")');
  assert.equal(expresionDe({ ref: "notas", op: "isEmpty", valor: "" }), "notas.isEmpty()");
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

// ── FUN-M-27: el constructor de filtros con negacion y grupos ────────────────
// El motor ya sabia combinar (`Filtro` tiene and/or/not y `evaluar` los
// resuelve); lo que faltaba era poder representarlos en la UI. Estos tests
// cuidan las dos direcciones y, sobre todo, la GUARDA: lo que no se sabe
// mostrar sigue devolviendo null en vez de convertirse a medias.

const cond = (ref, op, valor) => ({ tipo: "cond", negado: false, cond: { ref, op, valor } });

test("sin filtros arranca con un grupo vacio, no con null", () => {
  assert.deepEqual(arbolDeFiltro(null), {
    tipo: "grupo",
    combinador: "and",
    negado: false,
    hijos: [],
  });
});

test("una lista plana se lee como un grupo con sus condiciones", () => {
  const b = parsearBase(`filters:
  and:
    - estado == "activo"
    - prioridad > 2
`);
  const a = arbolDeFiltro(b.filtros);
  assert.equal(a.tipo, "grupo");
  assert.equal(a.combinador, "and");
  assert.equal(a.hijos.length, 2);
  assert.deepEqual(a.hijos[0].cond, { ref: "estado", op: "==", valor: "activo" });
});

test("un filtro ANIDADO ahora SI se representa (antes daba null)", () => {
  const b = parsearBase(`
filters:
  or:
    - and:
        - estado == "activo"
        - prioridad > 1
    - file.hasTag("urgente")
`);
  const a = arbolDeFiltro(b.filtros);
  assert.equal(a.combinador, "or");
  assert.equal(a.hijos[0].tipo, "grupo", "el grupo anidado se conserva como grupo");
  assert.equal(a.hijos[0].combinador, "and");
  assert.equal(a.hijos[1].tipo, "cond");
});

test("un `not` de un solo hijo es una MARCA, no un nivel mas", () => {
  const b = parsearBase(`filters:
  not:
    - estado == "activo"
`);
  const a = arbolDeFiltro(b.filtros);
  // Para el usuario «no es activo» es UNA condicion, no dos anidadas.
  assert.equal(a.tipo, "cond");
  assert.equal(a.negado, true);
  assert.deepEqual(a.cond, { ref: "estado", op: "==", valor: "activo" });
});

test("un `not` de varios hijos niega su conjuncion", () => {
  const b = parsearBase(`filters:
  not:
    - estado == "activo"
    - prioridad > 1
`);
  const a = arbolDeFiltro(b.filtros);
  assert.equal(a.tipo, "grupo");
  assert.equal(a.combinador, "and");
  assert.equal(a.negado, true);
  assert.equal(a.hijos.length, 2);
});

test("LA GUARDA: una expresion fuera del subconjunto sigue dando null", () => {
  const b = parsearBase(`filters:
  and:
    - file.hasTag("a", "b")
`);
  assert.equal(
    arbolDeFiltro(b.filtros),
    null,
    "mostrarlo simplificado destruiria el filtro al guardar",
  );
});

test("volver al filtro: una condicion negada se envuelve en `not`", () => {
  const f = filtroDeArbol({
    tipo: "grupo",
    combinador: "and",
    negado: false,
    hijos: [{ tipo: "cond", negado: true, cond: { ref: "nombre", op: "startsWith", valor: "X" } }],
  });
  assert.equal(f.tipo, "and");
  assert.equal(f.hijos[0].tipo, "not");
  assert.ok(f.hijos[0].hijos[0].fuente.includes("startsWith"));
});

test("ida y vuelta: lo que se lee y se vuelve a escribir se puede releer igual", () => {
  const b = parsearBase(`
filters:
  or:
    - and:
        - estado == "activo"
        - prioridad > 1
    - file.hasTag("urgente")
`);
  const a = arbolDeFiltro(b.filtros);
  const f = filtroDeArbol(a);
  assert.deepEqual(arbolDeFiltro(f), a, "el arbol sobrevive al viaje al filtro y de vuelta");
});

test("ida y vuelta con negacion", () => {
  const b = parsearBase(`filters:
  not:
    - estado == "activo"
`);
  const a = arbolDeFiltro(b.filtros);
  assert.deepEqual(arbolDeFiltro(filtroDeArbol(a)), a);
});

test("una condicion a medias no llega al archivo, pero no rompe el resto", () => {
  const f = filtroDeArbol({
    tipo: "grupo",
    combinador: "and",
    negado: false,
    hijos: [cond("estado", "==", "activo"), cond("prioridad", ">", "")],
  });
  assert.equal(f.hijos.length, 1);
});

test("un grupo que se queda sin hijos utiles desaparece", () => {
  const f = filtroDeArbol({
    tipo: "grupo",
    combinador: "and",
    negado: false,
    hijos: [
      cond("estado", "==", "activo"),
      { tipo: "grupo", combinador: "or", negado: false, hijos: [cond("x", "==", "")] },
    ],
  });
  assert.equal(f.hijos.length, 1, "no se escribe un `or: []` que no filtra nada");
});

test("un arbol entero a medias no produce filtro", () => {
  assert.equal(
    filtroDeArbol({ tipo: "grupo", combinador: "and", negado: false, hijos: [cond("a", "==", "")] }),
    null,
  );
});

test("el filtro generado se EVALUA como se espera: «no empieza por X»", () => {
  const f = filtroDeArbol({
    tipo: "grupo",
    combinador: "and",
    negado: false,
    hijos: [{ tipo: "cond", negado: true, cond: { ref: "nombre", op: "startsWith", valor: "X" } }],
  });
  const conNombre = (valor) => nota({ props: [{ clave: "nombre", valor, tipo: "texto" }] });
  assert.equal(evaluar(f, conNombre("Xilofono")), false, "empieza por X: queda fuera");
  assert.equal(evaluar(f, conNombre("Arbol")), true, "no empieza por X: entra");
});


// ── FUN-S-15: ordenar por una columna ────────────────────────────────────────
// El motor ya ordenaba por lo que dijera `sort`; lo que faltaba era poder
// cambiarlo desde la cabecera sin destruir un `sort` de varias columnas.

test("el ciclo del clic normal: ascendente, descendente, sin orden", () => {
  let o = [];
  o = alternarOrden(o, "estado");
  assert.deepEqual(o, [{ propiedad: "estado", descendente: false }]);
  o = alternarOrden(o, "estado");
  assert.deepEqual(o, [{ propiedad: "estado", descendente: true }]);
  o = alternarOrden(o, "estado");
  assert.deepEqual(o, [], "volver al orden de la agregacion tiene que estar en el ciclo");
});

test("el clic normal en OTRA columna reemplaza el criterio y empieza en ascendente", () => {
  const o = alternarOrden([{ propiedad: "estado", descendente: true }], "prioridad");
  assert.deepEqual(o, [{ propiedad: "prioridad", descendente: false }]);
});

test("con varios criterios, el clic normal se queda con uno solo", () => {
  const previo = [
    { propiedad: "estado", descendente: false },
    { propiedad: "prioridad", descendente: true },
  ];
  // Aunque la columna ya estuviera en la lista: si no era la unica, el clic
  // empieza de cero en vez de continuar un ciclo que no se ve.
  assert.deepEqual(alternarOrden(previo, "prioridad"), [
    { propiedad: "prioridad", descendente: false },
  ]);
});

test("shift+clic SUMA un criterio en vez de reemplazar", () => {
  let o = [{ propiedad: "estado", descendente: false }];
  o = alternarOrden(o, "prioridad", true);
  assert.deepEqual(o, [
    { propiedad: "estado", descendente: false },
    { propiedad: "prioridad", descendente: false },
  ]);
  o = alternarOrden(o, "estado", true);
  assert.equal(o[0].descendente, true, "el primero cambia de sentido sin moverse de sitio");
  assert.equal(o.length, 2);
  o = alternarOrden(o, "estado", true);
  assert.deepEqual(o, [{ propiedad: "prioridad", descendente: false }], "el tercer paso lo quita");
});

test("ordenDeColumna dice el sentido y la posicion, en base 1", () => {
  const o = [
    { propiedad: "estado", descendente: false },
    { propiedad: "prioridad", descendente: true },
  ];
  assert.deepEqual(ordenDeColumna(o, "estado"), { descendente: false, posicion: 1 });
  assert.deepEqual(ordenDeColumna(o, "prioridad"), { descendente: true, posicion: 2 });
  assert.equal(ordenDeColumna(o, "otra"), null);
});

test("ordenar de verdad: por numero, no por texto", () => {
  const b = parsearBase(`filters:
  and:
    - file.hasProperty("n")
views:
  - type: table
    name: t
    order:
      - file.name
      - n
    sort:
      - property: n
        direction: ASC
`);
  const conN = (id, n) => nota({ id, props: [{ clave: "n", valor: n, tipo: "numero" }] });
  const t = construirTabla(b, b.vistas[0], [conN("a", "10"), conN("b", "9"), conN("c", "100")]);
  assert.deepEqual(
    t.filas.map((f) => f.nota.id),
    ["b", "a", "c"],
    "9 < 10 < 100; como texto seria 10, 100, 9",
  );
});

test("lo que no tiene valor va al final en LAS DOS direcciones", () => {
  const fuente = (dir) =>
    `views:
  - type: table
    name: t
    order:
      - file.name
      - n
    sort:
      - property: n
        direction: ${dir}
`;
  const conN = (id, n) =>
    nota({ id, props: n === null ? [] : [{ clave: "n", valor: n, tipo: "numero" }] });
  const notas = [conN("sin", null), conN("a", "2"), conN("b", "1")];

  const asc = parsearBase(fuente("ASC"));
  assert.deepEqual(
    construirTabla(asc, asc.vistas[0], notas).filas.map((f) => f.nota.id),
    ["b", "a", "sin"],
  );
  const desc = parsearBase(fuente("DESC"));
  assert.deepEqual(
    construirTabla(desc, desc.vistas[0], notas).filas.map((f) => f.nota.id),
    ["a", "b", "sin"],
    "si las vacias siguieran el orden natural, en una direccion taparian la tabla",
  );
});

// ── FUN-S-14: buscar dentro de la tabla ──────────────────────────────────────

test("la busqueda ignora tildes y mayusculas", () => {
  assert.equal(normalizarTexto("Diseño Ágil"), "diseno agil");
  assert.equal(filaCoincide([["Rediseño del API"]], { texto: "diseno", exacta: false }), true);
});

test("exacta compara el valor ENTERO de una celda, no un trozo", () => {
  const celdas = [["idea", "ideario"]];
  assert.equal(filaCoincide(celdas, { texto: "idea", exacta: true }), true);
  assert.equal(filaCoincide(celdas, { texto: "ide", exacta: true }), false);
  assert.equal(filaCoincide(celdas, { texto: "ide", exacta: false }), true);
});

test("una busqueda vacia no esconde nada", () => {
  assert.equal(filaCoincide([undefined, ["x"]], { texto: "   ", exacta: true }), true);
});

test("una columna sin valor no rompe la busqueda", () => {
  assert.equal(filaCoincide([undefined], { texto: "x", exacta: false }), false);
});

test("la busqueda se aplica DESPUES del limite, y se dice cuantas escondio", () => {
  const b = parsearBase(
    `views:
  - type: table
    name: t
    limit: 2
    order:
      - file.name
`,
  );
  const notas = [
    nota({ id: "a", nombre: "Alfa" }),
    nota({ id: "b", nombre: "Beta" }),
    nota({ id: "c", nombre: "Alfa tambien" }),
  ];
  const t = construirTabla(b, b.vistas[0], notas, { busqueda: { texto: "alfa", exacta: false } });
  assert.equal(t.total, 3, "el total sigue contando lo que pasa los filtros");
  assert.equal(t.recortadas, 1, "el limite dejo fuera una");
  assert.deepEqual(t.filas.map((f) => f.nota.id), ["a"]);
  assert.equal(t.ocultasPorBusqueda, 1, "de las dos que quedaban, «Beta» no coincide");
});

test("la busqueda mira solo las columnas MOSTRADAS", () => {
  const b = parsearBase(`views:
  - type: table
    name: t
    order:
      - file.name
`);
  const n = nota({ id: "a", nombre: "Alfa", props: [{ clave: "estado", valor: "activo", tipo: "texto" }] });
  const t = construirTabla(b, b.vistas[0], [n], { busqueda: { texto: "activo", exacta: false } });
  assert.equal(t.filas.length, 0, "«estado» no es una columna de esta vista");
});
