// Test headless de la decisión «¿recargar desde disco?» de los lienzos, los
// diagramas de draw.io y los dibujos de Excalidraw (`FUN-L-26`, parte A).
//
// `lib/recargaExterna.ts` es puro —sin imports—, así que se transpila en el
// momento y se importa vía data: URL, igual que el resto de los núcleos.
//
//   node --test scripts/test-recarga-externa.mjs
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import ts from "typescript";

const rutaTs = fileURLToPath(new URL("../lib/recargaExterna.ts", import.meta.url));
const { outputText } = ts.transpileModule(await readFile(rutaTs, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
});
const R = await import(`data:text/javascript,${encodeURIComponent(outputText)}`);

// ── ¿El aviso toca a este archivo? ─────────────────────────────────────────

test("un aviso sin detalle toca a cualquiera", () => {
  assert.equal(R.avisoTocaA({}, "a.canvas"), true);
  assert.equal(R.avisoTocaA(null, "a.canvas"), true);
  assert.equal(R.avisoTocaA({ detail: null }, "a.canvas"), true);
});

test("con rutas, solo toca a las que trae", () => {
  const ev = { detail: { rutas: ["Notas/x.md", "Diagramas/d.drawio"] } };
  assert.equal(R.avisoTocaA(ev, "Diagramas/d.drawio"), true);
  assert.equal(R.avisoTocaA(ev, "Diagramas/otro.drawio"), false);
});

test("una lista vacía no toca a nadie", () => {
  assert.equal(R.avisoTocaA({ detail: { rutas: [] } }, "a.canvas"), false);
});

// ── ¿Recargar? ──────────────────────────────────────────────────────────────

test("cambio de afuera en una vista limpia: se recarga", () => {
  assert.equal(R.hayQueRecargar({ disco: "nuevo", sucio: false, conocido: "viejo" }), true);
});

test("con cambios sin guardar no se recarga, aunque el disco cambió", () => {
  assert.equal(R.hayQueRecargar({ disco: "nuevo", sucio: true, conocido: "viejo" }), false);
});

test("el eco del guardado propio no es un cambio", () => {
  assert.equal(R.hayQueRecargar({ disco: "guardado", sucio: false, conocido: "guardado" }), false);
});

test("si el disco ya dice lo que se ve, no se recarga", () => {
  assert.equal(
    R.hayQueRecargar({ disco: "igual", sucio: false, conocido: "otro", enPantalla: "igual" }),
    false,
  );
});

test("sin nada conocido (null), un disco distinto de lo que se ve se recarga", () => {
  assert.equal(R.hayQueRecargar({ disco: "x", sucio: false, conocido: null }), true);
  assert.equal(
    R.hayQueRecargar({ disco: "x", sucio: false, conocido: null, enPantalla: null }),
    true,
  );
});

test("un archivo vaciado desde afuera también se recarga", () => {
  assert.equal(R.hayQueRecargar({ disco: "", sucio: false, conocido: "algo" }), true);
});

// ── Huella de una escena de Excalidraw ─────────────────────────────────────

test("la huella suma las versiones", () => {
  assert.equal(R.versionDeEscena([{ version: 3 }, { version: 5 }]), 8);
  assert.equal(R.versionDeEscena([]), 0);
});

test("un elemento sin versión cuenta como 1 (lo que hace `restore`)", () => {
  assert.equal(R.versionDeEscena([{}, { version: 2 }, null]), 4);
});

test("editar o borrar sube la huella", () => {
  const antes = [{ id: "a", version: 1 }, { id: "b", version: 4 }];
  const editado = [{ id: "a", version: 2 }, { id: "b", version: 4 }];
  const borrado = [{ id: "a", version: 1 }, { id: "b", version: 5, isDeleted: true }];
  assert.ok(R.versionDeEscena(editado) > R.versionDeEscena(antes));
  assert.ok(R.versionDeEscena(borrado) > R.versionDeEscena(antes));
});
