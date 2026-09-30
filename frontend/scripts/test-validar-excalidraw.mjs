// Test headless del validador de dibujos `.excalidraw` (`FUN-L-26`, skill
// `mycelium-excalidraw`). Los fixtures «bueno-*» se generaron siguiendo la skill
// y se comprobó que Excalidraw 0.18 los carga sin perder nada; los «malo-*»
// tienen cada uno una familia de errores.
//
//   node --test scripts/test-validar-excalidraw.mjs
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { validar } from "./validar-excalidraw.mjs";

const DIR = fileURLToPath(new URL("./fixtures/ia/excalidraw/", import.meta.url));
const leer = (n) => readFileSync(DIR + n, "utf8");
const buenos = readdirSync(DIR).filter((n) => n.startsWith("bueno-"));
const hay = (lista, re) => assert.ok(lista.some((m) => re.test(m)), `falta ${re} en:\n  ${lista.join("\n  ")}`);

// Escena mínima para los casos sintéticos: dos cajas enlazadas por una flecha.
function escena() {
  const base = { angle: 0, strokeColor: "#1e1e1e", backgroundColor: "transparent", fillStyle: "solid", strokeWidth: 2, strokeStyle: "solid", roughness: 1, opacity: 100, groupIds: [], frameId: null, roundness: null, seed: 1, version: 1, versionNonce: 1, isDeleted: false, boundElements: [], updated: 1, link: null, locked: false };
  const a = { ...base, id: "a", type: "rectangle", x: 100, y: 100, width: 120, height: 60, boundElements: [{ id: "f", type: "arrow" }] };
  const b = { ...base, id: "b", type: "rectangle", x: 400, y: 100, width: 120, height: 60, boundElements: [{ id: "f", type: "arrow" }] };
  const f = { ...base, id: "f", type: "arrow", x: 228, y: 130, width: 164, height: 0, points: [[0, 0], [164, 0]], startBinding: { elementId: "a", focus: 0, gap: 8 }, endBinding: { elementId: "b", focus: 0, gap: 8 }, startArrowhead: null, endArrowhead: "arrow" };
  return { base, a, b, f, json: (...extra) => JSON.stringify({ type: "excalidraw", version: 2, elements: [a, b, f, ...extra], appState: {}, files: {} }) };
}

test("hay al menos tres fixtures buenos y tres malos", () => {
  assert.ok(buenos.length >= 3);
  assert.ok(readdirSync(DIR).filter((n) => n.startsWith("malo-")).length >= 3);
});

for (const n of buenos) {
  test(`${n}: sin errores ni avisos`, () => {
    const r = validar(leer(n));
    assert.deepEqual(r.errores, []);
    assert.deepEqual(r.avisos, []);
    assert.ok(r.elementos > 5);
  });
}

test("malo-json-roto: JSON inválido", () => {
  hay(validar(leer("malo-json-roto.excalidraw")).errores, /JSON inválido/);
});

test("malo-enlaces-rotos: recíprocos, inexistentes y points[0]", () => {
  const { errores } = validar(leer("malo-enlaces-rotos.excalidraw"));
  hay(errores, /no lista la flecha en boundElements/);
  hay(errores, /apunta a «no-existe», que no existe/);
  hay(errores, /points\[0\] tiene que ser \[0, 0\]/);
  hay(errores, /pero la flecha no la enlaza/);
  hay(errores, /no lo lista en boundElements .*type: "text"/);
});

test("malo-geometria: id repetido, texto que no entra, superposición, flecha lejos", () => {
  const { errores } = validar(leer("malo-geometria.excalidraw"));
  hay(errores, /id repetido/);
  hay(errores, /no entra a lo ancho/);
  hay(errores, /se superponen/);
  hay(errores, /la flecha no llega a la forma/);
});

test("malo-campos: lo que hace que Excalidraw descarte o no cargue", () => {
  const { errores } = validar(leer("malo-campos.excalidraw"));
  hay(errores, /"points" tiene que ser un array/);
  hay(errores, /seed" tiene que ser un entero/);
  hay(errores, /fontFamily undefined/);
  hay(errores, /tipo desconocido "hexagono"/);
  hay(errores, /"width" tiene que ser un número/);
});

test("un archivo vacío es un dibujo en blanco, no un error", () => {
  const r = validar("");
  assert.deepEqual(r.errores, []);
});

test("sin elements, o con otro type, es error", () => {
  hay(validar('{"type":"excalidraw"}').errores, /falta "elements"/);
  hay(validar('{"type":"excalidrawlib","elements":[]}').errores, /tiene que ser "excalidraw"/);
});

test("la escena sintética es válida", () => {
  assert.deepEqual(validar(escena().json()).errores, []);
});

test("un extremo metido dentro de la forma es error", () => {
  const s = escena();
  s.f.points = [[0, 0], [200, 0]];
  s.f.width = 200;
  hay(validar(s.json()).errores, /DENTRO de rectángulo b/);
});

test("el extremo sobre el borde de una elipse y de un rombo se mide sobre su contorno", () => {
  for (const type of ["ellipse", "diamond"]) {
    const s = escena();
    s.b.type = type;
    // centro de b: (460, 130); borde izquierdo en x = 400 para los dos; gap 8 → 392
    assert.deepEqual(validar(s.json()).errores, [], type);
    s.f.points = [[0, 0], [120, 0]];
    s.f.width = 120;
    hay(validar(s.json()).errores, /la flecha no llega/);
  }
});

test("texto en contenedor: recíproco, que entre y que esté adentro", () => {
  const s = escena();
  const t = { ...s.base, id: "t", type: "text", x: 125, y: 118, width: 70, height: 25, text: "Hola", originalText: "Hola", fontSize: 20, fontFamily: 5, lineHeight: 1.25, textAlign: "center", verticalAlign: "middle", containerId: "a", autoResize: true };
  s.a.boundElements.push({ id: "t", type: "text" });
  assert.deepEqual(validar(s.json(t)).errores, []);
  // En un rombo del mismo ancho el área útil es ancho/2 − 10 = 50 px: «Hola» (~44 px) entra, «Hola mundo» no
  s.a.type = "diamond";
  t.text = t.originalText = "Hola mundo";
  hay(validar(s.json(t)).errores, /no entra a lo ancho/);
});

test("una forma que contiene entera a otra no es superposición; una que la pisa, sí", () => {
  const s = escena();
  const zona = { ...s.base, id: "z", type: "rectangle", x: 50, y: 50, width: 520, height: 200 };
  assert.deepEqual(validar(s.json(zona)).errores, []);
  zona.width = 400; // tapa media caja b

  hay(validar(s.json(zona)).errores, /se superponen/);
});

test("una flecha que atraviesa una forma ajena es aviso", () => {
  const s = escena();
  const obst = { ...s.base, id: "o", type: "rectangle", x: 280, y: 110, width: 60, height: 40 };
  hay(validar(s.json(obst)).avisos, /atraviesa rectángulo o/);
});

test("un dibujo lejos del origen avisa que se abre vacío", () => {
  const s = escena();
  for (const e of [s.a, s.b, s.f]) e.x += 5000;
  hay(validar(s.json()).avisos, /pantalla vacía/);
});

test("la CLI sale con 1 si hay errores y con 0 si no", () => {
  const cli = fileURLToPath(new URL("./validar-excalidraw.mjs", import.meta.url));
  const ok = spawnSync(process.execPath, [cli, DIR + buenos[0]], { encoding: "utf8" });
  assert.equal(ok.status, 0, ok.stdout);
  const mal = spawnSync(process.execPath, [cli, DIR + "malo-geometria.excalidraw"], { encoding: "utf8" });
  assert.equal(mal.status, 1);
  assert.match(mal.stdout, /ERROR/);
});
