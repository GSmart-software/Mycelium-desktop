// Test de `lib/textoBuscable.ts` (`DEF-148`): el texto que una nota aporta a
// la búsqueda, del que sale el fragmento de cada resultado. Tiene que leerse
// como texto —enlaces por su texto visible, sin marcas de markdown, un canvas
// por sus tarjetas— y lo que deja de verse tiene que seguir encontrándose
// (`oculto`).
//
//   node --test scripts/test-texto-buscable.mjs
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import ts from "typescript";

const aUrl = (codigo) => `data:text/javascript,${encodeURIComponent(codigo)}`;

/** Transpila un `.ts` del repo y reemplaza sus imports según `mapa`. */
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

const { textoBuscable, markdownLegible } = await import(
  await fuente("../lib/textoBuscable.ts", { "@/lib/canvas": await fuente("../lib/canvas.ts") })
);

const md = (texto) => textoBuscable(texto, "markdown");

test("un enlace se lee por su alias o su título, sin corchetes", () => {
  const r = md("Repele a los [[Pulgón|pulgones]] y a la [[Mosca blanca]].");
  assert.equal(r.visible, "Repele a los pulgones y a la Mosca blanca.");
  assert.deepEqual(r.oculto, ["Pulgón"], "el destino de un alias se sigue encontrando");
});

test("enlaces con ancla, a un encabezado propio, embebidos y con alias escapado en tabla", () => {
  assert.equal(md("Ver [[Tomate#Riego]] y [[#Plagas]]").visible, "Ver Tomate › Riego y Plagas");
  assert.equal(md("![[Bancal.excalidraw]]").visible, "Bancal.excalidraw");
  const t = md("| [[Pulgón\\|pulgones]] | x |");
  assert.equal(t.visible, "pulgones · x");
  assert.deepEqual(t.oculto, ["Pulgón"]);
});

test("un enlace markdown se lee por su texto; la URL va a lo oculto", () => {
  const r = md("Ver [la guía](https://ejemplo.com/guia) y ![foto](img/a.png).");
  assert.equal(r.visible, "Ver la guía y foto.");
  assert.deepEqual(r.oculto, ["https://ejemplo.com/guia", "img/a.png"]);
});

test("encabezados, listas, tareas, citas y callouts pierden su marca", () => {
  const r = md("## Usos\n- uno\n* dos\n1. tres\n- [ ] pendiente\n- [x] hecha\n> cita\n> [!warning] Cuidado\n> texto");
  assert.equal(r.visible, "Usos\nuno\ndos\ntres\npendiente\nhecha\ncita\nCuidado\ntexto");
});

test("una etiqueta al principio de línea no es un encabezado", () => {
  assert.equal(md("#cultivo de verano").visible, "#cultivo de verano");
});

test("una tabla se lee por sus celdas, sin la fila separadora", () => {
  const r = md("| Cultivo | Compañera |\n|---|:---:|\n| [[Tomate]] | [[Albahaca]] |");
  assert.equal(r.visible, "Cultivo · Compañera\nTomate · Albahaca");
});

test("énfasis, tachado, resaltado y código en línea pierden su marca", () => {
  assert.equal(
    md("Las **plantas vecinas**, *muy* __juntas__, ~~no~~ ==sí== y `código`.").visible,
    "Las plantas vecinas, muy juntas, no sí y código.",
  );
  // Un guion bajo dentro de una palabra no es énfasis; un asterisco suelto tampoco.
  assert.equal(md("la variable mi_nombre_largo y 2 * 3").visible, "la variable mi_nombre_largo y 2 * 3");
});

test("un bloque de código conserva su contenido, sin las vallas", () => {
  assert.equal(md("antes\n```js\nconst [[a]] = **b**;\n```\ndespués").visible, "antes\nconst [[a]] = **b**;\ndespués");
});

test("una regla horizontal desaparece", () => {
  assert.equal(md("uno\n---\ndos").visible, "uno\ndos");
});

test("markdownLegible junta lo oculto en la lista que recibe", () => {
  const oculto = ["previo"];
  markdownLegible("[[A|a]]", oculto);
  assert.deepEqual(oculto, ["previo", "A"]);
});

test("un canvas aporta el texto de sus tarjetas, grupos y flechas, no su JSON", () => {
  const json = JSON.stringify({
    nodes: [
      { id: "a", type: "text", x: 0, y: 0, width: 1, height: 1, text: "**Bancal 1**\n\n- [[Tomate]] y [[Ají|ajíes]]" },
      { id: "b", type: "file", x: 0, y: 0, width: 1, height: 1, file: "Cultivos/Zanahoria.md" },
      { id: "c", type: "link", x: 0, y: 0, width: 1, height: 1, url: "https://ejemplo.com" },
      { id: "d", type: "group", x: 0, y: 0, width: 1, height: 1, label: "Huerta" },
    ],
    edges: [{ id: "e", fromNode: "a", toNode: "b", label: "rota con" }],
  });
  const r = textoBuscable(json, "canvas");
  assert.equal(r.visible, "Bancal 1\n\nTomate y ajíes\nZanahoria\nHuerta\nrota con");
  assert.deepEqual(r.oculto, ["Ají", "Cultivos/Zanahoria.md", "https://ejemplo.com"]);
});

test("un canvas que no es JSON se indexa crudo, como antes", () => {
  const r = textoBuscable("{ roto", "canvas");
  assert.equal(r.visible, "{ roto");
  assert.deepEqual(r.oculto, []);
});

test("un dibujo de Excalidraw aporta sus textos, no las imágenes en base64", () => {
  const json = JSON.stringify({
    type: "excalidraw",
    elements: [
      { type: "text", text: "Bancal\n1", originalText: "Bancal 1" },
      { type: "rectangle", link: "[[Tomate]]" },
      { type: "text", text: "borrado", isDeleted: true },
    ],
    files: { x: { dataURL: "data:image/png;base64,AAAAZZZZ" } },
  });
  const r = textoBuscable(json, "excalidraw");
  assert.equal(r.visible, "Bancal 1");
  assert.deepEqual(r.oculto, ["[[Tomate]]"]);
});

test("un diagrama de draw.io aporta los rótulos, sin el HTML", () => {
  const xml =
    '<mxfile><diagram><mxGraphModel><root><mxCell id="0"/>' +
    '<mxCell id="2" value="&lt;b&gt;Riego&lt;/b&gt;&lt;br&gt;por goteo" vertex="1"/>' +
    '<mxCell id="3" value="Tanque &amp;amp; bomba" vertex="1"/>' +
    '<mxCell id="4" value="" edge="1"/>' +
    "</root></mxGraphModel></diagram></mxfile>";
  assert.equal(textoBuscable(xml, "drawio").visible, "Riego\npor goteo\nTanque & bomba");
});

test("un draw.io comprimido no aporta su base64", () => {
  assert.equal(textoBuscable('<mxfile><diagram id="x">7VlNb5tAEP01HFsBC8Y+Jm7SHlqpUg5NjyuYwKrAomUd2/31XWAXY/DHWtrWtpTkEjyz+5h5M2+WgYUWWbXlpMw+cQqyhef5W2t1YXmeG/i+/BWWdWsJZ15ryBlNRaPe8EI/QBpdaV2RFKqLhQIhEEQZgYI5LzMgkDNwIhjRZvHxiCNVpZEcoAEPl+QHKXAgBQf9W29UD8yIy/9X4oqJsrc1T7j3fM90H+L7iXc7QeQEqXJVBDVvMH1zZ3UEi4DKLC4GKMLcQ4SzqPyl+H8jE/Vz28B4hpu0OvmmY3tk8DZDl4aW1jEsdJs0BOPmPHlkkrkTGwlE7OeHMNpFqpRVYC7k+bWhm2BRRS8pQXjX5rd0HvUBVu2BLFq7Wdp7Hrs4GCyZKGrkvYk5NqMFlEaSBAkmONfwxKrRQUQGvTqF4xBaLUZo8n9LhmhaNHyqhcMgUJAWmOsCDTeinG7qcJPnTx5Lr44DLKz0BKqMmkplGtnBlUCdbyQh+5glwV0wCrq65qAAZ1RQUQzThe7RF3hOYiOFTqZzdRALrlyJsoDOPS/RrA7tz8iHkGeEmc8QEoYIsC1IJNz5Y/i5QmR9IWLGG4yKCJyz5XQE6hXOp5LwTCChzyCSthKJmimNwGLCK8wESUmjMk1zIxSuVfyTiaEjtm4aZ0qy3bsY6g0yEZjrSnWiuLqTkWb7vwrXxgVcjzvA0LMPw/DVQyMuSzX3Sb/2HMJxVOfjXA==</diagram></mxfile>', "drawio").visible, "");
});

test("una base y cualquier otro tipo se indexan tal cual", () => {
  const yaml = 'filters:\n  and:\n    - file.inFolder("Cultivos")\n';
  assert.equal(textoBuscable(yaml, "base").visible, yaml);
});
