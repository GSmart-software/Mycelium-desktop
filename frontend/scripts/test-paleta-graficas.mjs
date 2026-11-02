// Test de la paleta de las gráficas (`FUN-L-32`, parte A): `lib/paletaGraficas.ts`.
//
// La paleta sale del tema activo: una rampa tonal del acento al glow, y un paso
// fijo por grupo de archivos. Esto prueba que, con los colores crudos de
// `styles/tokens.css`, dé exactamente lo que dio la implementación de
// referencia de la spec (`scratchpad/dash/paleta3.mjs`, valores guardados en
// `paletas3.json` el 2026-11-02), que el recorte al gamut no cambie el tono, y
// que el color de un grupo no dependa de su tamaño.
//
//   node --test scripts/test-paleta-graficas.mjs
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import ts from "typescript";

const rutaTs = fileURLToPath(new URL("../lib/paletaGraficas.ts", import.meta.url));
const { outputText } = ts.transpileModule(await readFile(rutaTs, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
});
const P = await import(`data:text/javascript,${encodeURIComponent(outputText)}`);

// [acento, glow, modo, mist, tinta tenue] crudos de `styles/tokens.css`, como los usó la referencia.
const TEMAS = {
  bio: ["#0E7C8C", "#16B8C9", "claro", "#E3EEF1", "#59696C"],
  "bio-osc": ["#19e6ff", "#3dffc4", "oscuro", "#0a1a24", "#6e9a99"],
  cantarela: ["#9A6212", "#D99A1F", "claro", "#FAF0DC", "#6B5E4C"],
  "cantarela-osc": ["#c77f2e", "#ffc247", "oscuro", "#241a08", "#ac9468"],
  amethystina: ["#6C3DBD", "#9860E8", "claro", "#EFE6F9", "#62577A"],
  "amethystina-osc": ["#b78cff", "#dcb6ff", "oscuro", "#1a1228", "#9d8db4"],
  amanita: ["#B81F2D", "#D0602A", "claro", "#F8E9E4", "#6F5652"],
  "amanita-osc": ["#ff6656", "#ffb59c", "oscuro", "#241211", "#b38c86"],
};

// Notas, Imágenes, PDF, Visuales — salida de la referencia (`paletas3.json`).
const ESPERADO = {
  bio: ["#01343c", "#1097a7", "#006470", "#41d0e1"],
  "bio-osc": ["#007784", "#17dec6", "#00a9a9", "#c7ffe7"],
  cantarela: ["#422701", "#b47800", "#7a4d00", "#edad3b"],
  "cantarela-osc": ["#965801", "#f6b347", "#c8831c", "#feeed3"],
  amethystina: ["#390075", "#9764ea", "#6731b4", "#c6a8fe"],
  "amethystina-osc": ["#794cb9", "#d3adfe", "#a57bdd", "#f5ecfe"],
  amanita: ["#5c010d", "#d75935", "#a4160a", "#fe9f76"],
  "amanita-osc": ["#be251d", "#fea891", "#e46952", "#feece6"],
};

const paleta = (t) => {
  const [a, g, modo, sup, gris] = TEMAS[t];
  return P.paletaGrupos(a, g, gris, modo, sup);
};

test("los ocho temas × modo dan los colores de la referencia", () => {
  for (const t of Object.keys(TEMAS)) {
    const p = paleta(t);
    const { notas, imagenes, pdf, visuales, otros } = p.grupos;
    assert.deepEqual([notas, imagenes, pdf, visuales], ESPERADO[t], t);
    assert.equal(otros, TEMAS[t][4], `${t}: Otros es la tinta tenue`);
    // Los cuatro pasos de la rampa, cada uno en un grupo distinto.
    assert.deepEqual([notas, imagenes, pdf, visuales].sort(), [...p.rampa].sort(), t);
  }
});

test("la separación de los vecinos llega a los pisos de la spec", () => {
  for (const t of Object.keys(TEMAS)) {
    const s = paleta(t).separacion;
    assert.ok(s.vecinosDaltonismo >= 8, `${t}: daltonismo ${s.vecinosDaltonismo}`);
    assert.ok(s.vecinosNormal >= 14, `${t}: visión normal ${s.vecinosNormal}`);
  }
});

test("la torta va en ORDEN_TORTA y el color de cada grupo no depende del tamaño", () => {
  const p = paleta("bio");
  assert.deepEqual([...P.ORDEN_TORTA], ["imagenes", "pdf", "notas", "visuales", "otros"]);
  assert.deepEqual(p.torta, P.ORDEN_TORTA.map((g) => p.grupos[g]));
  // La función no recibe tamaños: dos llamadas con los mismos colores dan lo mismo.
  assert.deepEqual(paleta("bio").grupos, p.grupos);
  assert.equal(P.paletaGrupos.length, 5, "firma: acento, glow, gris, modo, superficie");
});

test("la rampa respeta la luminosidad y el tono, y recorta el gamut por saturación", () => {
  for (const [modo, ls] of [["claro", [0.3, 0.46, 0.62, 0.79]], ["oscuro", [0.52, 0.665, 0.81, 0.955]]]) {
    const r = P.rampaTonal("#0E7C8C", "#16B8C9", modo);
    assert.equal(r.length, 4);
    r.forEach((c, i) => assert.ok(Math.abs(P.hexAOklch(c)[0] - ls[i]) < 0.006, `${modo} paso ${i}: L`));
  }
  // Un color fuera de sRGB (L alta y saturación enorme): sale válido, con su L y su tono.
  const c = P.oklchAHex(0.9, 0.4, 30);
  assert.match(c, /^#[0-9a-f]{6}$/);
  const [L, C, H] = P.hexAOklch(c);
  assert.ok(Math.abs(L - 0.9) < 0.006, `L ${L}`);
  assert.ok(C < 0.4, `saturación recortada ${C}`);
  assert.ok(Math.abs(((H - 30 + 540) % 360) - 180) < 3, `tono ${H}`);
  // Uno que entra no se toca (ida y vuelta).
  const [l2, c2, h2] = P.hexAOklch("#0e7c8c");
  assert.equal(P.oklchAHex(l2, c2, h2), "#0e7c8c");
});

test("deltaE: cero entre iguales, y simétrica", () => {
  assert.equal(P.deltaE("#123456", "#123456"), 0);
  assert.equal(P.deltaE("#123456", "#123456", "protan"), 0);
  assert.ok(Math.abs(P.deltaE("#000000", "#ffffff") - 100) < 0.1);
  assert.equal(P.deltaE("#ff0000", "#00ff00", "deutan"), P.deltaE("#00ff00", "#ff0000", "deutan"));
});

test("tonosExtra da colores distintos, del tema y dentro de la franja", () => {
  const extra = P.tonosExtra("#0E7C8C", "#16B8C9", "claro", 7);
  assert.equal(extra.length, 7);
  assert.equal(new Set(extra).size, 7);
  for (const c of extra) {
    const [L] = P.hexAOklch(c);
    assert.ok(L >= 0.29 && L <= 0.8, `${c}: L ${L}`);
  }
  assert.deepEqual(P.tonosExtra("#0E7C8C", "#16B8C9", "claro", 0), []);
});

test("la caché devuelve el mismo objeto para la misma combinación", () => {
  const a = P.paletaEnCache("#0E7C8C", "#16B8C9", "#59696C", "claro", "#F1F6F7");
  const b = P.paletaEnCache("#0e7c8c", "#16b8c9", "#59696c", "claro", "#f1f6f7");
  assert.equal(a, b);
  const c = P.paletaEnCache("#0E7C8C", "#16B8C9", "#59696C", "oscuro", "#F1F6F7");
  assert.notEqual(a, c);
});

test("sin DOM, leerPaletaGraficas usa los colores por defecto", () => {
  const p = P.leerPaletaGraficas();
  const d = P.TOKENS_POR_DEFECTO;
  assert.equal(p.acento, d.acento);
  assert.equal(p.modo, "claro");
  assert.equal(p.grupos.otros, d.gris);
});
