// Test headless (sin navegador ni Tauri) de la lógica pura del MCP de control
// (`FUN-L-09`, Parte 1): qué es el objetivo de `mycelium_abrir`
// (`lib/mcpControlLogica.ts`), a qué línea lleva un `ir_a`, las candidatas de un
// `NO_ENCONTRADO`, y la fusión del `.mcp.json` (`lib/ia/mcpJson.ts`). Los
// módulos se transpilan en el momento, como en `scripts/test-wikilinks.mjs`.
//
//   node --test scripts/test-mcp-control.mjs
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import ts from "typescript";

const aUrl = (codigo) => `data:text/javascript,${encodeURIComponent(codigo)}`;

async function fuente(ruta, mapa = {}) {
  const texto = await readFile(fileURLToPath(new URL(ruta, import.meta.url)), "utf8");
  let { outputText } = ts.transpileModule(texto, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 },
  });
  for (const [especificador, url] of Object.entries(mapa)) {
    outputText = outputText.split(`"${especificador}"`).join(`"${url}"`);
  }
  return aUrl(outputText);
}

const EXTENSIONES = await fuente("../lib/extensionesDeTipo.ts");
const WIKILINKS = await fuente("../lib/wikilinks.ts", { "@/lib/extensionesDeTipo": EXTENSIONES });
const logica = await import(await fuente("../lib/mcpControlLogica.ts", { "@/lib/wikilinks": WIKILINKS }));
const mcpJson = await import(await fuente("../lib/ia/mcpJson.ts"));
const wikilinks = await import(WIKILINKS);

// Un vault chico: dos «Plan» en carpetas distintas, una nota y un dibujo
// homónimos, una nota con tilde, un archivo no indexado.
const carpetas = [
  { id: "docs", nombre: "docs", padreId: null },
  { id: "docs/viejo", nombre: "viejo", padreId: "docs" },
  { id: "dib", nombre: "dib", padreId: null },
];
const nota = (id, tipo = "markdown") => {
  const barra = id.lastIndexOf("/");
  const archivo = id.slice(barra + 1);
  return { id, titulo: archivo.replace(/\.[^.]+$/, ""), carpetaId: barra < 0 ? null : id.slice(0, barra), tipo };
};
const notas = [
  nota("docs/Plan.md"),
  nota("docs/viejo/Plan.md"),
  nota("Pedido.md"),
  nota("dib/Pedido.excalidraw", "excalidraw"),
  nota("docs/Árbol de decisiones.md"),
  nota("Mapa.md"),
];
const otros = [{ ruta: "adjuntos/informe.pdf" }];
const resolver = (o) => logica.resolverObjetivo(o, notas, carpetas, otros);

test("grafo y calendario son palabras reservadas", () => {
  assert.deepEqual(resolver("grafo"), { tipo: "grafo" });
  assert.deepEqual(resolver(" Calendario "), { tipo: "calendario" });
});

test("una ruta exacta, con o sin .md, con barras de Windows", () => {
  assert.equal(resolver("docs/viejo/Plan.md").nota.id, "docs/viejo/Plan.md");
  assert.equal(resolver("docs\\viejo\\plan").nota.id, "docs/viejo/Plan.md");
  assert.equal(resolver("./Mapa.md").nota.id, "Mapa.md");
});

test("un archivo no indexado se abre por su ruta", () => {
  assert.deepEqual(resolver("adjuntos/Informe.PDF"), { tipo: "archivo", ruta: "adjuntos/informe.pdf" });
});

test("un título repetido es AMBIGUO con las rutas; la pista de carpeta lo resuelve", () => {
  assert.deepEqual(resolver("Plan"), { tipo: "ambiguo", rutas: ["docs/Plan.md", "docs/viejo/Plan.md"] });
  assert.equal(resolver("viejo/Plan").nota.id, "docs/viejo/Plan.md");
});

test("como un wikilink, la nota markdown le gana al dibujo homónimo", () => {
  assert.equal(resolver("Pedido").nota.id, "Pedido.md");
  assert.equal(resolver("Pedido.excalidraw").nota.id, "dib/Pedido.excalidraw");
});

test("Nota#Sección trae el ancla", () => {
  const r = resolver("Mapa#Objetivos");
  assert.equal(r.nota.id, "Mapa.md");
  assert.equal(r.ancla, "Objetivos");
});

test("lo que no existe trae las candidatas más parecidas", () => {
  const r = resolver("Arbol de decision");
  assert.equal(r.tipo, "no-encontrado");
  assert.equal(r.candidatas[0].ruta, "docs/Árbol de decisiones.md");
  const r2 = resolver("Plam");
  assert.deepEqual(
    r2.candidatas.map((c) => c.ruta),
    ["docs/Plan.md", "docs/viejo/Plan.md"],
  );
  assert.deepEqual(resolver("zzzzzz").candidatas, []);
});

test("candidatosWikilinkEnIndice no cambia lo que resuelve resolveWikilink", () => {
  // Con homónimos el enlace sigue eligiendo el más cercano a la raíz.
  assert.equal(wikilinks.resolveWikilink("Plan", notas, carpetas).id, "docs/Plan.md");
  const cands = wikilinks.candidatosWikilinkEnIndice("Plan", wikilinks.indexarPorTitulo(notas), carpetas);
  assert.equal(cands.length, 2);
});

const CONTENIDO = [
  "---",
  "tags: [x]",
  "---",
  "# Título",
  "Introducción con acción.",
  "```",
  "# no es un encabezado",
  "```",
  "## Objetivos ##",
  "texto",
  "### Objetivos secundarios",
].join("\n");

test("ir_a encabezado: exacto sin mayúsculas, ignorando el código", () => {
  assert.deepEqual(logica.resolverSalto(CONTENIDO, { encabezado: "objetivos" }), {
    ok: true,
    linea: 9,
    descripcion: "el encabezado «Objetivos» (línea 9)",
  });
  assert.equal(logica.resolverSalto(CONTENIDO, { encabezado: "## secundarios" }).linea, 11);
  const no = logica.resolverSalto(CONTENIDO, { encabezado: "no es un encabezado" });
  assert.equal(no.ok, false);
  assert.equal(no.codigo, "NO_ENCONTRADO");
  assert.deepEqual(
    no.datos.candidatas.map((c) => c.titulo),
    ["# Título", "## Objetivos", "### Objetivos secundarios"],
  );
});

test("ir_a línea y texto", () => {
  assert.equal(logica.resolverSalto(CONTENIDO, { linea: 4 }).linea, 4);
  assert.equal(logica.resolverSalto(CONTENIDO, { linea: 99 }).codigo, "INVALIDO");
  // Sin distinguir tildes ni mayúsculas, y contando bien las líneas después de una tilde.
  assert.equal(logica.resolverSalto("á\né\nINTRODUCCION", { texto: "introducción" }).linea, 3);
  assert.equal(logica.resolverSalto(CONTENIDO, { texto: "nada de esto" }).codigo, "NO_ENCONTRADO");
});

test("mismaRuta compara como el Rust", () => {
  assert.ok(logica.mismaRuta("C:\\Notas\\Vault\\", "c:/notas/vault"));
  assert.ok(!logica.mismaRuta("C:/notas/a", "C:/notas/b"));
});

// ── .mcp.json ──────────────────────────────────────────────────────────────

const BIN = "C:\\Program Files\\Mycelium\\mycelium-mcp.exe";
const VAULT = "C:\\Notas\\Vault";

test(".mcp.json: sin archivo se crea con nuestra entrada", () => {
  const r = mcpJson.fusionarMcpJson(null, BIN, VAULT);
  assert.equal(r.creado, true);
  assert.equal(r.cambia, true);
  assert.deepEqual(JSON.parse(r.texto), {
    mcpServers: { mycelium: { command: BIN, args: [], env: { MYCELIUM_VAULT: VAULT } } },
  });
});

test(".mcp.json: el del usuario se fusiona sin tocar lo suyo ni su orden", () => {
  const usuario = JSON.stringify({
    mcpServers: { github: { command: "gh-mcp" }, mycelium: { command: "viejo.exe" }, otro: { url: "x" } },
    extra: true,
  });
  const r = mcpJson.fusionarMcpJson(usuario, BIN, VAULT);
  const o = JSON.parse(r.texto);
  assert.equal(r.creado, false);
  assert.deepEqual(Object.keys(o.mcpServers), ["github", "mycelium", "otro"]);
  assert.deepEqual(o.mcpServers.github, { command: "gh-mcp" });
  assert.equal(o.mcpServers.mycelium.command, BIN);
  assert.equal(o.extra, true);
  // Escribir otra vez lo mismo no cambia nada.
  assert.equal(mcpJson.fusionarMcpJson(r.texto, BIN, VAULT).cambia, false);
});

test(".mcp.json: uno que no es JSON o con mcpServers raro no se toca", () => {
  assert.throws(() => mcpJson.fusionarMcpJson("{ roto", BIN, VAULT), /no es JSON válido/);
  assert.throws(() => mcpJson.fusionarMcpJson("[1]", BIN, VAULT), /no es un objeto/);
  assert.throws(() => mcpJson.fusionarMcpJson('{"mcpServers": 3}', BIN, VAULT), /mcpServers/);
});

test(".mcp.json: al apagar se quita solo lo nuestro; vacío → null", () => {
  const solo = mcpJson.fusionarMcpJson(null, BIN, VAULT).texto;
  assert.deepEqual(mcpJson.quitarDeMcpJson(solo), { texto: null, cambia: true });

  const mixto = mcpJson.fusionarMcpJson(JSON.stringify({ mcpServers: { github: { command: "gh" } } }), BIN, VAULT).texto;
  const r = mcpJson.quitarDeMcpJson(mixto);
  assert.equal(r.cambia, true);
  assert.deepEqual(JSON.parse(r.texto), { mcpServers: { github: { command: "gh" } } });

  // Otras claves del usuario: el archivo no queda vacío aunque no haya servidores.
  const conClave = JSON.stringify({ mcpServers: { mycelium: {} }, nota: "mía" });
  assert.deepEqual(JSON.parse(mcpJson.quitarDeMcpJson(conClave).texto), { mcpServers: {}, nota: "mía" });

  // Sin nuestra entrada, no cambia nada.
  assert.equal(mcpJson.quitarDeMcpJson(JSON.stringify({ mcpServers: { github: {} } })).cambia, false);
});
