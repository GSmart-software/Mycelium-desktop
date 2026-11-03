// Test headless del informe de salud como nota (`FUN-L-32`, parte E): el
// Markdown de `lib/informeSalud.ts` con revisiones sintéticas armadas por la
// lógica real (`calcularSalud` + `calcularEstadisticas`). Frontmatter que
// Mycelium interpreta, callouts bien formados, la torta con las cinco porciones
// en `ORDEN_TORTA` (también con ceros), tablas con `|` escapado, crecimiento no
// confiable, vault vacío y títulos homónimos enlazados con su carpeta.
//
// Los bloques Mermaid se validan con el parser de Mermaid en
// `scripts/smoke-informe-salud.mjs` (necesita Chromium).
//
//   node --test scripts/test-informe-salud.mjs
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
const FRONTMATTER = await fuente("../lib/frontmatter.ts");
const ENLACES_NOTA = await fuente("../lib/enlacesNota.ts", {
  "@/lib/canvas": await fuente("../lib/canvas.ts"),
  "@/lib/extensionesDeTipo": EXTENSIONES,
  "@/lib/frontmatter": FRONTMATTER,
  "@/lib/sinCodigo": await fuente("../lib/sinCodigo.ts"),
  "@/lib/wikilinks": WIKILINKS,
});
const SALUD = await import(
  await fuente("../lib/salud.ts", {
    "@/lib/enlacesNota": ENLACES_NOTA,
    "@/lib/wikilinks": WIKILINKS,
    "@/lib/mcpIndiceLogica": await fuente("../lib/mcpIndiceLogica.ts", {
      "@/lib/bases": await fuente("../lib/bases.ts"),
      "@/lib/enlacesNota": ENLACES_NOTA,
    }),
  })
);
const ESTADISTICAS_URL = await fuente("../lib/estadisticas.ts");
const PALETA_URL = await fuente("../lib/paletaGraficas.ts");
const E = await import(ESTADISTICAS_URL);
const P = await import(PALETA_URL);
const I = await import(
  await fuente("../lib/informeSalud.ts", { "@/lib/estadisticas": ESTADISTICAS_URL, "@/lib/paletaGraficas": PALETA_URL })
);
const WL = await import(WIKILINKS);
const FM = await import(FRONTMATTER);

// ── Revisiones sintéticas ───────────────────────────────────────────────────

const MB = 1024 * 1024;
const AHORA = new Date(2026, 10, 2, 0, 41); // 2026-11-02 00:41, hora local

function carpetasDe(rutas) {
  const ids = new Set();
  for (const r of rutas) {
    const partes = r.split("/").slice(0, -1);
    for (let i = 1; i <= partes.length; i++) ids.add(partes.slice(0, i).join("/"));
  }
  return [...ids].map((id) => {
    const i = id.lastIndexOf("/");
    return { id, nombre: id.slice(i + 1), padreId: i < 0 ? null : id.slice(0, i) };
  });
}

const tituloDe = (r) => r.slice(r.lastIndexOf("/") + 1).replace(/\.[^.]+$/, "");
const tipoDe = (r) => /\.(canvas|excalidraw|drawio|base)$/.exec(r)?.[1] ?? "markdown";

/**
 * Una revisión como la de `revisarVault`, pero desde datos en memoria.
 * `notas`: ruta → enlaces `[{ texto, tipo?, destino? }]` (destino null = roto).
 */
function revision({ notas = {}, otros = [], fechas = null, etiquetas = null, propiedades = [], avisosEsquemas = [] }) {
  const rutas = Object.keys(notas);
  const lista = rutas.map((id) => ({ id, titulo: tituloDe(id), carpetaId: id.includes("/") ? id.slice(0, id.lastIndexOf("/")) : null, tipo: tipoDe(id) }));
  const carpetas = carpetasDe([...rutas, ...otros.map((o) => o.ruta)]);
  const filas = [];
  for (const [desde, enlaces] of Object.entries(notas)) {
    for (const e of enlaces) filas.push({ desde, texto: e.texto, tipo: e.tipo ?? "enlace", destino: e.destino ?? null, n: 1 });
  }
  const informe = SALUD.calcularSalud({ notas: lista, carpetas, filas, otros: otros.map((o) => o.ruta), carpetaEsporas: "Esporas" });
  informe.propiedades = propiedades;
  informe.avisosEsquemas = avisosEsquemas;
  const archivos = [...rutas.map((ruta) => ({ ruta, bytes: 2048 })), ...otros];
  const estadisticas = E.calcularEstadisticas({
    archivos,
    notas: lista,
    filas,
    excluida: (n) => SALUD.excluida(n, "Esporas"),
    creacion: lista.map((n, i) => ({ id: n.id, creadoEn: fechas ? fechas(i) : new Date(2026, 10 - (i % 12), 3).toISOString() })),
    etiquetas: etiquetas ?? { distintas: 0, notasConEtiqueta: 0, masUsadas: [] },
    ahora: AHORA,
  });
  return { informe, estadisticas, revisadoEn: AHORA.toISOString(), duracionMs: 120, _lista: lista, _carpetas: carpetas };
}

function vaultEjemplo() {
  return revision({
    notas: {
      "Capítulos/Entrevistas.md": [{ texto: "Metodología", destino: "Metodología.md" }],
      "Notas de campo/Entrevistas.md": [],
      "Metodología.md": [
        { texto: "Entrevistas", destino: "Capítulos/Entrevistas.md" },
        { texto: "esquema-muestreo.png", tipo: "embed" },
      ],
      "Capítulo 3.md": [
        { texto: "Entrevista 14" },
        { texto: "Metodología", destino: "Metodología.md" },
        { texto: "Marco | teórico" },
      ],
      "Suelta.md": [],
      "Mapa.canvas": [{ texto: "Perdida", tipo: "archivo" }],
      "Esporas/Reunión.md": [{ texto: "{{titulo}}" }],
    },
    otros: [
      { ruta: "Adjuntos/foto | 1.png", bytes: 120 * MB },
      { ruta: "Adjuntos/plano.pdf", bytes: 80 * MB },
      { ruta: 'Raro "comillas" %% #x;/a.txt', bytes: 3 * MB },
      { ruta: "Tabla | rara.base", bytes: 900 },
    ],
    etiquetas: { distintas: 3, notasConEtiqueta: 4, masUsadas: [{ etiqueta: "tesis", notas: 3 }, { etiqueta: "a|b", notas: 1 }] },
  });
}

// ── Utilidades del análisis del Markdown ────────────────────────────────────

function frontmatter(md) {
  const m = /^---\n([\s\S]*?)\n---\n/.exec(md);
  assert.ok(m, "el informe empieza con frontmatter");
  const props = {};
  for (const linea of m[1].split("\n")) {
    const kv = /^([a-z_]+): (.*)$/.exec(linea);
    assert.ok(kv, `línea de propiedad plana: ${linea}`);
    props[kv[1]] = kv[2];
  }
  return props;
}

function bloquesMermaid(md) {
  return [...md.matchAll(/```mermaid\n([\s\S]*?)\n```/g)].map((m) => m[1]);
}

function tablas(md) {
  const out = [];
  let actual = null;
  for (const l of md.split("\n")) {
    if (l.startsWith("|")) (actual ??= []).push(l);
    else if (actual) (out.push(actual), (actual = null));
  }
  if (actual) out.push(actual);
  return out;
}

/** Celdas de una fila GFM, respetando `\|`. */
const celdas = (fila) => fila.slice(1, -1).split(/(?<!\\)\|/);

// ── Tests ───────────────────────────────────────────────────────────────────

test("frontmatter plano, con los tipos que Mycelium interpreta", () => {
  const r = vaultEjemplo();
  const md = I.markdownInformeSalud(r);
  const p = frontmatter(md);
  assert.equal(p.revisado, "2026-11-02T00:41");
  assert.match(p.revisado, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
  assert.equal(Number(p.archivos), r.estadisticas.archivos.total.cantidad);
  assert.equal(Number(p.notas), r.estadisticas.archivos.porGrupo.notas.cantidad);
  assert.match(p.peso_mb, /^\d+(\.\d)?$/);
  assert.equal(Number(p.problemas), SALUD.conteos(r.informe).total, "problemas = el total del panel");
  assert.equal(p.tags, "[salud-del-vault]");
  // Y el lector de propiedades de la app lo interpreta con sus tipos.
  const leido = FM.separarFrontmatter(md);
  assert.ok(leido.hay && leido.soportado, JSON.stringify(leido));
  const tipos = Object.fromEntries(leido.props.map((x) => [x.clave, x.tipo]));
  assert.equal(tipos.revisado, "fechaHora");
  assert.equal(tipos.archivos, "numero");
  assert.equal(tipos.peso_mb, "numero");
  assert.equal(tipos.tags, "lista");
});

test("callouts: graves, avisos y para revisar, con enlaces y «y N más»", () => {
  const r = vaultEjemplo();
  const md = I.markdownInformeSalud(r, { tope: 1 });
  const g = I.gravedades(r.informe);
  assert.equal(g.total, SALUD.conteos(r.informe).total);
  assert.match(md, new RegExp(`^> \\[!caution\\] ${g.graves} problemas graves$`, "m"));
  assert.match(md, /^> \[!warning\] /m);
  assert.match(md, /^> \[!info\] Para revisar cuando haya tiempo$/m);
  // Cada callout es un bloque contiguo de líneas que empiezan con «>».
  for (const bloque of md.split(/\n\n/).filter((b) => b.startsWith("> [!"))) {
    for (const l of bloque.split("\n")) assert.ok(l.startsWith(">"), `línea fuera del callout: ${l}`);
  }
  assert.match(md, /\[\[Capítulo 3\]\] enlaza a `\[\[Entrevista 14\]\]`/);
  assert.match(md, />   - y \d+ más\./);
  assert.match(md, /\[\[Metodología\]\] embebe `!\[\[esquema-muestreo\.png\]\]`/);
  // Las Esporas no son problemas: su `{{titulo}}` no aparece.
  assert.doesNotMatch(md, /\{\{titulo\}\}/);
});

test("títulos homónimos: el enlace lleva la carpeta y resuelve a la nota correcta", () => {
  const r = vaultEjemplo();
  const md = I.markdownInformeSalud(r);
  assert.match(md, /\[\[Capítulos\/Entrevistas\|Entrevistas\]\]/);
  assert.match(md, /\[\[Notas de campo\/Entrevistas\|Entrevistas\]\]/);
  // Con el resolvedor de la app, cada enlace del informe lleva a una nota existente.
  const porTitulo = WL.indexarPorTitulo(r._lista);
  const enlaces = [...md.matchAll(/(?<!`)\[\[([^\]|]+)(?:\|[^\]]*)?\]\](?!`)/g)].map((m) => m[1]);
  assert.ok(enlaces.length > 3);
  for (const ref of enlaces) {
    const n = WL.resolveWikilinkEnIndice(ref, porTitulo, r._carpetas);
    assert.ok(n, `[[${ref}]] resuelve`);
  }
  for (const destino of ["Capítulos/Entrevistas", "Notas de campo/Entrevistas"]) {
    assert.equal(WL.resolveWikilinkEnIndice(destino, porTitulo, r._carpetas).id, `${destino}.md`);
  }
  // Lo que no es markdown lleva su extensión.
  assert.match(md, /\[\[Mapa\.canvas\]\]/);
});

test("la torta declara las cinco porciones en ORDEN_TORTA, también las que valen 0", () => {
  for (const r of [vaultEjemplo(), revision({ notas: { "a.md": [] } })]) {
    const md = I.markdownInformeSalud(r);
    const torta = bloquesMermaid(md).find((b) => b.startsWith("pie"));
    assert.ok(torta, "hay torta");
    assert.match(torta.split("\n")[0], /^pie showData title Peso por tipo de archivo \((MB|KB)\)$/);
    const porciones = torta.split("\n").slice(1).map((l) => /^ {4}"([^"]+)" : (\d+\.\d)$/.exec(l));
    assert.ok(porciones.every(Boolean), torta);
    assert.deepEqual(porciones.map((m) => m[1]), P.ORDEN_TORTA.map((g) => E.NOMBRE_GRUPO[g]));
  }
  // Solo notas: las otras cuatro valen 0.0 pero están.
  const soloNotas = I.markdownInformeSalud(revision({ notas: { "a.md": [] } }));
  assert.match(soloNotas, / {4}"Imágenes" : 0\.0/);
  assert.match(soloNotas, / {4}"Notas" : 2\.0/); // 2 KB
});

test("tablas: el `|` va escapado y cada fila tiene las celdas de su encabezado", () => {
  const md = I.markdownInformeSalud(vaultEjemplo());
  const ts = tablas(md);
  assert.ok(ts.length >= 3);
  for (const t of ts) {
    const n = celdas(t[0]).length;
    assert.match(t[1], /^\|(---|--:)(\|(---|--:))*\|$/);
    for (const fila of t) assert.equal(celdas(fila).length, n, fila);
  }
  assert.match(md, /`#a\\\|b`/);
  assert.match(md, /`Adjuntos\/foto \\\| 1\.png`/);
  // Cada extensión por separado, con las conocidas aunque tengan 0.
  for (const ext of ["md", "png", "pdf", "canvas", "drawio", "excalidraw", "base", "txt"]) {
    assert.match(md, new RegExp(`\\(\\.${ext}\\) \\|`));
  }
  assert.match(md, /\| Dibujos \(\.excalidraw\) \| 0 \| 0 B \| 0 % \|/);
});

test("números con formato es-AR", () => {
  assert.equal(I.entero(1642), "1.642");
  assert.equal(I.pesoLegible(6.2 * MB), "6,2 MB");
  assert.equal(I.pesoLegible(312 * MB), "312 MB");
  assert.equal(I.pesoLegible(500), "500 B");
  assert.equal(I.porcentaje(1, 250), "0,4 %");
  assert.equal(I.porcentaje(54, 100), "54 %");
  assert.equal(I.porcentaje(0, 0), "0 %");
});

test("Mermaid: etiquetas sin comillas, comentarios ni entidades sueltas", () => {
  const md = I.markdownInformeSalud(vaultEjemplo());
  for (const b of bloquesMermaid(md)) {
    assert.doesNotMatch(b, /%%/);
    for (const m of b.matchAll(/\[([^\]]*)\]/g)) {
      // Dentro de un eje: solo cadenas entre comillas o números, separados por comas.
      assert.match(m[1], /^("[^"]*"|-?\d+(\.\d+)?)(, ("[^"]*"|-?\d+(\.\d+)?))*$/, m[1]);
    }
  }
  assert.equal(I.etiquetaMermaid('a "b" %% #x;'), '"a ”b” % % ＃x;"');
  assert.equal(I.etiquetaMermaid("x".repeat(40)).length, 26);
});

test("crecimiento no confiable: un párrafo en vez de la gráfica", () => {
  const notas = Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`n${i}.md`, []]));
  const r = revision({ notas, fechas: () => "2026-10-01T10:00:00.000Z" });
  assert.equal(r.estadisticas.crecimiento.confiable, false);
  const md = I.markdownInformeSalud(r);
  const seccion = md.slice(md.indexOf("## Crecimiento"), md.indexOf("## Etiquetas"));
  assert.match(seccion, /No hay fechas confiables/);
  assert.match(seccion, /30 notas tienen la misma fecha de creación/);
  assert.doesNotMatch(seccion, /```mermaid/);
});

test("crecimiento confiable: 12 barras con los meses en español", () => {
  const notas = Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`n${i}.md`, []]));
  const md = I.markdownInformeSalud(revision({ notas }));
  const seccion = md.slice(md.indexOf("## Crecimiento"), md.indexOf("## Etiquetas"));
  const b = bloquesMermaid(seccion)[0];
  assert.ok(b);
  assert.match(b, /x-axis \["dic 25", "ene 26", "feb", .*"nov"\]/);
  assert.match(b, /bar \[(\d+, ){11}\d+\]/);
});

test("vault vacío: sin gráficas rotas", () => {
  const md = I.markdownInformeSalud(revision({}));
  assert.equal(bloquesMermaid(md).length, 0);
  assert.match(md, /> \[!success\] Sin problemas/);
  assert.match(md, /El vault todavía no tiene archivos\./);
  assert.match(md, /Todavía no hay notas que conectar\./);
  assert.match(md, /Ninguna nota usa etiquetas\./);
  const p = frontmatter(md);
  assert.equal(p.archivos, "0");
  assert.equal(p.peso_mb, "0");
  assert.equal(p.problemas, "0");
});

test("muchas carpetas: la gráfica junta el resto en una barra", () => {
  const otros = Array.from({ length: 12 }, (_, i) => ({ ruta: `C${i}/x.png`, bytes: (i + 1) * MB }));
  const md = I.markdownInformeSalud(revision({ otros }));
  const b = bloquesMermaid(md).find((x) => x.startsWith("xychart-beta horizontal"));
  assert.match(b, /"Otras 5 carpetas"/);
  const valores = /bar \[([^\]]*)\]/.exec(b)[1].split(", ").map(Number);
  assert.equal(valores.length, I.TOPE_CARPETAS);
  assert.equal(valores.reduce((s, v) => s + v, 0), 78);
});

test("el título del archivo y la conjunción «e»", () => {
  assert.equal(I.tituloInforme(AHORA), "Salud del vault 2026-11-02");
  assert.equal(I.tituloInforme(AHORA, true), "Salud del vault 2026-11-02 0041");
  assert.equal(I.enumerar(["a", "b", "[[Índice]]"]), "a, b e [[Índice]]");
  assert.equal(I.enumerar(["a", "[[Hielo]]"]), "a y [[Hielo]]");
  assert.equal(I.topeDeEje(168), 200);
  assert.equal(I.topeDeEje(392), 500);
  assert.equal(I.topeDeEje(0.3), 0.5);
});

test("el informe es determinista y termina en una sola línea en blanco", () => {
  const r = vaultEjemplo();
  const a = I.markdownInformeSalud(r);
  assert.equal(a, I.markdownInformeSalud(r));
  assert.ok(a.endsWith("\n") && !a.endsWith("\n\n"));
});
