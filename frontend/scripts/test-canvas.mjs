// Test headless (sin navegador ni Tauri) del formato JSON Canvas (`FUN-L-18`).
// `lib/canvas.ts` es puro —sin imports—, así que se transpila en el momento y se
// importa vía data: URL, igual que el resto de los núcleos del proyecto.
//
//   node --test scripts/test-canvas.mjs
//   node scripts/test-canvas.mjs
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import ts from "typescript";

const rutaTs = fileURLToPath(new URL("../lib/canvas.ts", import.meta.url));
const { outputText } = ts.transpileModule(await readFile(rutaTs, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 },
});
const {
  anclaDe,
  buscarPorPrefijo,
  canvasInicial,
  colorCss,
  ErrorCanvas,
  ladosAutomaticos,
  nodoArchivo,
  nodoTexto,
  nuevaArista,
  nuevoId,
  parsearCanvas,
  referenciasDe,
  serializarCanvas,
  trazoArista,
} = await import(`data:text/javascript,${encodeURIComponent(outputText)}`);

// Un canvas como los que escribe Obsidian, con TODO lo que el formato permite.
const OBSIDIAN = JSON.stringify(
  {
    nodes: [
      { id: "a", type: "text", x: 0, y: 0, width: 250, height: 100, text: "Idea, ver [[BACKLOG]]" },
      {
        id: "b",
        type: "file",
        x: 320,
        y: 0,
        width: 400,
        height: 300,
        file: "docs/BACKLOG.md",
        subpath: "#seccion",
        color: "3",
      },
      { id: "c", type: "link", x: 0, y: 400, width: 200, height: 80, url: "https://ejemplo.com" },
      {
        id: "d",
        type: "group",
        x: -40,
        y: -40,
        width: 800,
        height: 500,
        label: "Contexto",
        background: "fondo.png",
        backgroundStyle: "cover",
      },
    ],
    edges: [
      {
        id: "e1",
        fromNode: "a",
        fromSide: "right",
        fromEnd: "none",
        toNode: "b",
        toSide: "left",
        toEnd: "arrow",
        color: "5",
        label: "depende de",
      },
    ],
  },
  null,
  2,
);

// ── Lectura ───────────────────────────────────────────────────────────────────

test("lee los cuatro tipos de nodo del formato", () => {
  const c = parsearCanvas(OBSIDIAN);
  assert.deepEqual(c.nodos.map((n) => n.tipo), ["text", "file", "link", "group"]);
  assert.equal(c.nodos[0].texto, "Idea, ver [[BACKLOG]]");
  assert.equal(c.nodos[1].archivo, "docs/BACKLOG.md");
  assert.equal(c.nodos[1].subpath, "#seccion");
  assert.equal(c.nodos[2].url, "https://ejemplo.com");
  assert.equal(c.nodos[3].etiqueta, "Contexto");
});

test("lee las aristas con sus lados, puntas, color y etiqueta", () => {
  const [e] = parsearCanvas(OBSIDIAN).aristas;
  assert.equal(e.desdeNodo, "a");
  assert.equal(e.desdeLado, "right");
  assert.equal(e.desdePunta, "none");
  assert.equal(e.hastaNodo, "b");
  assert.equal(e.hastaLado, "left");
  assert.equal(e.hastaPunta, "arrow");
  assert.equal(e.color, "5");
  assert.equal(e.etiqueta, "depende de");
});

test("un archivo vacío es un canvas vacío, no un error", () => {
  assert.deepEqual(parsearCanvas(""), { nodos: [], aristas: [] });
  assert.deepEqual(parsearCanvas("   \n"), { nodos: [], aristas: [] });
});

test("`{}` sin nodes ni edges también es válido", () => {
  assert.deepEqual(parsearCanvas("{}"), { nodos: [], aristas: [] });
});

test("un JSON inválido SÍ es un error: guardarlo encima destruiría el archivo", () => {
  assert.throws(() => parsearCanvas("{no es json"), ErrorCanvas);
  assert.throws(() => parsearCanvas("[1,2,3]"), ErrorCanvas);
});

test("un nodo sin id se descarta: no se puede referenciar ni dibujar", () => {
  const c = parsearCanvas('{"nodes":[{"type":"text","x":0,"y":0}]}');
  assert.equal(c.nodos.length, 0);
});

test("una flecha a un nodo inexistente se descarta", () => {
  const c = parsearCanvas(
    '{"nodes":[{"id":"a","type":"text","x":0,"y":0,"width":1,"height":1}],' +
      '"edges":[{"id":"e","fromNode":"a","toNode":"fantasma"}]}',
  );
  assert.equal(c.aristas.length, 0);
});

test("faltando medidas, se usan unas por defecto en vez de romper", () => {
  const [n] = parsearCanvas('{"nodes":[{"id":"a","type":"text"}]}').nodos;
  assert.equal(n.x, 0);
  assert.equal(n.ancho > 0, true);
  assert.equal(n.alto > 0, true);
});

// ── LO IMPORTANTE: no perder nada ─────────────────────────────────────────────

test("ida y vuelta: un canvas de Obsidian sobrevive intacto", () => {
  const ida = parsearCanvas(OBSIDIAN);
  const vuelta = parsearCanvas(serializarCanvas(ida));
  assert.deepEqual(
    vuelta.nodos.map((n) => ({ ...n, crudo: undefined })),
    ida.nodos.map((n) => ({ ...n, crudo: undefined })),
  );
  assert.deepEqual(
    vuelta.aristas.map((a) => ({ ...a, crudo: undefined })),
    ida.aristas.map((a) => ({ ...a, crudo: undefined })),
  );
});

test("los campos que Mycelium NO maneja se conservan al guardar", () => {
  const salida = JSON.parse(serializarCanvas(parsearCanvas(OBSIDIAN)));
  const grupo = salida.nodes.find((n) => n.id === "d");
  assert.equal(grupo.background, "fondo.png", "background no se edita, pero no se pierde");
  assert.equal(grupo.backgroundStyle, "cover");
  const archivo = salida.nodes.find((n) => n.id === "b");
  assert.equal(archivo.subpath, "#seccion");
  assert.equal(archivo.color, "3");
});

test("una extensión futura del formato también sobrevive", () => {
  const json = '{"nodes":[{"id":"a","type":"text","x":0,"y":0,"width":9,"height":9,"text":"x","inventado":{"a":1}}],"edges":[]}';
  const salida = JSON.parse(serializarCanvas(parsearCanvas(json)));
  assert.deepEqual(salida.nodes[0].inventado, { a: 1 });
});

test("mover un nodo no toca nada más del archivo", () => {
  const c = parsearCanvas(OBSIDIAN);
  c.nodos[0].x = 999;
  const salida = JSON.parse(serializarCanvas(c));
  assert.equal(salida.nodes[0].x, 999);
  assert.equal(salida.nodes.find((n) => n.id === "d").background, "fondo.png");
});

test("las coordenadas se guardan como enteros, que es lo que pide el formato", () => {
  const c = parsearCanvas(OBSIDIAN);
  c.nodos[0].x = 10.7;
  c.nodos[0].ancho = 33.3;
  const salida = JSON.parse(serializarCanvas(c));
  assert.equal(Number.isInteger(salida.nodes[0].x), true);
  assert.equal(Number.isInteger(salida.nodes[0].width), true);
});

test("no se escriben campos vacíos", () => {
  const salida = JSON.parse(serializarCanvas({ nodos: [nodoTexto("a", 0, 0, "hola")], aristas: [] }));
  assert.equal("color" in salida.nodes[0], false);
  assert.equal("file" in salida.nodes[0], false);
});

test("un canvas nuevo es JSON Canvas válido y vacío", () => {
  assert.deepEqual(parsearCanvas(canvasInicial()), { nodos: [], aristas: [] });
  assert.deepEqual(JSON.parse(canvasInicial()), { nodes: [], edges: [] });
});

// ── Creación ──────────────────────────────────────────────────────────────────

test("nuevoId no repite", () => {
  const usados = new Set(["a", "b"]);
  for (let i = 0; i < 50; i++) usados.add(nuevoId(usados));
  assert.equal(usados.size, 52);
});

test("una flecha nueva deja `toEnd` implícito (el formato ya lo define arrow)", () => {
  const salida = JSON.parse(
    serializarCanvas({
      nodos: [nodoTexto("a", 0, 0), nodoTexto("b", 400, 0)],
      aristas: [nuevaArista("e", "a", "b")],
    }),
  );
  assert.equal("toEnd" in salida.edges[0], false);
  assert.equal(salida.edges[0].fromNode, "a");
});

// ── Geometría ─────────────────────────────────────────────────────────────────

test("las anclas caen en el centro de cada lado", () => {
  const n = { ...nodoTexto("a", 100, 200), ancho: 200, alto: 100 };
  assert.deepEqual(anclaDe(n, "top"), { x: 200, y: 200 });
  assert.deepEqual(anclaDe(n, "bottom"), { x: 200, y: 300 });
  assert.deepEqual(anclaDe(n, "left"), { x: 100, y: 250 });
  assert.deepEqual(anclaDe(n, "right"), { x: 300, y: 250 });
});

test("los lados automáticos siguen el eje donde hay más separación", () => {
  const a = nodoTexto("a", 0, 0);
  assert.deepEqual(ladosAutomaticos(a, nodoTexto("b", 600, 0)), { desde: "right", hasta: "left" });
  assert.deepEqual(ladosAutomaticos(a, nodoTexto("b", -600, 0)), { desde: "left", hasta: "right" });
  assert.deepEqual(ladosAutomaticos(a, nodoTexto("b", 0, 600)), { desde: "bottom", hasta: "top" });
  assert.deepEqual(ladosAutomaticos(a, nodoTexto("b", 0, -600)), { desde: "top", hasta: "bottom" });
});

test("el trazo es una bezier que empieza y termina en las anclas", () => {
  const a = nodoTexto("a", 0, 0);
  const b = nodoTexto("b", 600, 0);
  const t = trazoArista(a, "right", b, "left");
  assert.match(t.d, /^M \d/);
  assert.equal(t.d.includes("C"), true);
  assert.deepEqual(t.fin, anclaDe(b, "left"));
  assert.equal(t.anguloFin, 0, "entrando por la izquierda, la punta mira a la derecha");
});

// ── Qué llega al grafo ────────────────────────────────────────────────────────

test("los wikilinks de las tarjetas de texto cuentan; las flechas no", () => {
  const r = referenciasDe(OBSIDIAN);
  assert.deepEqual(r.titulos, ["BACKLOG"]);
  assert.deepEqual(r.rutas, ["docs/BACKLOG.md"], "la tarjeta de nota sí es una referencia");
});

test("un alias o una ruta dentro del wikilink se resuelven al destino", () => {
  const json = JSON.stringify({
    nodes: [
      { id: "a", type: "text", x: 0, y: 0, width: 9, height: 9, text: "[[Carpeta/Nota|alias]] y [[Otra]]" },
    ],
    edges: [],
  });
  assert.deepEqual(referenciasDe(json).titulos, ["Nota", "Otra"]);
});

test("la barra del alias tambien vale escapada (DEF-045)", () => {
  // `\|` es como se escribe un alias dentro de una tabla. La regla canonica
  // vive en `lib/wikilinks.ts`; `lib/canvas.ts` la lleva copiada porque es puro
  // y sin imports, asi que este test es lo que impide que diverjan.
  const ESC = String.fromCharCode(92) + "|";
  const json = JSON.stringify({
    nodes: [
      {
        id: "a", type: "text", x: 0, y: 0, width: 9, height: 9,
        text: "[[Carpeta/Nota" + ESC + "alias]] y [[Otra" + ESC + "x]]",
      },
    ],
    edges: [],
  });
  assert.deepEqual(referenciasDe(json).titulos, ["Nota", "Otra"]);
});

test("una flecha entre dos tarjetas no aporta ninguna referencia", () => {
  const json = JSON.stringify({
    nodes: [
      { id: "a", type: "text", x: 0, y: 0, width: 9, height: 9, text: "sin enlaces" },
      { id: "b", type: "text", x: 9, y: 0, width: 9, height: 9, text: "tampoco" },
    ],
    edges: [{ id: "e", fromNode: "a", toNode: "b" }],
  });
  assert.deepEqual(referenciasDe(json), { titulos: [], rutas: [] });
});

test("un canvas ilegible no rompe el grafo: no aporta nada y ya", () => {
  assert.deepEqual(referenciasDe("{roto"), { titulos: [], rutas: [] });
});

test("una tarjeta de nota apunta a su ruta, no a un título", () => {
  const json = JSON.stringify({
    nodes: [{ id: "a", type: "file", x: 0, y: 0, width: 9, height: 9, file: "docs/estado/X.md" }],
    edges: [],
  });
  assert.deepEqual(referenciasDe(json), { titulos: [], rutas: ["docs/estado/X.md"] });
});

test("nodoArchivo y nodoTexto producen nodos válidos", () => {
  const c = { nodos: [nodoTexto("a", 1, 2, "hola"), nodoArchivo("b", 3, 4, "x.md")], aristas: [] };
  const vuelta = parsearCanvas(serializarCanvas(c));
  assert.equal(vuelta.nodos[0].texto, "hola");
  assert.equal(vuelta.nodos[1].archivo, "x.md");
  assert.equal(vuelta.nodos[1].tipo, "file");
});

// ── Color ─────────────────────────────────────────────────────────────────────

test("los presets del formato se traducen a un color CSS", () => {
  assert.equal(colorCss("1"), "#fb464c");
  assert.equal(colorCss("6"), "#a882ff");
  assert.equal(colorCss(undefined), null, "sin color = el aspecto de Mycelium");
  assert.equal(colorCss(""), null);
});

test("un hex ajeno se respeta aunque la paleta no lo ofrezca", () => {
  assert.equal(colorCss("#123456"), "#123456");
});

test("un preset que no existe no rompe: se dibuja sin color", () => {
  assert.equal(colorCss("99"), null);
});

test("el color sobrevive a la ida y vuelta", () => {
  const c = parsearCanvas(OBSIDIAN);
  c.nodos[0].color = "4";
  const vuelta = parsearCanvas(serializarCanvas(c));
  assert.equal(vuelta.nodos[0].color, "4");
});

test("quitarle el color a una tarjeta lo borra del archivo", () => {
  const c = parsearCanvas(OBSIDIAN);
  const antes = JSON.parse(serializarCanvas(c)).nodes.find((n) => n.id === "b");
  assert.equal(antes.color, "3");
  c.nodos[1].color = undefined;
  const despues = JSON.parse(serializarCanvas(c)).nodes.find((n) => n.id === "b");
  assert.equal("color" in despues, false);
});

// ── Búsqueda por prefijo ──────────────────────────────────────────────────────

const NOTAS_BUSQUEDA = [
  { titulo: "Versionado del sistema" },
  { titulo: "Version 1.4.0" },
  { titulo: "Conversión de enlaces" },
  { titulo: "versión corta" },
  { titulo: "BACKLOG" },
];

test("busca por PREFIJO, no por «contiene»", () => {
  const r = buscarPorPrefijo(NOTAS_BUSQUEDA, "vers").map((n) => n.titulo);
  assert.deepEqual(r, ["Versionado del sistema", "Version 1.4.0", "versión corta"]);
  assert.equal(
    r.includes("Conversión de enlaces"),
    false,
    "«Conversión» contiene «vers» en el medio: no debe salir",
  );
});

test("la búsqueda ignora mayúsculas y acentos", () => {
  assert.equal(buscarPorPrefijo(NOTAS_BUSQUEDA, "VERSIÓN").length, 3);
  assert.equal(buscarPorPrefijo(NOTAS_BUSQUEDA, "versio").length, 3);
});

test("sin consulta se devuelve todo", () => {
  assert.equal(buscarPorPrefijo(NOTAS_BUSQUEDA, "").length, 5);
  assert.equal(buscarPorPrefijo(NOTAS_BUSQUEDA, "   ").length, 5);
});

test("una consulta que no casa con nada devuelve vacío", () => {
  assert.deepEqual(buscarPorPrefijo(NOTAS_BUSQUEDA, "zzz"), []);
});
