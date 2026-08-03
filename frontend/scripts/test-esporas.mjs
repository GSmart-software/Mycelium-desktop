// Test headless (sin navegador ni Tauri) de la sustitución de variables de las
// Esporas (`FUN-M-03`). El módulo bajo prueba (`lib/esporas.ts`) es puro —sin
// imports—, así que se transpila en el momento con el compilador de TypeScript
// (devDep ya instalada) y se importa vía data: URL, igual que
// `scripts/test-frontmatter.mjs`. No hace falta framework de test ni build previo.
//
//   node --test scripts/test-esporas.mjs
//   node scripts/test-esporas.mjs
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import ts from "typescript";

const rutaTs = fileURLToPath(new URL("../lib/esporas.ts", import.meta.url));
const fuente = await readFile(rutaTs, "utf8");
const { outputText } = ts.transpileModule(fuente, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 },
});
const mod = await import(`data:text/javascript,${encodeURIComponent(outputText)}`);
const {
  CARPETA_ESPORAS_DEFECTO,
  fechaIso,
  formatearFecha,
  horaIso,
  normalizarCarpetaEsporas,
  sustituirVariables,
} = mod;

/** Momento fijo (hora LOCAL) para que los tests no dependan del reloj. */
const AHORA = new Date(2026, 7, 2, 15, 4, 9); // 2 de agosto de 2026, 15:04:09
const ctx = (titulo = "Reunión 2") => ({ titulo, ahora: AHORA });

// ── Cada token ────────────────────────────────────────────────────────────────

test("{{titulo}} se sustituye por el título de la nota destino", () => {
  assert.equal(sustituirVariables("# {{titulo}}", ctx()), "# Reunión 2");
});

test("{{fecha}} y {{hora}} usan la hora local, no UTC", () => {
  assert.equal(fechaIso(AHORA), "2026-08-02");
  assert.equal(horaIso(AHORA), "15:04");
  assert.equal(
    sustituirVariables("Fecha: {{fecha}} · Hora: {{hora}}", ctx()),
    "Fecha: 2026-08-02 · Hora: 15:04",
  );
});

test("varias apariciones del mismo token se sustituyen todas", () => {
  assert.equal(sustituirVariables("{{titulo}} / {{titulo}}", ctx("Nota")), "Nota / Nota");
});

test("los espacios dentro del token se toleran", () => {
  assert.equal(sustituirVariables("{{ titulo }}", ctx("Nota")), "Nota");
});

// ── Formato propio ────────────────────────────────────────────────────────────

test("{{fecha:DD/MM/AAAA}} produce la fecha con ese formato", () => {
  assert.equal(sustituirVariables("{{fecha:DD/MM/AAAA}}", ctx()), "02/08/2026");
});

test("MM es el mes y mm el minuto (el formato distingue mayúsculas)", () => {
  assert.equal(sustituirVariables("{{fecha:AAAA-MM-DD hh:mm}}", ctx()), "2026-08-02 15:04");
  assert.equal(formatearFecha("hh:mm:ss", AHORA), "15:04:09");
});

test("lo que no es token de formato se copia literal", () => {
  assert.equal(formatearFecha("Semana del DD de mes", AHORA), "Semana del 02 de mes");
  assert.equal(formatearFecha("", AHORA), "");
});

// ── Tokens desconocidos y llaves sueltas ──────────────────────────────────────

test("un token desconocido llega escrito tal cual", () => {
  assert.equal(sustituirVariables("Autor: {{autor}}", ctx()), "Autor: {{autor}}");
  // `Titulo` con mayúscula NO es el token: los tokens van en minúscula.
  assert.equal(sustituirVariables("{{Titulo}}", ctx()), "{{Titulo}}");
  assert.equal(sustituirVariables("{{}}", ctx()), "{{}}");
});

test("las llaves que no forman un token quedan intactas", () => {
  const texto = "{ {titulo} } y {{titulo sin cerrar y ${var} y {x: 1}";
  assert.equal(sustituirVariables(texto, ctx()), texto);
});

test("un token sin plantilla no rompe: texto sin llaves pasa igual", () => {
  assert.equal(sustituirVariables("Texto normal.", ctx()), "Texto normal.");
});

// ── Sustitución dentro del frontmatter ────────────────────────────────────────

test("la sustitución también aplica dentro del frontmatter", () => {
  const plantilla = [
    "---",
    "fecha: {{fecha}}",
    "titulo: {{titulo}}",
    "tags: [reunion]",
    "---",
    "",
    "# {{titulo}}",
    "",
    "Creada el {{fecha:DD/MM/AAAA}} a las {{hora}}.",
  ].join("\n");

  assert.equal(
    sustituirVariables(plantilla, ctx("Reunión")),
    [
      "---",
      "fecha: 2026-08-02",
      "titulo: Reunión",
      "tags: [reunion]",
      "---",
      "",
      "# Reunión",
      "",
      "Creada el 02/08/2026 a las 15:04.",
    ].join("\n"),
  );
});

test("un archivo con CRLF conserva sus fines de línea", () => {
  const plantilla = "---\r\nfecha: {{fecha}}\r\n---\r\n\r\n# {{titulo}}\r\n";
  assert.equal(
    sustituirVariables(plantilla, ctx("Nota")),
    "---\r\nfecha: 2026-08-02\r\n---\r\n\r\n# Nota\r\n",
  );
});

// ── Carpeta configurada ───────────────────────────────────────────────────────

test("la carpeta por defecto es Esporas", () => {
  assert.equal(CARPETA_ESPORAS_DEFECTO, "Esporas");
});

test("se normalizan separadores, espacios y barras sobrantes", () => {
  assert.equal(normalizarCarpetaEsporas("Esporas"), "Esporas");
  assert.equal(normalizarCarpetaEsporas("  Esporas  "), "Esporas");
  assert.equal(normalizarCarpetaEsporas("Plantillas\\Esporas"), "Plantillas/Esporas");
  assert.equal(normalizarCarpetaEsporas("/Plantillas//Esporas/"), null); // absoluta
  assert.equal(normalizarCarpetaEsporas("Plantillas//Esporas/"), "Plantillas/Esporas");
});

test("se rechazan rutas absolutas y saltos hacia arriba", () => {
  assert.equal(normalizarCarpetaEsporas(""), null);
  assert.equal(normalizarCarpetaEsporas("   "), null);
  assert.equal(normalizarCarpetaEsporas("/etc/plantillas"), null);
  assert.equal(normalizarCarpetaEsporas("C:\\Users\\yo\\Esporas"), null);
  assert.equal(normalizarCarpetaEsporas("../fuera"), null);
  assert.equal(normalizarCarpetaEsporas("Esporas/../../fuera"), null);
  assert.equal(normalizarCarpetaEsporas("./Esporas"), null);
});
