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
