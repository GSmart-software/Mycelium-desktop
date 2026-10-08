// Test headless del conflicto entre lo que se escribe en una nota y un cambio
// hecho al archivo por fuera de Mycelium (`DEF-138`).
//
// `lib/conflictoExterno.ts` es puro —sin imports—, así que se transpila en el
// momento y se importa vía data: URL, igual que el resto de los núcleos.
//
//   node --test scripts/test-conflicto-externo.mjs
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import ts from "typescript";

const rutaTs = fileURLToPath(new URL("../lib/conflictoExterno.ts", import.meta.url));
const { outputText } = ts.transpileModule(await readFile(rutaTs, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
});
const C = await import(`data:text/javascript,${encodeURIComponent(outputText)}`);

// ── Aviso del watcher / volver a la pestaña ────────────────────────────────

const ante = (disco, conocido, local, sucio) =>
  C.decidirAnteCambioExterno({ disco, conocido, local, sucio });

test("el caso del defecto: cambios propios + cambio de afuera = conflicto, no se pisa", () => {
  // Base «A»; el usuario escribió « EDIT-LOCAL»; afuera agregaron «OTRA-EXTERNA».
  assert.equal(ante("A\nOTRA-EXTERNA", "A", "A EDIT-LOCAL", true), "conflicto");
});

test("sin cambios propios, lo de afuera se recarga (como antes)", () => {
  assert.equal(ante("B", "A", "A", false), "recargar");
});

test("el eco del propio guardado no es un cambio de afuera", () => {
  assert.equal(ante("A", "A", "A y más", true), "nada");
  assert.equal(ante("A", "A", "A", false), "nada");
});

test("si afuera quedó lo mismo que se ve, no hay conflicto", () => {
  assert.equal(ante("igual", "A", "igual", true), "alcanzado");
  assert.equal(ante("igual", "A", "igual", false), "alcanzado");
});

test("un archivo que desapareció no se decide acá", () => {
  assert.equal(ante(null, "A", "A x", true), "nada");
  assert.equal(ante(null, "A", "A", false), "nada");
});

test("el espejo de otro panel tiene cambios aunque no esté marcado sucio", () => {
  // Lo escrito en el otro panel llegó por el espejo: local ≠ base.
  assert.equal(ante("B", "A", "A + lo del otro panel", false), "conflicto");
});

test("sin base conocida y sin marca de sucio, se recarga", () => {
  assert.equal(ante("B", null, "", false), "recargar");
  assert.equal(ante("B", null, "algo", true), "conflicto");
});

// ── Antes de escribir ──────────────────────────────────────────────────────

const alGuardar = (disco, conocido, local) => C.decidirAlGuardar({ disco, conocido, local });

test("la carrera del defecto: el disco cambió antes del aviso → no se escribe", () => {
  assert.equal(alGuardar("A\nOTRA-EXTERNA", "A", "A EDIT-LOCAL"), "conflicto");
});

test("nadie tocó el archivo: se escribe", () => {
  assert.equal(alGuardar("A", "A", "A EDIT-LOCAL"), "escribir");
});

test("el disco ya tiene lo que se iba a escribir", () => {
  assert.equal(alGuardar("A EDIT", "A", "A EDIT"), "ya-esta");
});

test("sin base o sin archivo, se escribe como siempre", () => {
  assert.equal(alGuardar("X", null, "Y"), "escribir");
  assert.equal(alGuardar(null, "A", "Y"), "escribir");
});

// ── Nombres de la copia ────────────────────────────────────────────────────

test("título de la copia local", () => {
  assert.equal(C.tituloDeCopiaLocal("Receta"), "Receta (copia local)");
  assert.equal(C.tituloDeCopiaLocal("  Receta "), "Receta (copia local)");
  assert.equal(C.tituloDeCopiaLocal(""), "Sin título (copia local)");
});

test("una copia de una copia no apila el sufijo", () => {
  assert.equal(C.tituloDeCopiaLocal("Receta (copia local)"), "Receta (copia local)");
});

test("ruta de la copia de emergencia: misma carpeta, fecha y hora", () => {
  const ahora = new Date(2026, 9, 7, 14, 5, 9);
  assert.equal(
    C.rutaDeCopiaDeEmergencia("Cocina/Receta.md", ahora),
    "Cocina/Receta (copia local 2026-10-07 140509).md",
  );
  assert.equal(C.rutaDeCopiaDeEmergencia("Receta.md", ahora), "Receta (copia local 2026-10-07 140509).md");
});
