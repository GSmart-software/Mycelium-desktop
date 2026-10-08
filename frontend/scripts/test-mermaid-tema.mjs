// Test de los colores de Mermaid (`DEF-142`): `lib/mermaidTema.ts`.
//
// En modo oscuro Mermaid dibujaba con su tema claro de fábrica: cajas blancas y
// una flecha gris que casi no se veía sobre el fondo. Ahora recibe los tokens
// `--mic-mermaid-*` resueltos. Esto prueba la parte pura: que las variables
// salgan de esos colores, que el modo oscuro se detecte, y que el texto, las
// líneas y los bordes lleguen SIEMPRE al contraste mínimo, aunque un snippet
// elija colores que no llegan. El render real en los 16 combos de tema × modo ×
// atmósfera lo mide `scripts/smoke-mermaid-tema.mjs` en Chromium.
//
//   node --test scripts/test-mermaid-tema.mjs
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import ts from "typescript";

const rutaTs = fileURLToPath(new URL("../lib/mermaidTema.ts", import.meta.url));
const { outputText } = ts.transpileModule(await readFile(rutaTs, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
});
const { variablesMermaid, contraste, asegurarContraste, parsearColor, CONTRASTE_TEXTO, CONTRASTE_LINEA } =
  await import(`data:text/javascript,${encodeURIComponent(outputText)}`);

/** `color-mix(in srgb, a p%, b)` para colores opacos. */
function mix(a, p, b) {
  const [ca, cb] = [parsearColor(a), parsearColor(b)];
  return "#" + ca.map((x, i) => Math.round(x * p + cb[i] * (1 - p)).toString(16).padStart(2, "0")).join("");
}

// Los colores crudos de `styles/tokens.css` (atmósfera Abisal, que no tiene reglas).
const TEMAS = {
  "bioluminiscencia claro": { canvas: "#F1F6F7", mist: "#E3EEF1", accent: "#0E7C8C", glow: "#16B8C9", ink: "#1F2D30", muted: "#59696C" },
  "cantarela claro": { canvas: "#FBF7EE", mist: "#FAF0DC", accent: "#9A6212", glow: "#D99A1F", ink: "#2C2620", muted: "#6B5E4C" },
  "bioluminiscencia oscuro": { canvas: "#071219", mist: "#0a1a24", accent: "#19e6ff", glow: "#3dffc4", ink: "#c6e7e1", muted: "#6e9a99" },
  "cantarela oscuro": { canvas: "#1b1305", mist: "#241a08", accent: "#c77f2e", glow: "#ffc247", ink: "#f6e8c8", muted: "#ac9468" },
};

/** Los tokens `--mic-mermaid-*` como los resuelve `tokens.css`. */
const tokens = (t) => ({
  fondo: t.canvas,
  nodo: mix(t.accent, 0.12, t.canvas),
  nodo2: mix(t.glow, 0.14, t.canvas),
  grupo: t.mist,
  borde: t.accent,
  linea: t.muted,
  texto: t.ink,
});

function verificarContraste(v, nombre) {
  for (const fondo of [v.background, v.primaryColor, v.secondaryColor, v.tertiaryColor]) {
    assert.ok(contraste(v.textColor, fondo) >= CONTRASTE_TEXTO, `${nombre}: texto sobre ${fondo}`);
  }
  for (const fondo of [v.background, v.clusterBkg]) {
    assert.ok(contraste(v.lineColor, fondo) >= CONTRASTE_LINEA, `${nombre}: línea sobre ${fondo}`);
  }
  assert.ok(contraste(v.nodeBorder, v.background) >= CONTRASTE_LINEA, `${nombre}: borde`);
}

test("los cuatro combos tema × modo llegan al contraste sin corregir nada", () => {
  for (const [nombre, t] of Object.entries(TEMAS)) {
    const c = tokens(t);
    const v = variablesMermaid(c);
    verificarContraste(v, nombre);
    // Con las fórmulas de tokens.css no hace falta acercar nada: salen los tokens tal cual.
    assert.equal(v.textColor, c.texto, `${nombre}: texto`);
    assert.equal(v.lineColor, c.linea, `${nombre}: línea`);
    assert.equal(v.nodeBorder, c.borde, `${nombre}: borde`);
  }
});

test("el modo oscuro se detecta por el fondo, y las cajas no son blancas (H33)", () => {
  for (const [nombre, t] of Object.entries(TEMAS)) {
    const v = variablesMermaid(tokens(t));
    assert.equal(v.darkMode, nombre.endsWith("oscuro"), nombre);
    if (v.darkMode) assert.ok(contraste(v.primaryColor, "#ffffff") > 10, `${nombre}: caja oscura`);
  }
});

test("variables que Mermaid usa en flujo, secuencia y notas salen de los tokens", () => {
  const c = tokens(TEMAS["bioluminiscencia oscuro"]);
  const v = variablesMermaid(c, "Inter, sans-serif");
  assert.equal(v.primaryColor, c.nodo);
  assert.equal(v.mainBkg, c.nodo);
  assert.equal(v.secondaryColor, c.nodo2);
  assert.equal(v.clusterBkg, c.grupo);
  assert.equal(v.edgeLabelBackground, c.fondo);
  assert.equal(v.arrowheadColor, v.lineColor);
  assert.equal(v.signalColor, v.lineColor);
  assert.equal(v.actorTextColor, v.textColor);
  assert.equal(v.fontFamily, "Inter, sans-serif");
  // Mermaid solo entiende hex: ningún valor de color puede ser un var() o un color-mix().
  for (const [k, valor] of Object.entries(v)) {
    if (k === "darkMode" || k === "fontFamily") continue;
    assert.match(String(valor), /^#[0-9a-f]{6}$/i, k);
  }
});

test("un snippet con colores ilegibles se corrige hasta el mínimo", () => {
  const casos = [
    // La flecha gris del defecto sobre el fondo oscuro.
    { fondo: "#071219", nodo: "#0b1d27", nodo2: "#0b1d27", grupo: "#0a1a24", borde: "#123040", linea: "#333333", texto: "#203038" },
    // Todo blanco sobre blanco.
    { fondo: "#ffffff", nodo: "#ffffff", nodo2: "#fafafa", grupo: "#f4f4f4", borde: "#ffffff", linea: "#eeeeee", texto: "#f0f0f0" },
    // Gris medio: la tinta del snippet no llega, hay que ir al extremo que sirve.
    { fondo: "#777777", nodo: "#7a7a7a", nodo2: "#757575", grupo: "#787878", borde: "#7b7b7b", linea: "#787878", texto: "#7f7f7f" },
  ];
  for (const [i, c] of casos.entries()) verificarContraste(variablesMermaid(c), `caso ${i}`);
});

test("sin ningún color posible, el extremo que mejor queda contra el peor fondo", () => {
  // #808080 pide negro y #707070 blanco: ninguno llega a 4.5 contra los dos.
  const c = asegurarContraste("#7f7f7f", ["#808080", "#707070"], 4.5, "#7f7f7f");
  const peor = (x) => Math.min(contraste(x, "#808080"), contraste(x, "#707070"));
  assert.ok(["#ffffff", "#000000"].includes(c));
  assert.ok(peor(c) >= peor(c === "#ffffff" ? "#000000" : "#ffffff"));
});

test("asegurarContraste no toca un color que ya llega", () => {
  assert.equal(asegurarContraste("#000000", ["#ffffff"], 4.5, "#000000"), "#000000");
  const corregido = asegurarContraste("#999999", ["#ffffff"], 4.5, "#1f2d30");
  assert.ok(contraste(corregido, "#ffffff") >= 4.5);
  assert.notEqual(corregido, "#1f2d30", "se acerca lo justo, no salta a la tinta");
});

test("parsearColor entiende lo que devuelve el navegador", () => {
  assert.deepEqual(parsearColor("#abc"), [170, 187, 204]);
  assert.deepEqual(parsearColor("#0E7C8C"), [14, 124, 140]);
  assert.deepEqual(parsearColor("rgb(7, 18, 25)"), [7, 18, 25]);
  assert.deepEqual(parsearColor("rgba(7, 18, 25, 0.5)"), [7, 18, 25]);
  assert.equal(parsearColor("color-mix(in srgb, red, blue)"), null);
});
