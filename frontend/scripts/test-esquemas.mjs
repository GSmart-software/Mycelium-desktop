// Test headless de los esquemas de propiedades (`FUN-M-46`): la lógica pura de
// `lib/esquemas.ts` —leer `esquemas.yml`, a qué notas aplica cada esquema, cada
// clase de aviso, la combinación de varios esquemas y el aviso del `#` sin
// comillas (casos que avisan y casos que no)—.
//
//   node --test scripts/test-esquemas.mjs
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

const E = await import(
  await fuente("../lib/esquemas.ts", {
    "@/lib/bases": await fuente("../lib/bases.ts"),
    "@/lib/frontmatter": await fuente("../lib/frontmatter.ts"),
  })
);

const ARCHIVO = `# Esquemas del vault
Proyecto:
  carpeta: Proyectos   # y subcarpetas
  obligatorias: [estado, inicio]
  propiedades:
    estado:
      tipo: texto
      valores: [activo, pausado, cerrado]
    inicio: fecha
    prioridad:
      tipo: número
Reunión:
  tipo_de_nota: reunion
  propiedades:
    fecha:
      tipo: fecha
      obligatoria: true
    asistentes: lista
Todo el vault:
  obligatorias: [creado]
`;

const nota = (id) => {
  const b = id.lastIndexOf("/");
  return { id, carpetaId: b < 0 ? null : id.slice(0, b), tipo: "markdown" };
};
const fm = (...lineas) => ["---", ...lineas, "---", "", "Cuerpo"].join("\n");
const clases = (avisos) => avisos.map((a) => `${a.clase}:${a.clave}`).sort();

// ── El archivo ───────────────────────────────────────────────────────────────

test("parsearEsquemas: lee los tres esquemas, con tipos, valores y obligatorias", () => {
  const { esquemas, avisos } = E.parsearEsquemas(ARCHIVO);
  assert.deepEqual(avisos, []);
  assert.deepEqual(esquemas.map((e) => e.nombre), ["Proyecto", "Reunión", "Todo el vault"]);
  const [p, r, t] = esquemas;
  assert.deepEqual(p.carpetas, ["Proyectos"]); // sin el comentario final
  assert.deepEqual(p.obligatorias, ["estado", "inicio"]);
  assert.equal(p.propiedades.get("estado").tipo, "texto");
  assert.deepEqual(p.propiedades.get("estado").valores, ["activo", "pausado", "cerrado"]);
  assert.equal(p.propiedades.get("inicio").tipo, "fecha");
  assert.equal(p.propiedades.get("prioridad").tipo, "numero"); // «número» con tilde
  assert.deepEqual(r.tiposDeNota, ["reunion"]);
  assert.deepEqual(r.obligatorias, ["fecha"]); // `obligatoria: true` dentro de la regla
  assert.equal(r.propiedades.get("asistentes").tipo, "lista");
  assert.deepEqual(t.carpetas, []);
});

test("parsearEsquemas: vacío o solo comentarios es válido y sin esquemas", () => {
  assert.deepEqual(E.parsearEsquemas(""), { esquemas: [], avisos: [] });
  assert.deepEqual(E.parsearEsquemas("# nada todavía\n"), { esquemas: [], avisos: [] });
});

test("parsearEsquemas: YAML ilegible no lanza, da cero esquemas y un aviso con línea", () => {
  const r = E.parsearEsquemas("Proyecto:\n  carpeta: X\n    mal: sangria\n");
  assert.equal(r.esquemas.length, 0);
  assert.equal(r.avisos.length, 1);
  assert.match(r.avisos[0].mensaje, /esquemas\.yml no se puede leer/);
  assert.equal(typeof r.avisos[0].linea, "number");
});

test("parsearEsquemas: lo inválido se ignora con aviso y lo demás se aplica", () => {
  const r = E.parsearEsquemas(
    [
      "Malo: un texto",
      "Bueno:",
      "  carpeta: A",
      "  colores: rojo",
      "  propiedades:",
      "    x: desconocido",
      "    y:",
      "      tipo: fecha",
      "      valores: [a, b]",
      "    z: { tipo: fecha }",
    ].join("\n"),
  );
  assert.deepEqual(r.esquemas.map((e) => e.nombre), ["Bueno"]);
  const b = r.esquemas[0];
  assert.equal(b.propiedades.get("x").tipo, null); // tipo desconocido: sin tipo
  assert.equal(b.propiedades.get("y").tipo, "fecha");
  assert.equal(b.propiedades.get("z").tipo, null); // mapa en línea
  const textos = r.avisos.map((a) => a.mensaje).join("\n");
  assert.match(textos, /Esquema «Malo»/);
  assert.match(textos, /«colores» no es una clave de esquema/);
  assert.match(textos, /el tipo «desconocido» no existe/);
  assert.match(textos, /mapas en línea/);
});

// ── A qué notas aplica ───────────────────────────────────────────────────────

test("esquemasDe: por carpeta con subcarpetas, por tipo de nota, y el de todo el vault", () => {
  const { esquemas } = E.parsearEsquemas(ARCHIVO);
  const nombres = (n, tipo) => E.esquemasDe(nota(n), tipo, esquemas).map((e) => e.nombre);
  assert.deepEqual(nombres("Proyectos/A.md"), ["Proyecto", "Todo el vault"]);
  assert.deepEqual(nombres("Proyectos/2026/B.md"), ["Proyecto", "Todo el vault"]);
  assert.deepEqual(nombres("proyectos/C.md"), ["Proyecto", "Todo el vault"]); // sin mayúsculas
  assert.deepEqual(nombres("ProyectosViejos/D.md"), ["Todo el vault"]); // no es subcarpeta
  assert.deepEqual(nombres("Notas/R.md", "Reunion"), ["Reunión", "Todo el vault"]);
  assert.deepEqual(nombres("Notas/R.md", ["idea", "reunion"]), ["Reunión", "Todo el vault"]);
  assert.deepEqual(E.esquemasDe({ ...nota("Proyectos/L.canvas"), tipo: "canvas" }, undefined, esquemas), []);
});

test("esquemasDe: carpeta y tipo_de_nota juntos tienen que cumplirse los dos", () => {
  const { esquemas } = E.parsearEsquemas("X:\n  carpeta: A\n  tipo_de_nota: [acta, minuta]\n");
  assert.equal(E.esquemasDe(nota("A/n.md"), "acta", esquemas).length, 1);
  assert.equal(E.esquemasDe(nota("A/n.md"), "idea", esquemas).length, 0);
  assert.equal(E.esquemasDe(nota("B/n.md"), "acta", esquemas).length, 0);
});

// ── Los avisos ───────────────────────────────────────────────────────────────

test("validarPropiedades: una nota que cumple no tiene avisos", () => {
  const { esquemas } = E.parsearEsquemas(ARCHIVO);
  const t = fm("estado: Activo", "inicio: 2026-11-01", "prioridad: 2", "creado: 2026-10-01");
  assert.deepEqual(E.validarPropiedades(nota("Proyectos/A.md"), t, esquemas), []);
});

test("validarPropiedades: falta, vacía, tipo incorrecto y valor no permitido", () => {
  const { esquemas } = E.parsearEsquemas(ARCHIVO);
  const t = fm("estado: abierto", "inicio: mañana", "prioridad: alta", "creado:");
  const a = E.validarPropiedades(nota("Proyectos/A.md"), t, esquemas);
  assert.deepEqual(clases(a), ["tipo:inicio", "tipo:prioridad", "vacia:creado", "valor:estado"]);
  const valor = a.find((x) => x.clase === "valor");
  assert.equal(valor.linea, 2);
  assert.match(valor.mensaje, /no admite «abierto»/);
  assert.match(valor.mensaje, /activo, pausado, cerrado/);
  assert.match(a.find((x) => x.clave === "inicio").mensaje, /fecha \(AAAA-MM-DD\), y es texto/);
  assert.deepEqual(valor.esquemas, ["Proyecto"]);
  assert.match(E.textoDeAviso(valor), /\(esquema «Proyecto»\)$/);

  const sinNada = E.validarPropiedades(nota("Proyectos/B.md"), "Sin frontmatter", esquemas);
  assert.deepEqual(clases(sinNada), ["falta:creado", "falta:estado", "falta:inicio"]);
  assert.ok(sinNada.every((x) => x.linea === 1));
});

test("validarPropiedades: lista con un elemento no permitido; texto admite números", () => {
  const { esquemas } = E.parsearEsquemas("L:\n  propiedades:\n    estado:\n      valores: [a, b]\n    codigo: texto\n    xs: lista\n");
  const a = E.validarPropiedades(nota("n.md"), fm("estado: [a, c]", "codigo: 42", "xs: suelto"), esquemas);
  assert.deepEqual(clases(a), ["tipo:xs", "valor:estado"]);
  assert.match(a.find((x) => x.clase === "valor").mensaje, /no admite «c»/);
});

test("validarPropiedades: varios esquemas se combinan y el aviso repetido sale una vez", () => {
  const { esquemas } = E.parsearEsquemas(
    "A:\n  carpeta: P\n  obligatorias: [estado]\nB:\n  carpeta: P/Sub\n  obligatorias: [estado, dueño]\n",
  );
  const a = E.validarPropiedades(nota("P/Sub/n.md"), fm("titulo: x"), esquemas);
  assert.deepEqual(clases(a), ["falta:dueño", "falta:estado"]);
  assert.deepEqual(a.find((x) => x.clave === "estado").esquemas, ["A", "B"]);
  assert.match(E.textoDeAviso(a.find((x) => x.clave === "estado")), /esquemas «A», «B»/);
});

test("validarPropiedades: frontmatter no soportado avisa que no se puede validar", () => {
  const { esquemas } = E.parsearEsquemas("A:\n  obligatorias: [x]\n");
  const a = E.validarPropiedades(nota("n.md"), fm("mapa:", "  anidado: 1"), esquemas);
  assert.deepEqual(clases(a), ["nosoportado:null"]);
});

test("validarPropiedades: las excluidas (Esporas) no se validan contra esquemas", () => {
  const { esquemas } = E.parsearEsquemas("A:\n  obligatorias: [x]\n");
  assert.deepEqual(E.validarPropiedades(nota("Esporas/R.md"), fm("y: 1"), esquemas, { excluida: true }), []);
});

// ── El `#` sin comillas ──────────────────────────────────────────────────────

test("#: avisa un valor escalar y un elemento de lista en bloque", () => {
  const t = fm("Issue: #24", "refs:", "  - ok", "  - #12", "otro:#x");
  const a = E.avisosAlmohadilla(t);
  assert.deepEqual(a.map((x) => [x.clave, x.linea]), [["Issue", 2], ["refs", 5], ["otro", 6]]);
  assert.match(a[0].mensaje, /se lee como comentario/);
  assert.match(a[0].mensaje, /Ponlo entre comillas: Issue: "#24"/);
  assert.match(a[1].mensaje, /- "#12"/);
  // Y sale aunque no haya esquemas.
  assert.equal(E.validarPropiedades(nota("n.md"), t, []).length, 3);
});

test("#: no avisa en tags, listas en línea, comillas, comentarios ni el cuerpo", () => {
  const t = [
    "---",
    "# un comentario de línea",
    "tags: #idea",
    "tags2: [#a, #b]",
    "cita: \"#24\"",
    "simple: '#25'",
    "nota: valor # comentario al final",
    "tags_lista:",
    "  - '#x'",
    "---",
    "Issue: #24 en el cuerpo no es frontmatter",
  ].join("\n");
  assert.deepEqual(E.avisosAlmohadilla(t), []);
  assert.deepEqual(E.avisosAlmohadilla(fm("tags:", "  - #idea", "  - #otra")), []);
  assert.deepEqual(E.avisosAlmohadilla("Issue: #24\nsin frontmatter"), []);
});

test("#: funciona aunque el frontmatter no sea un mapa plano", () => {
  const a = E.avisosAlmohadilla(fm("padre:", "  hijo: #3"));
  assert.deepEqual(a.map((x) => [x.clave, x.linea]), [["hijo", 3]]);
});

test("chequeoPropiedades: ok sin avisos, detalle con línea y esquema si los hay", () => {
  const ok = E.chequeoPropiedades([], 2);
  assert.equal(ok.ok, true);
  assert.match(ok.detalle[0], /los 2 esquemas/);
  const { esquemas } = E.parsearEsquemas("A:\n  obligatorias: [x]\n");
  const mal = E.chequeoPropiedades(E.validarPropiedades(nota("n.md"), fm("y: 1"), esquemas), 1);
  assert.equal(mal.ok, false);
  assert.equal(mal.id, "propiedades_validas");
  assert.match(mal.detalle[0], /^Línea 1: Falta la propiedad obligatoria «x»\. \(esquema «A»\)$/);
});

test("notasQueNoCumplen: solo las notas con avisos, por ruta, sin las excluidas", () => {
  const { esquemas } = E.parsearEsquemas("A:\n  carpeta: P\n  obligatorias: [estado]\n");
  const notas = [
    { ...nota("P/b.md"), titulo: "b" },
    { ...nota("P/a.md"), titulo: "a" },
    { ...nota("Q/c.md"), titulo: "c" },
    { ...nota("P/esp.md"), titulo: "esp", excluida: true },
  ];
  const contenidos = new Map([
    ["P/b.md", fm("estado: ok")],
    ["P/a.md", fm("otro: 1")],
    ["Q/c.md", fm("Issue: #3")],
    ["P/esp.md", fm("x: 1")],
  ]);
  const r = E.notasQueNoCumplen(notas, contenidos, esquemas);
  assert.deepEqual(r.map((n) => [n.ruta, clases(n.avisos)]), [
    ["P/a.md", ["falta:estado"]],
    ["Q/c.md", ["comentario:Issue"]],
  ]);
});
