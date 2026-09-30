// Tests del validador/expansor de Esporas de la skill `mycelium-esporas`
// (`FUN-L-26`), de las plantillas de fixtures y de que lo que el borrador de
// la skill afirma (tabla de formatos, plantilla de ejemplo) sea cierto contra
// `lib/esporas.ts`.
//
//   node --test scripts/test-validar-espora.mjs
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { carpetaEsporasDe, expandir, validarEspora } from "./validar-espora.mjs";

const DIR = fileURLToPath(new URL("./fixtures/ia/esporas/", import.meta.url));
const VAULT = `${DIR}vault`;
const SKILL = await readFile(fileURLToPath(new URL("../lib/ia/borradores/mycelium-esporas.md", import.meta.url)), "utf8");
const AHORA = new Date(2026, 8, 30, 14, 5, 9);
const codigos = (l) => [...new Set(l.map((x) => x.codigo))].sort();

test("sin preferencias, la carpeta de Esporas es `Esporas`", async () => {
  assert.equal(await carpetaEsporasDe(VAULT), "Esporas");
});

for (const nombre of (await readdir(`${VAULT}/Esporas`)).filter((n) => n.endsWith(".md"))) {
  test(`la Espora de fixtures «${nombre}» no tiene errores y crea propiedades`, async () => {
    const texto = await readFile(`${VAULT}/Esporas/${nombre}`, "utf8");
    const r = validarEspora(texto, { rutaEnVault: `Esporas/${nombre}` });
    assert.deepEqual(r.errores, []);
    assert.ok(r.propiedades.length > 0);
    const fecha = r.propiedades.find((p) => p.tipo === "fecha");
    assert.ok(fecha, "toda receta siembra al menos una propiedad de tipo fecha");
    assert.equal(fecha.valor, "2026-09-30");
  });
}

test("una plantilla en una subcarpeta no aparece", async () => {
  const texto = await readFile(`${VAULT}/Esporas/Viejas/Acta.md`, "utf8");
  const r = validarEspora(texto, { rutaEnVault: "Esporas/Viejas/Acta.md" });
  assert.deepEqual(codigos(r.errores), ["ubicacion"]);
});

test("sintaxis de Obsidian/Templater: todo marcado", async () => {
  const r = validarEspora(await readFile(`${DIR}malas/Obsidian.md`, "utf8"));
  assert.deepEqual(codigos(r.errores), ["formato", "frontmatter", "templater", "token-desconocido"]);
  assert.ok(codigos(r.avisos).includes("fecha-texto"));
  assert.ok(codigos(r.avisos).includes("formato"), "hh:MM");
});

test("expandir: lo mismo que la app, frontmatter incluido", async () => {
  const texto = await readFile(`${VAULT}/Esporas/Reunión.md`, "utf8");
  const out = expandir(texto, "Reunión con proveedores", AHORA);
  assert.match(out, /^fecha: 2026-09-30$/m);
  assert.match(out, /^hora: "14:05"$/m);
  assert.match(out, /^# Reunión con proveedores$/m);
  assert.match(out, /Reunión del 30\/09\/2026 a las 14:05/);
  assert.doesNotMatch(out, /\{\{/);
});

test("un token desconocido queda tal cual", () => {
  assert.equal(expandir("Autor: {{autor}} · {{ titulo }}", "X", AHORA), "Autor: {{autor}} · X");
});

// ── Lo que afirma el borrador de la skill ───────────────────────────────────

test("la tabla de formatos del borrador es exacta", () => {
  const filas = [...SKILL.matchAll(/^\| `(\{\{fecha:[^`]+\}\})` \| `([^`]+)`/gm)];
  assert.ok(filas.length >= 5);
  for (const [, token, esperado] of filas) {
    assert.equal(expandir(token, "", AHORA), esperado, token);
  }
});

test("la tabla de variables del borrador es exacta", () => {
  assert.equal(expandir("{{fecha}}", "", AHORA), "2026-09-30");
  assert.equal(expandir("{{hora}}", "", AHORA), "14:05");
  assert.match(SKILL, /`\{\{fecha\}\}` \| Fecha de hoy.*`2026-09-30`/);
  assert.match(SKILL, /`\{\{hora\}\}` \| Hora actual.*`14:05`/);
});

test("la Espora de ejemplo del borrador valida limpia", () => {
  const ejemplo = /## Cómo escribir una buena Espora\n\n```md\n([\s\S]*?)```/.exec(SKILL)[1];
  const r = validarEspora(ejemplo, { rutaEnVault: "Esporas/Reunión.md" });
  assert.deepEqual(r.errores, []);
  assert.deepEqual(codigos(r.avisos), ["plantilla-cruda"]);
  assert.equal(r.propiedades.find((p) => p.clave === "fecha").tipo, "fecha");
});

test("la fecha y hora con T sale como propiedad fechaHora", () => {
  const r = validarEspora("---\ninicio: {{fecha:AAAA-MM-DDThh:mm}}\n---\n");
  assert.deepEqual(r.errores, []);
  assert.equal(r.propiedades[0].tipo, "fechaHora");
});
