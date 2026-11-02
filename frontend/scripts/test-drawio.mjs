// Test headless (sin navegador ni Tauri) del núcleo de draw.io (`FUN-L-20`).
// `lib/drawio.ts` es puro —sin imports—, así que se transpila en el momento y se
// importa vía data: URL, igual que el resto de los núcleos del proyecto.
//
//   node --test scripts/test-drawio.mjs
//   node scripts/test-drawio.mjs
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import ts from "typescript";

const rutaTs = fileURLToPath(new URL("../lib/drawio.ts", import.meta.url));
const { outputText } = ts.transpileModule(await readFile(rutaTs, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 },
});
const {
  accionCargar,
  accionExportarSvg,
  accionGuardar,
  ALLOW_EDITOR,
  baseDrawio,
  CacheLru,
  claveAPodar,
  claveEsDePestana,
  clavesHuerfanas,
  contenidoParaCargar,
  destinoDeEmbed,
  destinoDeMensajes,
  diagramaInicial,
  embedDrawioRe,
  esDiagramaDrawio,
  esMensajeDeDrawio,
  EXTENSION_DRAWIO,
  huellaXml,
  leerEvento,
  origenDeBase,
  SANDBOX_EDITOR,
  SANDBOX_RENDERIZADOR,
  urlDelEditor,
  urlDelRenderizador,
} = await import(`data:text/javascript,${encodeURIComponent(outputText)}`);

test("la extensión es .drawio", () => {
  assert.equal(EXTENSION_DRAWIO, ".drawio");
});

test("un diagrama nuevo es un mxfile válido con una página vacía", () => {
  const xml = diagramaInicial();
  assert.match(xml, /<mxfile /);
  assert.match(xml, /<diagram /);
  assert.match(xml, /<mxCell id="0" \/>/);
  // Lo que se crea tiene que pasar su propio reconocedor: si no, el editor lo
  // trataría como archivo corrupto justo al crearlo.
  assert.equal(esDiagramaDrawio(xml), true);
});

test("reconoce los diagramas que vienen de afuera y descarta lo que no lo es", () => {
  assert.equal(esDiagramaDrawio('<mxfile host="app.diagrams.net"></mxfile>'), true);
  assert.equal(esDiagramaDrawio('<?xml version="1.0"?><mxfile></mxfile>'), true);
  assert.equal(esDiagramaDrawio("<mxGraphModel><root/></mxGraphModel>"), true);
  assert.equal(esDiagramaDrawio("  \n <mxfile/>  "), true, "tolera espacios al principio");

  assert.equal(esDiagramaDrawio(""), false);
  assert.equal(esDiagramaDrawio("   "), false);
  assert.equal(esDiagramaDrawio("# Una nota"), false);
  assert.equal(esDiagramaDrawio('{"nodes":[]}'), false, "un .canvas no es un diagrama");
});

test("un archivo vacío o ajeno se abre como diagrama nuevo, no como error", () => {
  // Es lo que hace que crear un `.drawio` vacío y abrirlo no requiera caso
  // especial en la vista.
  assert.equal(contenidoParaCargar(""), diagramaInicial());
  assert.equal(contenidoParaCargar(null), diagramaInicial());
  assert.equal(contenidoParaCargar(undefined), diagramaInicial());

  const propio = '<mxfile host="Mycelium"><diagram>x</diagram></mxfile>';
  assert.equal(contenidoParaCargar(propio), propio, "un diagrama real se pasa intacto");
});

test("la URL del editor lleva los parámetros del modo embebido", () => {
  const url = urlDelEditor("claro");
  assert.ok(
    url.startsWith("http://drawio.localhost/index.html?"),
    "se sirve desde su propio origen, no desde el de la app (DEF-168)",
  );
  const p = new URLSearchParams(url.split("?")[1]);
  assert.equal(p.get("embed"), "1");
  assert.equal(p.get("proto"), "json");
  assert.equal(p.get("offline"), "1");
  assert.equal(p.get("stealth"), "1", "sin salidas a la red (CA7)");
  assert.equal(p.get("pwa"), "0", "sin service worker: `offline=1` lo encendería");
  assert.equal(p.get("dark"), "0");
});

test("editor y renderizador apagan el soporte del traductor del navegador (FUN-M-58)", () => {
  // Con él encendido, draw.io cuelga un MutationObserver sobre el <html> de
  // Mycelium que retiene el iframe entero después de soltarlo.
  for (const url of [urlDelEditor("claro"), urlDelEditor("oscuro"), urlDelRenderizador()]) {
    assert.equal(new URLSearchParams(url.split("?")[1]).get("browser-translate"), "0", url);
  }
});

test("el tema oscuro viaja en la URL", () => {
  const p = new URLSearchParams(urlDelEditor("oscuro").split("?")[1]);
  assert.equal(p.get("dark"), "1");
});

test("las acciones del host son las que el editor entiende", () => {
  assert.deepEqual(accionCargar("<mxfile/>"), {
    action: "load",
    xml: "<mxfile/>",
    autosave: 1,
  });
  // No existe `action:'save'`: el guardado es una acción del editor. Si esto
  // cambia, el guardado deja de funcionar en silencio.
  assert.deepEqual(accionGuardar(), { action: "invokeAction", actionName: "save" });
  assert.deepEqual(accionExportarSvg(), { action: "export", format: "xmlsvg" });
});

test("leerEvento acepta los mensajes del editor y rechaza el ruido ajeno", () => {
  assert.deepEqual(leerEvento(JSON.stringify({ event: "init" })), { event: "init" });
  assert.equal(leerEvento(JSON.stringify({ event: "save", xml: "<mxfile/>" })).xml, "<mxfile/>");

  // Por la misma ventana pasan mensajes de otras cosas: tragárselos todos sería
  // confundir un `postMessage` ajeno con un guardado.
  assert.equal(leerEvento(""), null);
  assert.equal(leerEvento("no es json"), null);
  assert.equal(leerEvento(JSON.stringify({ sin: "evento" })), null);
  assert.equal(leerEvento(JSON.stringify({ event: 7 })), null);
  assert.equal(leerEvento({ event: "init" }), null, "solo cadenas: el protocolo es JSON");
  assert.equal(leerEvento(null), null);
  assert.equal(leerEvento(JSON.stringify("hola")), null);
});

test("destinoDeEmbed resuelve ![[diagrama.drawio]] y sus alias", () => {
  assert.equal(destinoDeEmbed("diagrama.drawio"), "diagrama.drawio");
  assert.equal(destinoDeEmbed("carpeta/diagrama.drawio"), "carpeta/diagrama.drawio");
  assert.equal(destinoDeEmbed("diagrama.DRAWIO"), "diagrama.DRAWIO", "la extensión no distingue mayúsculas");
  assert.equal(destinoDeEmbed("diagrama.drawio|Arquitectura"), "diagrama.drawio");
  assert.equal(destinoDeEmbed("  diagrama.drawio  "), "diagrama.drawio");

  assert.equal(destinoDeEmbed("otra nota"), null);
  assert.equal(destinoDeEmbed("dibujo.excalidraw"), null);
  assert.equal(destinoDeEmbed(""), null);
});

// ── El embed en una nota (CA5) ───────────────────────────────────────────────
//
// Esta expresión la usan LAS DOS vistas —lectura (`lib/markdown.ts`) y en vivo
// (`lib/editor/livePreview.ts`)—, que no comparten código. Cuando cada una
// tenía su copia, el embed funcionaba al leer y desaparecía al editar.

/** Todo lo que captura la expresión en un texto. */
const embeds = (texto) => [...texto.matchAll(embedDrawioRe())].map((m) => m[1]);

test("el embed reconoce ![[diagrama.drawio]] y captura el nombre CON extensión", () => {
  // La extensión queda dentro de la captura: el destino se resuelve por nombre
  // de archivo y `sinExtensionDeNota` se la quita después.
  assert.deepEqual(embeds("![[Arquitectura.drawio]]"), ["Arquitectura.drawio"]);
  assert.deepEqual(embeds("![[Carpeta/Arquitectura.drawio]]"), ["Carpeta/Arquitectura.drawio"]);
  assert.deepEqual(embeds("![[Diagrama sin título.drawio]]"), ["Diagrama sin título.drawio"]);
  assert.deepEqual(embeds("![[Arquitectura.DRAWIO]]"), ["Arquitectura.DRAWIO"]);
});

test("el embed aparece igual rodeado de texto y varias veces", () => {
  assert.deepEqual(embeds("Ver ![[a.drawio]] y también ![[b.drawio]]."), [
    "a.drawio",
    "b.drawio",
  ]);
});

test("la expresión NO se lleva por delante otros embeds ni los enlaces", () => {
  assert.deepEqual(embeds("![[dibujo.excalidraw]]"), []);
  assert.deepEqual(embeds("![[lienzo.canvas]]"), []);
  assert.deepEqual(embeds("![[Mi nota]]"), [], "sin extensión no es un embed de draw.io");
  assert.deepEqual(embeds("[[Arquitectura.drawio]]"), [], "sin `!` es un enlace, no un embed");
});

test("cada llamada da una expresión nueva (el /g no se comparte)", () => {
  // Dos vistas recorriendo la MISMA expresión con `lastIndex` compartido se
  // saltarían embeds de forma intermitente, que es de lo peor que hay para
  // diagnosticar.
  const a = embedDrawioRe();
  const b = embedDrawioRe();
  assert.notEqual(a, b);
  a.exec("![[x.drawio]]");
  assert.equal(b.lastIndex, 0);
});

// ── Vida de un editor abierto ────────────────────────────────────────────────

test("las claves del panel lateral no son pestañas", () => {
  assert.equal(claveEsDePestana("tab-123"), true);
  assert.equal(claveEsDePestana("sidebar:Diagrama"), false);
});

test("se sueltan los editores cuya pestaña se cerró, y solo esos", () => {
  const abiertas = new Set(["tab-1", "tab-3"]);
  assert.deepEqual(
    clavesHuerfanas(["tab-1", "tab-2", "tab-3", "tab-4"], abiertas).sort(),
    ["tab-2", "tab-4"],
  );
});

test("el panel lateral NO se suelta al cerrar pestañas", () => {
  // Olvidarlo cerraría el diagrama anclado cada vez que se cierra cualquier
  // pestaña, porque el panel lateral no está en el árbol de pestañas.
  assert.deepEqual(clavesHuerfanas(["sidebar:Plano"], new Set()), []);
  assert.deepEqual(clavesHuerfanas(["sidebar:Plano", "tab-9"], new Set(["tab-9"])), []);
});

test("la poda elige el oculto más viejo y nunca uno que se está viendo", () => {
  const vivas = [
    { clave: "viejo-visible", visible: true },
    { clave: "viejo-oculto", visible: false },
    { clave: "nuevo-oculto", visible: false },
    { clave: "nuevo-visible", visible: true },
  ];
  assert.equal(claveAPodar(vivas, 1), "viejo-oculto");
});

test("el tope cuenta solo los ocultos (FUN-M-58): los visibles no entran", () => {
  // Dos panes y el panel lateral mostrando diagramas, más un oculto: no sobra nada.
  const vivas = [
    { clave: "a", visible: true },
    { clave: "oculto", visible: false },
    { clave: "b", visible: true },
    { clave: "sidebar:c", visible: true },
  ];
  assert.equal(claveAPodar(vivas, 1), null);
});

test("no se poda nada si no se pasa del tope", () => {
  assert.equal(claveAPodar([{ clave: "a", visible: false }], 1), null);
  assert.equal(claveAPodar([], 1), null);
});

test("si TODOS están visibles no se poda: recargar delante del usuario es peor", () => {
  const todosVisibles = [
    { clave: "a", visible: true },
    { clave: "b", visible: true },
    { clave: "c", visible: true },
    { clave: "d", visible: true },
  ];
  assert.equal(claveAPodar(todosVisibles, 1), null);
});

test("un oculto con cambios sin guardar nunca se poda, aunque se pase del tope", () => {
  const vivas = [
    { clave: "sucio-viejo", visible: false, sucio: true },
    { clave: "limpio", visible: false, sucio: false },
    { clave: "visible", visible: true },
  ];
  assert.equal(claveAPodar(vivas, 1), "limpio", "sale el limpio aunque sea más nuevo");
  const todosSucios = [
    { clave: "x", visible: false, sucio: true },
    { clave: "y", visible: false, sucio: true },
  ];
  assert.equal(claveAPodar(todosSucios, 1), null, "si todos están sucios se quedan");
});

// ── Caché de vistas previas (FUN-M-58) ───────────────────────────────────────

test("la huella del XML es estable y distingue contenidos distintos", () => {
  const a = diagramaInicial();
  assert.equal(huellaXml(a), huellaXml(String(a)));
  assert.notEqual(huellaXml(a), huellaXml(a + " "));
  assert.notEqual(huellaXml("<mxfile>a</mxfile>"), huellaXml("<mxfile>b</mxfile>"));
});

test("la caché LRU desaloja al menos usado y respeta los dos topes", () => {
  const c = new CacheLru(2, 100);
  c.set("a", "1");
  c.set("b", "2");
  assert.equal(c.get("a"), "1"); // `a` pasa a ser el más reciente
  c.set("c", "3");
  assert.equal(c.get("b"), undefined, "sale el menos usado");
  assert.equal(c.get("a"), "1");
  assert.equal(c.tamano, 2);

  const t = new CacheLru(10, 10);
  t.set("x", "12345");
  t.set("y", "12345");
  t.set("z", "123");
  assert.equal(t.get("x"), undefined, "el tope de tamaño también desaloja");
  assert.ok(t.caracteres <= 10);
  t.set("enorme", "x".repeat(11));
  assert.equal(t.get("enorme"), undefined, "lo que no entra no se guarda");
  assert.equal(t.get("z"), "123", "ni desaloja a los demás");
});

// ── Su propio origen (DEF-168) ───────────────────────────────────────────────

test("la raíz de draw.io sale de convertFileSrc, con la forma de cada sistema", () => {
  const windows = (r, p) => `http://${p}.localhost/${encodeURIComponent(r)}`;
  const mac = (r, p) => `${p}://localhost/${encodeURIComponent(r)}`;
  assert.equal(baseDrawio(windows), "http://drawio.localhost/");
  assert.equal(baseDrawio(mac), "drawio://localhost/");
  assert.equal(baseDrawio(undefined), "http://drawio.localhost/", "fuera de Tauri, la forma de Windows");
  assert.equal(urlDelEditor("claro", "es", "drawio://localhost/").split("?")[0], "drawio://localhost/index.html");
});

test("el origen y el destino de los mensajes", () => {
  assert.equal(origenDeBase("http://drawio.localhost/"), "http://drawio.localhost");
  assert.equal(origenDeBase("https://drawio.localhost/x?y"), "https://drawio.localhost");
  assert.equal(origenDeBase("drawio://localhost/"), "drawio://localhost");
  assert.equal(destinoDeMensajes("http://drawio.localhost"), "http://drawio.localhost");
  assert.equal(destinoDeMensajes("drawio://localhost"), "*", "un esquema propio no sirve de destino");
});

test("solo se aceptan los mensajes del iframe esperado y de su origen", () => {
  const marco = {};
  const otro = {};
  const web = "http://drawio.localhost";
  assert.equal(esMensajeDeDrawio({ source: marco, origin: web }, marco, web), true);
  assert.equal(esMensajeDeDrawio({ source: otro, origin: web }, marco, web), false, "otra ventana");
  assert.equal(esMensajeDeDrawio({ source: marco, origin: "http://tauri.localhost" }, marco, web), false);
  assert.equal(esMensajeDeDrawio({ source: marco, origin: "null" }, marco, web), false);
  assert.equal(esMensajeDeDrawio({ source: null, origin: web }, null, web), false, "sin iframe, nada");
  const propio = "drawio://localhost";
  assert.equal(esMensajeDeDrawio({ source: marco, origin: propio }, marco, propio), true);
  assert.equal(esMensajeDeDrawio({ source: marco, origin: "null" }, marco, propio), true);
  assert.equal(esMensajeDeDrawio({ source: marco, origin: "https://x.com" }, marco, propio), false);
});

test("los marcos no pueden navegar la ventana", () => {
  for (const s of [SANDBOX_EDITOR, SANDBOX_RENDERIZADOR]) {
    assert.ok(s.split(" ").includes("allow-scripts"));
    assert.ok(!/allow-top-navigation/.test(s), s);
    assert.ok(!/allow-popups-to-escape-sandbox/.test(s), s);
  }
  assert.ok(!/allow-downloads|allow-popups|allow-modals/.test(SANDBOX_RENDERIZADOR));
  assert.match(ALLOW_EDITOR, /clipboard-write/);
});
