// Test headless (sin navegador ni Tauri) de la salud del vault (`FUN-L-30`):
// la lógica pura de `lib/salud.ts` sobre filas de enlaces armadas con las MISMAS
// funciones que usa el indexador (`derivarEnlaces` + `resolverEnlace`, vía
// `filasComoElIndice`). Así cada caso prueba el criterio del índice, no uno
// propio: un enlace en un bloque de código no cuenta, `[[X|y]]` y `[[X#h]]`
// son enlaces a X, un embed a algo que no existe está roto, dos homónimas hacen
// ambiguos sus enlaces, y las Esporas no se juzgan como memoria.
//
// La misma cuenta contra un SQLite de verdad está en `test-indice-ia.mjs`.
//
//   node --test scripts/test-salud.mjs
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
const LOGICA = await fuente("../lib/mcpIndiceLogica.ts", {
  "@/lib/bases": await fuente("../lib/bases.ts"),
  "@/lib/enlacesNota": ENLACES_NOTA,
});
const S = await import(
  await fuente("../lib/salud.ts", { "@/lib/enlacesNota": ENLACES_NOTA, "@/lib/mcpIndiceLogica": LOGICA, "@/lib/wikilinks": WIKILINKS })
);

// ── Un vault de prueba ───────────────────────────────────────────────────────

const tipoDe = (ruta) => /\.(canvas|excalidraw|drawio|base)$/.exec(ruta)?.[1] ?? "markdown";
const nota = (id, contenido) => {
  const barra = id.lastIndexOf("/");
  return {
    id,
    titulo: id.slice(barra + 1).replace(/\.[^.]+$/, ""),
    carpetaId: barra < 0 ? null : id.slice(0, barra),
    tipo: tipoDe(id),
    contenido,
  };
};
const carpetasDe = (notas) => {
  const ids = new Set();
  for (const n of notas) {
    const partes = (n.carpetaId ?? "").split("/").filter(Boolean);
    for (let i = 1; i <= partes.length; i++) ids.add(partes.slice(0, i).join("/"));
  }
  return [...ids].map((id) => ({ id, nombre: id.split("/").pop(), padreId: id.includes("/") ? id.slice(0, id.lastIndexOf("/")) : null }));
};

const NOTAS = [
  nota(
    "Mapa.md",
    [
      "# Mapa", // 1
      "Ver [[Idea|la idea]] y [[Idea#Origen]].", // 2
      "```", // 3
      "[[EnBloque]] no es un enlace", // 4
      "```", // 5
      "Un `[[EnLinea]]` tampoco. Pero [[Fantasma]] sí está roto.", // 6
      "![[Boceto.excalidraw]] ![[Falta.excalidraw]] ![[foto.png]] [[Informe.pdf]]", // 7
      "[[Plan]] es ambiguo y [[proyectos/Plan]] no.", // 8
      "Y [[Fantasma]] otra vez.", // 9
    ].join("\n"),
  ),
  nota("Idea.md", "## Origen\nSin enlaces."),
  nota("Boceto.excalidraw", '{"elements":[]}'),
  nota("Plan.md", "Plan de la raíz, enlaza a [[Mapa]]."),
  nota("proyectos/Plan.md", "Plan de proyectos."),
  nota("Suelta.md", "Nadie me enlaza ni enlazo."),
  nota("En lienzo.md", "Solo me tiene un lienzo."),
  nota("L.canvas", JSON.stringify({ nodes: [{ id: "a", type: "file", file: "En lienzo.md", x: 0, y: 0, width: 1, height: 1 }] })),
  nota("Esporas/Reunión.md", "# {{titulo}}\n[[{{fecha}}]] y [[Fantasma]]"),
  nota("Esporas/Sub/Diario.md", "[[Otro fantasma]]"),
  nota("CLAUDE.md", "Instrucciones con [[Inexistente]]."),
  nota("docs/CLAUDE.md", "Este sí es memoria, aunque se llame así."),
];
const CARPETAS = carpetasDe(NOTAS);
const OTROS = ["img/foto.png", "Informe.pdf"];

function informe(alcance, notas = NOTAS) {
  return S.calcularSalud({
    notas,
    carpetas: CARPETAS,
    filas: S.filasComoElIndice(notas, CARPETAS),
    otros: OTROS,
    carpetaEsporas: "Esporas",
    alcance,
  });
}

const textos = (lista) => lista.map((p) => `${p.desde}:${p.tipo}:${p.texto}`);
const rutas = (lista) => lista.map((n) => n.ruta);

// ── Los casos que pide la spec ──────────────────────────────────────────────

test("un enlace dentro de código no cuenta; los rotos de verdad, sí (con la línea)", () => {
  const i = informe();
  assert.deepEqual(textos(i.rotos), ["Mapa.md:enlace:Fantasma"]);
  assert.ok(!JSON.stringify(i).includes("EnBloque"), "un [[x]] en un bloque de código no es un enlace roto");
  assert.ok(!JSON.stringify(i).includes("EnLinea"), "ni en código en línea");
  S.ponerLineas(i, new Map(NOTAS.map((n) => [n.id, n.contenido])), new Map(NOTAS.map((n) => [n.id, n.tipo])));
  assert.deepEqual(i.rotos[0].lineas, [6, 9]);
  assert.equal(i.rotos[0].n, 2);
});

test("[[X|alias]] y [[X#encabezado]] cuentan como enlaces a X (no rotos, X no es huérfana)", () => {
  const i = informe();
  assert.ok(!rutas(i.huerfanas).includes("Idea.md"));
  assert.ok(!textos(i.rotos).some((t) => t.includes("Idea")));
});

test("embed roto: a un dibujo que no existe; a uno que existe o a una imagen del vault, no", () => {
  const i = informe();
  assert.deepEqual(textos(i.embedsRotos), ["Mapa.md:embed:Falta.excalidraw"]);
  S.ponerLineas(i, new Map(NOTAS.map((n) => [n.id, n.contenido])), new Map(NOTAS.map((n) => [n.id, n.tipo])));
  assert.deepEqual(i.embedsRotos[0].lineas, [7]);
  assert.ok(!textos(i.rotos).some((t) => t.includes("Informe.pdf")), "un enlace a un PDF que existe no está roto");
});

test("homónimos: el grupo, y los enlaces que no saben a cuál ir (con pista de carpeta no es ambiguo)", () => {
  const i = informe();
  assert.equal(i.duplicados.length, 2, "Plan y CLAUDE");
  const plan = i.duplicados.find((d) => d.titulo === "Plan");
  assert.deepEqual(plan.rutas, ["Plan.md", "proyectos/Plan.md"]);
  assert.deepEqual(textos(plan.ambiguos), ["Mapa.md:enlace:Plan"]);
  S.ponerLineas(i, new Map(NOTAS.map((n) => [n.id, n.contenido])), new Map(NOTAS.map((n) => [n.id, n.tipo])));
  assert.deepEqual(plan.ambiguos[0].lineas, [8]);
});

test("Esporas excluidas: sus [[{{variables}}]] no son rotos ni ellas huérfanas (tampoco en subcarpetas)", () => {
  const i = informe();
  const todo = JSON.stringify([i.rotos, i.embedsRotos, i.huerfanas, i.sinSalientes]);
  assert.ok(!todo.includes("Esporas/"), todo);
  assert.equal(S.esEspora({ carpetaId: "Esporas/Sub" }, "Esporas"), true);
  assert.equal(S.esEspora({ carpetaId: "EsporasViejas" }, "Esporas"), false);
});

test("las instrucciones de agentes en la raíz no se juzgan; un CLAUDE.md en una carpeta, sí", () => {
  const i = informe();
  assert.ok(!textos(i.rotos).some((t) => t.startsWith("CLAUDE.md")));
  assert.ok(!rutas(i.huerfanas).includes("CLAUDE.md"));
  assert.ok(rutas(i.huerfanas).includes("docs/CLAUDE.md"));
});

test("huérfanas y sin salientes: solo notas markdown; un lienzo que la tiene como tarjeta la enlaza", () => {
  const i = informe();
  assert.deepEqual(rutas(i.huerfanas), ["Suelta.md", "docs/CLAUDE.md"], "Mapa la enlaza Plan; proyectos/Plan, la pista de Mapa");
  assert.ok(!rutas(i.huerfanas).includes("En lienzo.md"));
  assert.ok(!rutas(i.huerfanas).includes("Boceto.excalidraw"), "un dibujo no se reporta huérfano");
  assert.deepEqual(rutas(i.sinSalientes), ["En lienzo.md", "Idea.md", "Suelta.md", "docs/CLAUDE.md", "proyectos/Plan.md"]);
  assert.equal(i.notas, NOTAS.length - 3, "sin las dos Esporas ni el CLAUDE.md de la raíz");
});

test("una nota que se enlaza a sí misma sigue huérfana y sin salientes", () => {
  const notas = [nota("Eco.md", "Yo: [[Eco]]")];
  const i = informe(undefined, notas);
  assert.deepEqual(rutas(i.huerfanas), ["Eco.md"]);
  assert.deepEqual(rutas(i.sinSalientes), ["Eco.md"]);
  assert.deepEqual(i.rotos, []);
});

// ── Alcance ─────────────────────────────────────────────────────────────────

test("alcance carpeta y nota: los problemas de lo que está adentro; los homónimos si alguno está adentro", () => {
  const p = informe({ tipo: "carpeta", ruta: "proyectos" });
  assert.deepEqual(p.rotos, []);
  assert.deepEqual(rutas(p.huerfanas), []);
  assert.deepEqual(rutas(p.sinSalientes), ["proyectos/Plan.md"]);
  assert.deepEqual(p.duplicados.map((d) => d.titulo), ["Plan"]);
  assert.equal(p.notas, 1);
  const m = informe({ tipo: "nota", ruta: "Mapa.md" });
  assert.deepEqual(textos(m.rotos), ["Mapa.md:enlace:Fantasma"]);
  assert.deepEqual(rutas(m.huerfanas), []);
  assert.deepEqual(rutas(informe({ tipo: "nota", ruta: "Suelta.md" }).huerfanas), ["Suelta.md"]);
  assert.deepEqual(m.duplicados.map((d) => d.titulo), ["Plan"], "por su enlace ambiguo");
  assert.equal(S.enAlcance("proyectosViejos/x.md", { tipo: "carpeta", ruta: "proyectos" }), false);
});

// ── Validar una nota ────────────────────────────────────────────────────────

test("chequeosBasicos: título único, enlaces que resuelven, alguien la enlaza", () => {
  const i = informe({ tipo: "nota", ruta: "Mapa.md" });
  S.ponerLineas(i, new Map(NOTAS.map((n) => [n.id, n.contenido])), new Map(NOTAS.map((n) => [n.id, n.tipo])));
  const mapa = NOTAS[0];
  const c = S.chequeosBasicos({ nota: mapa, informe: i, backlinks: [] }, "Esporas");
  assert.deepEqual(c.map((x) => `${x.id}:${x.ok}`), ["titulo_unico:true", "enlaces_resuelven:false", "enlazada:false"]);
  const enlaces = c.find((x) => x.id === "enlaces_resuelven").detalle.join("\n");
  assert.match(enlaces, /Roto: \[\[Fantasma\]\] \(línea 6, 9\)/);
  assert.match(enlaces, /Roto: !\[\[Falta\.excalidraw\]\] \(línea 7\)/);
  assert.match(enlaces, /Ambiguo \(hay homónimas\): \[\[Plan\]\] \(línea 8\)/);

  const plan = NOTAS.find((n) => n.id === "Plan.md");
  const cp = S.chequeosBasicos({ nota: plan, informe: informe({ tipo: "nota", ruta: "Plan.md" }), backlinks: ["Mapa.md"] }, "Esporas");
  assert.deepEqual(cp.map((x) => `${x.id}:${x.ok}`), ["titulo_unico:false", "enlaces_resuelven:true", "enlazada:true"]);
  assert.match(cp[0].detalle[0], /Hay 2 con el título «Plan»: Plan\.md, proyectos\/Plan\.md/);
});

test("una Espora se valida como plantilla: no se juzgan sus enlaces ni sus backlinks", () => {
  const espora = NOTAS.find((n) => n.id === "Esporas/Reunión.md");
  const c = S.chequeosBasicos({ nota: espora, informe: informe({ tipo: "nota", ruta: espora.id }), backlinks: [] }, "Esporas");
  assert.deepEqual(c.map((x) => `${x.id}:${x.ok}`), ["titulo_unico:true", "excluida:true"]);
});

test("registrarValidadorNota: el punto de extensión para las propiedades (FUN-M-46)", async () => {
  const v = ({ contenido }) => [{ id: "propiedades", ok: !contenido.includes("Issue: #"), titulo: "Propiedades válidas", detalle: [] }];
  S.registrarValidadorNota(v);
  S.registrarValidadorNota(v);
  assert.equal(S.validadoresNota().length, 1, "una sola vez por función");
  const [r] = await S.validadoresNota()[0]({ contenido: "---\nIssue: #24\n---" });
  assert.equal(r.ok, false);
});

// ── Para el agente ──────────────────────────────────────────────────────────

test("informeParaIa: recorta cada lista con tope y deja los conteos completos", () => {
  const i = informe();
  const r = S.informeParaIa(i, 1);
  assert.equal(r.huerfanas.length, 1);
  assert.equal(r.conteos.huerfanas, 2);
  assert.equal(r.conteos.total, r.conteos.rotos + r.conteos.embedsRotos + r.conteos.duplicados + r.conteos.huerfanas + r.conteos.sinSalientes + r.conteos.propiedades);
  assert.equal(r.tope, 1);
});
