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
  contenidoParaCargar,
  destinoDeEmbed,
  diagramaInicial,
  esDiagramaDrawio,
  EXTENSION_DRAWIO,
  leerEvento,
  urlDelEditor,
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
  assert.ok(url.startsWith("/drawio/index.html?"), "se sirve del mismo origen");
  const p = new URLSearchParams(url.split("?")[1]);
  assert.equal(p.get("embed"), "1");
  assert.equal(p.get("proto"), "json");
  assert.equal(p.get("offline"), "1");
  assert.equal(p.get("stealth"), "1", "sin salidas a la red (CA7)");
  assert.equal(p.get("pwa"), "0", "sin service worker: `offline=1` lo encendería");
  assert.equal(p.get("dark"), "0");
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
