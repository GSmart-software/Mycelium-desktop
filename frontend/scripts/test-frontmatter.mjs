// Test headless (sin navegador ni Tauri) del parser de frontmatter YAML
// (`FUN-M-04`). El módulo bajo prueba (`lib/frontmatter.ts`) es puro —sin
// imports—, así que se transpila en el momento con el compilador de TypeScript
// (devDep ya instalada) y se importa vía data: URL, igual que
// `scripts/test-nombres.mjs`. No hace falta framework de test ni build previo.
//
//   node --test scripts/test-frontmatter.mjs
//   node scripts/test-frontmatter.mjs
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import ts from "typescript";

const rutaTs = fileURLToPath(new URL("../lib/frontmatter.ts", import.meta.url));
const fuente = await readFile(rutaTs, "utf8");
const { outputText } = ts.transpileModule(fuente, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 },
});
const mod = await import(`data:text/javascript,${encodeURIComponent(outputText)}`);
const {
  separarFrontmatter,
  cuerpoDe,
  etiquetasDe,
  propiedadDe,
  ponerPropiedad,
  quitarPropiedad,
  renombrarPropiedad,
  valorComoTexto,
  valorInicialDe,
  convertirValor,
  NOMBRE_TIPO,
  TIPOS_PROPIEDAD,
} = mod;

/** Frontmatter mínimo de referencia, con los seis tipos soportados. */
const SEIS_TIPOS = [
  "---",
  "estado: activo",
  "prioridad: 3",
  "publicado: false",
  "vence: 2026-08-30",
  "reunion: 2026-08-30T15:00",
  "tags: [proyecto, activo]",
  "---",
  "",
  "# Mi nota",
].join("\n");

// ── Detección del bloque ──────────────────────────────────────────────────────

test("sin bloque: el texto es contenido normal", () => {
  const fm = separarFrontmatter("# Título\n\nTexto suelto.");
  assert.equal(fm.hay, false);
  assert.equal(fm.cuerpoDesde, 0);
  assert.equal(cuerpoDe("# Título\n\nTexto."), "# Título\n\nTexto.");
});

test("bloque vacío es frontmatter válido, sin propiedades", () => {
  const fm = separarFrontmatter("---\n---\n# Hola");
  assert.equal(fm.hay, true);
  assert.equal(fm.soportado, true);
  assert.deepEqual(fm.props, []);
  assert.equal(fm.cuerpoDesde, 2);
  assert.equal(cuerpoDe("---\n---\n# Hola"), "# Hola");
});

test("un `---` que no está en la primera línea es una regla horizontal", () => {
  const texto = "# Título\n\n---\nestado: activo\n---\n";
  assert.equal(separarFrontmatter(texto).hay, false);
  assert.equal(cuerpoDe(texto), texto);
});

test("sin cierre no hay frontmatter (no se adivina)", () => {
  const texto = "---\nestado: activo\n\n# Título";
  assert.equal(separarFrontmatter(texto).hay, false);
  assert.equal(cuerpoDe(texto), texto);
});

test("el cierre también puede ser `...`", () => {
  const fm = separarFrontmatter("---\nestado: activo\n...\ncuerpo");
  assert.equal(fm.hay, true);
  assert.equal(fm.soportado, true);
  assert.equal(fm.props.length, 1);
  assert.equal(cuerpoDe("---\nestado: activo\n...\ncuerpo"), "cuerpo");
});

test("la primera línea debe ser exactamente `---` (sin espacios delante)", () => {
  assert.equal(separarFrontmatter(" ---\nestado: activo\n---\n").hay, false);
  assert.equal(separarFrontmatter("--- \nestado: activo\n---\n").hay, false);
});

// ── Los seis tipos ────────────────────────────────────────────────────────────

test("infiere los seis tipos por el literal", () => {
  const { props } = separarFrontmatter(SEIS_TIPOS);
  assert.deepEqual(
    props.map((p) => [p.clave, p.tipo, p.valor]),
    [
      ["estado", "texto", "activo"],
      ["prioridad", "numero", 3],
      ["publicado", "casilla", false],
      ["vence", "fecha", "2026-08-30"],
      ["reunion", "fechaHora", "2026-08-30T15:00"],
      ["tags", "lista", ["proyecto", "activo"]],
    ],
  );
});

test("un escalar entrecomillado es SIEMPRE texto", () => {
  const { props } = separarFrontmatter('---\nversion: "1.0"\nfecha: "2026-08-30"\n---\n');
  assert.deepEqual(props.map((p) => [p.tipo, p.valor]), [
    ["texto", "1.0"],
    ["texto", "2026-08-30"],
  ]);
});

test("las posiciones son líneas 0-based del documento", () => {
  const { props } = separarFrontmatter(SEIS_TIPOS);
  assert.equal(props[0].desdeLinea, 1);
  assert.equal(props[0].hastaLinea, 1);
  assert.equal(props[5].desdeLinea, 6);
});

// ── Listas ────────────────────────────────────────────────────────────────────

test("lista en línea y lista en bloque dan el mismo valor", () => {
  const enLinea = separarFrontmatter("---\ntags: [a, b]\n---\n").props[0];
  const enBloque = separarFrontmatter("---\ntags:\n- a\n- b\n---\n").props[0];
  const indentada = separarFrontmatter("---\ntags:\n  - a\n  - b\n---\n").props[0];
  assert.deepEqual(enLinea.valor, ["a", "b"]);
  assert.deepEqual(enBloque.valor, ["a", "b"]);
  assert.deepEqual(indentada.valor, ["a", "b"]);
  assert.equal(enBloque.desdeLinea, 1);
  assert.equal(enBloque.hastaLinea, 3); // la lista en bloque ocupa varias líneas
});

test("lista vacía y elementos entrecomillados", () => {
  assert.deepEqual(separarFrontmatter("---\notros: []\n---\n").props[0].valor, []);
  assert.deepEqual(
    separarFrontmatter('---\notros: ["a, con coma", b]\n---\n').props[0].valor,
    ["a, con coma", "b"],
  );
});

test("`tags` es siempre lista, aunque venga como escalar, y acepta `#`", () => {
  assert.deepEqual(separarFrontmatter("---\ntags: idea\n---\n").props[0].valor, ["idea"]);
  assert.equal(separarFrontmatter("---\ntags: idea\n---\n").props[0].tipo, "lista");
  assert.deepEqual(separarFrontmatter("---\ntags:\n- #idea\n- otra\n---\n").props[0].valor, [
    "idea",
    "otra",
  ]);
});

// ── Etiquetas ─────────────────────────────────────────────────────────────────

test("etiquetasDe une el frontmatter con los #tag del cuerpo", () => {
  const texto = "---\ntags: [proyecto, activo]\n---\n\n# Nota\n\nTexto con #idea y #activo.";
  assert.deepEqual(etiquetasDe(texto), ["proyecto", "activo", "idea"]);
});

test("los comentarios del YAML no se cuelan como etiquetas", () => {
  const texto = "---\n# esto no es una etiqueta\nestado: activo\n---\n\nCuerpo.";
  assert.deepEqual(etiquetasDe(texto), []);
});

// ── Comentarios ───────────────────────────────────────────────────────────────

test("las líneas de comentario se ignoran y no rompen el bloque", () => {
  const { props, soportado } = separarFrontmatter(
    "---\n# metadatos de la nota\nestado: activo\n# otra cosa\nprioridad: 1\n---\n",
  );
  assert.equal(soportado, true);
  assert.deepEqual(props.map((p) => p.clave), ["estado", "prioridad"]);
});

test("el comentario al final de la línea no entra en el valor", () => {
  const p = separarFrontmatter("---\nestado: activo # en curso\n---\n").props[0];
  assert.equal(p.valor, "activo");
  assert.equal(p.comentario, "# en curso");
});

test("un `#` sin espacio delante es parte del valor", () => {
  const p = separarFrontmatter("---\nurl: http://x.com#ancla\n---\n").props[0];
  assert.equal(p.valor, "http://x.com#ancla");
});

test("los comentarios se preservan al editar otras propiedades", () => {
  const texto = "---\n# cabecera\nestado: activo\nprioridad: 1 # urgente\n---\n\nCuerpo.";
  const nuevo = ponerPropiedad(texto, "estado", "cerrado");
  assert.equal(
    nuevo,
    "---\n# cabecera\nestado: cerrado\nprioridad: 1 # urgente\n---\n\nCuerpo.",
  );
});

// ── Frontmatter no soportado ──────────────────────────────────────────────────

const NO_SOPORTADOS = {
  "mapa anidado": "---\nautor:\n  nombre: Ana\n---\n",
  "lista de mapas": "---\nlibros:\n- titulo: X\n  autor: Y\n---\n",
  "escalar multilínea": "---\nresumen: |\n  varias\n  líneas\n---\n",
  ancla: "---\nbase: &ancla valor\n---\n",
  alias: "---\notro: *ancla\n---\n",
  etiqueta: "---\ncosa: !!str 3\n---\n",
  "mapa en línea": "---\nautor: {nombre: Ana}\n---\n",
  "clave repetida": "---\nestado: a\nestado: b\n---\n",
};

for (const [caso, texto] of Object.entries(NO_SOPORTADOS)) {
  test(`no soportado: ${caso}`, () => {
    const fm = separarFrontmatter(texto);
    assert.equal(fm.hay, true);
    assert.equal(fm.soportado, false);
    assert.ok(typeof fm.motivo === "string" && fm.motivo.length > 0);
    // El cuerpo sigue separándose bien: el bloque no se renderiza como markdown.
    assert.equal(cuerpoDe(texto), "");
  });
}

test("un bloque no soportado NO se puede editar (la guarda va en el parser)", () => {
  const texto = NO_SOPORTADOS["mapa anidado"];
  assert.throws(() => ponerPropiedad(texto, "estado", "activo"), /no interpreta/);
  assert.throws(() => quitarPropiedad(texto, "autor"), /no interpreta/);
  assert.throws(() => renombrarPropiedad(texto, "autor", "escritor"), /no interpreta/);
});

// ── Edición quirúrgica ────────────────────────────────────────────────────────

test("cambiar un valor toca SOLO esa línea", () => {
  const nuevo = ponerPropiedad(SEIS_TIPOS, "prioridad", 5);
  const antes = SEIS_TIPOS.split("\n");
  const despues = nuevo.split("\n");
  assert.equal(antes.length, despues.length);
  const distintas = antes.map((l, i) => (l === despues[i] ? null : i)).filter((i) => i !== null);
  assert.deepEqual(distintas, [2]);
  assert.equal(despues[2], "prioridad: 5");
});

test("añadir a una nota CON frontmatter inserta antes del cierre", () => {
  const nuevo = ponerPropiedad("---\nestado: activo\n---\n\n# Nota", "autor", "Ana");
  assert.equal(nuevo, "---\nestado: activo\nautor: Ana\n---\n\n# Nota");
});

test("añadir a una nota SIN frontmatter crea el bloque sin comerse la 1ª línea", () => {
  const nuevo = ponerPropiedad("# Mi nota\n\nTexto.", "estado", "activo");
  assert.equal(nuevo, "---\nestado: activo\n---\n\n# Mi nota\n\nTexto.");
  assert.equal(cuerpoDe(nuevo), "\n# Mi nota\n\nTexto.");
});

test("añadir a un bloque vacío", () => {
  assert.equal(ponerPropiedad("---\n---\ncuerpo", "estado", "activo"), "---\nestado: activo\n---\ncuerpo");
});

test("el estilo de la lista se conserva (bloque sigue bloque, línea sigue línea)", () => {
  const bloque = "---\ntags:\n- a\n- b\n---\n";
  assert.equal(ponerPropiedad(bloque, "tags", ["a", "b", "c"]), "---\ntags:\n- a\n- b\n- c\n---\n");
  const linea = "---\ntags: [a, b]\n---\n";
  assert.equal(ponerPropiedad(linea, "tags", ["a", "c"]), "---\ntags: [a, c]\n---\n");
});

test("un texto que parece otro tipo se entrecomilla para releerse igual", () => {
  const nuevo = ponerPropiedad("---\n---\n", "version", "1.0", "texto");
  assert.equal(nuevo, '---\nversion: "1.0"\n---\n');
  assert.equal(propiedadDe(nuevo, "version").tipo, "texto");
  assert.equal(propiedadDe(nuevo, "version").valor, "1.0");
});

test("quitar una propiedad borra sus líneas (la lista en bloque, todas)", () => {
  assert.equal(quitarPropiedad("---\nestado: a\ntags:\n- x\n- y\n---\nc", "tags"), "---\nestado: a\n---\nc");
  assert.equal(quitarPropiedad("---\nestado: a\n---\nc", "estado"), "---\n---\nc");
  // Quitar algo que no está no cambia nada.
  assert.equal(quitarPropiedad("---\nestado: a\n---\nc", "otra"), "---\nestado: a\n---\nc");
});

test("renombrar conserva valor, espaciado y comentario de la línea", () => {
  assert.equal(
    renombrarPropiedad("---\nestado:   activo # en curso\n---\n", "estado", "situacion"),
    "---\nsituacion:   activo # en curso\n---\n",
  );
  assert.throws(
    () => renombrarPropiedad("---\na: 1\nb: 2\n---\n", "a", "b"),
    /Ya existe/,
  );
});

// ── Metadatos de los tipos, compartidos por el panel y el widget (FUN-M-19) ───

test("los seis tipos tienen nombre visible", () => {
  assert.deepEqual(TIPOS_PROPIEDAD, ["texto", "numero", "casilla", "fecha", "fechaHora", "lista"]);
  for (const tipo of TIPOS_PROPIEDAD) {
    assert.equal(typeof NOMBRE_TIPO[tipo], "string", `falta el nombre de ${tipo}`);
  }
});

test("el valor inicial de cada tipo se relee como ese mismo tipo", () => {
  for (const tipo of TIPOS_PROPIEDAD) {
    const texto = ponerPropiedad("---\n---\n", "campo", valorInicialDe(tipo), tipo);
    assert.equal(propiedadDe(texto, "campo").tipo, tipo, `el tipo ${tipo} no sobrevive`);
  }
});

test("valorComoTexto da lo que se edita en un input", () => {
  const fm = separarFrontmatter(SEIS_TIPOS);
  const como = Object.fromEntries(fm.props.map((p) => [p.clave, valorComoTexto(p)]));
  assert.equal(como.estado, "activo");
  assert.equal(como.prioridad, "3");
  assert.equal(como.publicado, "false");
  assert.equal(como.vence, "2026-08-30");
  assert.equal(como.tags, "proyecto, activo");
  // `datetime-local` exige la `T`, aunque el YAML admita también el espacio.
  assert.equal(como.reunion, "2026-08-30T15:00");
  const conEspacio = propiedadDe("---\nreunion: 2026-08-30 15:00\n---\n", "reunion");
  assert.equal(valorComoTexto(conEspacio), "2026-08-30T15:00");
});

// ── El cuerpo NO se toca ──────────────────────────────────────────────────────
//
// Es lo que hace posible el dispatch al rango mínimo de `FUN-M-19`:
// `aplicarEdicionFrontmatter` (lib/editor/commands.ts) reemplaza SOLO el bloque
// y usa el cuerpo de ancla. Si alguna de estas funciones tocara el cuerpo, el
// widget escribiría un rango equivocado y `Ctrl+Z` dejaría de revertir la
// operación para revertir medio documento.

test("ninguna edición modifica el cuerpo de la nota", () => {
  const cuerpo = "\n# Mi nota\n\nTexto con --- y con `tags:` adentro.\n";
  const doc = "---\nestado: activo\ntags: [a, b]\n---" + cuerpo;
  const ediciones = [
    (t) => ponerPropiedad(t, "estado", "cerrado"),
    (t) => ponerPropiedad(t, "nueva", 3, "numero"),
    (t) => ponerPropiedad(t, "tags", ["a", "b", "c"], "lista"),
    (t) => quitarPropiedad(t, "estado"),
    (t) => renombrarPropiedad(t, "estado", "situacion"),
  ];
  for (const editar of ediciones) {
    const nuevo = editar(doc);
    assert.ok(nuevo.endsWith(cuerpo), `una edición tocó el cuerpo: ${JSON.stringify(nuevo)}`);
    assert.equal(cuerpoDe(nuevo), cuerpoDe(doc));
  }
});

test("crear el bloque en una nota sin frontmatter conserva el texto entero", () => {
  const doc = "# Mi nota\n\nTexto.\n";
  assert.ok(ponerPropiedad(doc, "estado", "activo").endsWith(doc));
});

// ── Fin de línea ──────────────────────────────────────────────────────────────

test("un archivo con CRLF no se convierte a LF al editar", () => {
  const crlf = "---\r\nestado: activo\r\nprioridad: 1\r\n---\r\n\r\n# Nota\r\n";
  const fm = separarFrontmatter(crlf);
  assert.equal(fm.soportado, true);
  assert.deepEqual(fm.props.map((p) => [p.clave, p.valor]), [
    ["estado", "activo"],
    ["prioridad", 1],
  ]);

  const editado = ponerPropiedad(crlf, "estado", "cerrado");
  assert.equal(editado, "---\r\nestado: cerrado\r\nprioridad: 1\r\n---\r\n\r\n# Nota\r\n");
  assert.ok(!/[^\r]\n/.test(editado), "quedó alguna línea con LF suelto");

  const agregado = ponerPropiedad(crlf, "autor", "Ana");
  assert.equal(
    agregado,
    "---\r\nestado: activo\r\nprioridad: 1\r\nautor: Ana\r\n---\r\n\r\n# Nota\r\n",
  );

  const creado = ponerPropiedad("# Nota\r\n\r\nTexto.\r\n", "estado", "activo");
  assert.equal(creado, "---\r\nestado: activo\r\n---\r\n\r\n# Nota\r\n\r\nTexto.\r\n");
});

// ── DEF-070: cambiar el tipo de una propiedad sin perder su valor ────────────
// La regla es conservar todo lo que se pueda, y caer al valor inicial del tipo
// destino solo cuando lo que hay no significa nada ahí.

test("a texto: todo se puede leer como texto", () => {
  assert.equal(convertirValor(3, "texto"), "3");
  assert.equal(convertirValor(true, "texto"), "true");
  assert.equal(convertirValor("2026-01-02", "texto"), "2026-01-02");
});

test("a numero: se conserva el numero, y la coma decimal tambien", () => {
  assert.equal(convertirValor("42", "numero"), 42);
  assert.equal(convertirValor("3,5", "numero"), 3.5);
  assert.equal(convertirValor(true, "numero"), 1);
  assert.equal(convertirValor(false, "numero"), 0);
});

test("a numero: lo que no es un numero da 0, no un invento", () => {
  assert.equal(convertirValor("hola", "numero"), 0);
  assert.equal(convertirValor("", "numero"), 0);
});

test("a casilla: solo lo que el texto dice que es verdadero", () => {
  for (const v of ["true", "sí", "si", "1", "yes", "on", "VERDADERO"]) {
    assert.equal(convertirValor(v, "casilla"), true, `${v} deberia ser verdadero`);
  }
  for (const v of ["false", "no", "0", "cualquier cosa", ""]) {
    assert.equal(convertirValor(v, "casilla"), false, `${v} deberia ser falso`);
  }
  assert.equal(convertirValor(7, "casilla"), true);
  assert.equal(convertirValor(0, "casilla"), false);
});

test("fechaHora a fecha: se corta la hora, NO se tira la fecha", () => {
  assert.equal(convertirValor("2026-03-04T15:30", "fecha"), "2026-03-04");
  assert.equal(convertirValor("2026-03-04 15:30", "fecha"), "2026-03-04");
});

test("fecha a fechaHora: se agrega la medianoche", () => {
  assert.equal(convertirValor("2026-03-04", "fechaHora"), "2026-03-04T00:00");
});

test("a fecha: sin una fecha dentro, se cae a hoy (igual que al crearla)", () => {
  assert.equal(convertirValor("hola", "fecha"), valorInicialDe("fecha"));
  assert.equal(convertirValor("", "fechaHora"), valorInicialDe("fechaHora"));
});

test("a lista: un escalar queda como UN elemento", () => {
  assert.deepEqual(convertirValor("uno", "lista"), ["uno"]);
  assert.deepEqual(convertirValor(3, "lista"), ["3"]);
});

test("a lista: lo vacio da lista vacia, no un elemento vacio", () => {
  assert.deepEqual(convertirValor("", "lista"), []);
  assert.deepEqual(convertirValor(false, "lista"), []);
});

test("a lista: una lista se queda como esta", () => {
  assert.deepEqual(convertirValor(["a", "b"], "lista"), ["a", "b"]);
});

test("de lista a escalar: se unen los elementos y se releen en el destino", () => {
  assert.equal(convertirValor(["a", "b"], "texto"), "a, b");
  assert.equal(convertirValor(["7"], "numero"), 7);
  // Lo que importa: una lista con UNA fecha conserva la fecha en vez de tirarla.
  assert.equal(convertirValor(["2026-03-04"], "fecha"), "2026-03-04");
});

test("convertir al MISMO tipo no cambia nada", () => {
  assert.equal(convertirValor("hola", "texto"), "hola");
  assert.equal(convertirValor(5, "numero"), 5);
  assert.equal(convertirValor(true, "casilla"), true);
  assert.deepEqual(convertirValor(["a"], "lista"), ["a"]);
  assert.equal(convertirValor("2026-03-04", "fecha"), "2026-03-04");
});

test("el valor convertido se puede escribir y releer con el tipo nuevo", () => {
  const texto = ["---", "cuando: 2026-03-04T15:30", "---", "", "cuerpo"].join(String.fromCharCode(10));
  const nuevo = ponerPropiedad(texto, "cuando", convertirValor("2026-03-04T15:30", "fecha"), "fecha");
  const p = propiedadDe(nuevo, "cuando");
  assert.equal(p.tipo, "fecha");
  assert.equal(p.valor, "2026-03-04");
});
