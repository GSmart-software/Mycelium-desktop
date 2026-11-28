// Si las instrucciones de IA del vault son más viejas que las de la app
// (`FUN-S-45`, `lib/ia/instruccionesInstaladas.ts`): la función pura que decide
// el aviso de «Actividad de la IA», la marca del rail y la línea de
// `mycelium_estado`. Comparación de versiones, sin instrucciones, al día,
// mezcladas y más nuevas.
//
//   node --test scripts/test-instrucciones-instaladas.mjs
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import ts from "typescript";

const ruta = fileURLToPath(new URL("../lib/ia/instruccionesInstaladas.ts", import.meta.url));
const { outputText } = ts.transpileModule(await readFile(ruta, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
});
const {
  compararVersiones,
  estadoInstrucciones,
  instruccionesParaIa,
  versionDeClaudeMd,
  versionDeMarca,
  versionDelJson,
} = await import(`data:text/javascript,${encodeURIComponent(outputText)}`);

const json = (v) => JSON.stringify({ version: v, generado: "2026-11-01T00:00:00.000Z" }, null, 2) + "\n";
const bloque = (v) =>
  `<!-- mycelium:inicio v${v} — lo escribe Mycelium (Configuración → Vault); lo tuyo, fuera del bloque -->\n` +
  "# Este vault es tu memoria\n<!-- mycelium:fin -->\n";
const skill = (v) => `---\nname: mycelium-vault\ndescription: x\n---\n<!-- mycelium-ia v${v} -->\n# Referencia\n`;
const nada = { json: null, claudeMd: null, marcas: [null, null, null] };

test("compara versiones por número, no por texto", () => {
  assert.ok(compararVersiones("2.5.0", "2.6.0") < 0);
  assert.ok(compararVersiones("2.10.0", "2.9.0") > 0, "10 > 9 aunque «1» < «9»");
  assert.ok(compararVersiones("1.8.1", "2.0.0") < 0);
  assert.equal(compararVersiones("2.6.0", "2.6.0"), 0);
  assert.equal(compararVersiones("v2.6.0", "2.6.0"), 0);
});

test("sin instrucciones no hay aviso: se crean solo si el usuario las pide", () => {
  const e = estadoInstrucciones(nada, "2.6.0");
  assert.deepEqual(e, { instalada: null, disponible: "2.6.0", situacion: "sin-instrucciones", mezcladas: false });
  assert.equal(instruccionesParaIa(e), null);
  // Un CLAUDE.md del usuario que solo CITA los marcadores no es una instalación.
  const citado = "Mycelium escribe entre `<!-- mycelium:inicio … -->` y `<!-- mycelium:fin -->`.\n" +
    "La marca es `<!-- mycelium-ia v2.0.0 -->`.\n";
  assert.equal(estadoInstrucciones({ ...nada, claudeMd: citado }, "2.6.0").situacion, "sin-instrucciones");
});

test("al día y desactualizadas", () => {
  const todas = (v) => ({ json: json(v), claudeMd: bloque(v), marcas: [skill(v), skill(v), skill(v)] });
  assert.equal(estadoInstrucciones(todas("2.6.0"), "2.6.0").situacion, "al-dia");
  const e = estadoInstrucciones(todas("2.5.0"), "2.6.0");
  assert.deepEqual(e, { instalada: "2.5.0", disponible: "2.6.0", situacion: "desactualizadas", mezcladas: false });
  assert.deepEqual(instruccionesParaIa(e), {
    instalada: "2.5.0",
    disponible: "2.6.0",
    desactualizadas: true,
    mas_nuevas: false,
  });
});

test("más nuevas que la app: sin aviso de actualizar, solo informativo", () => {
  const e = estadoInstrucciones({ json: json("2.7.0"), claudeMd: bloque("2.7.0"), marcas: [] }, "2.6.0");
  assert.equal(e.situacion, "mas-nuevas");
  assert.deepEqual(instruccionesParaIa(e), {
    instalada: "2.7.0",
    disponible: "2.6.0",
    desactualizadas: false,
    mas_nuevas: true,
  });
});

test("versiones mezcladas: vale la más vieja", () => {
  // El JSON dice 2.6.0 pero una skill quedó en la 2.4.0 (una regeneración a medias).
  const e = estadoInstrucciones(
    { json: json("2.6.0"), claudeMd: bloque("2.6.0"), marcas: [skill("2.6.0"), skill("2.4.0"), null] },
    "2.6.0",
  );
  assert.deepEqual(e, { instalada: "2.4.0", disponible: "2.6.0", situacion: "desactualizadas", mezcladas: true });
  // Sin el JSON (lo escribe último: si falló, falta), lo demás alcanza.
  const sinJson = estadoInstrucciones({ json: null, claudeMd: bloque("2.5.0"), marcas: [skill("2.6.0")] }, "2.6.0");
  assert.equal(sinJson.instalada, "2.5.0");
  assert.equal(sinJson.situacion, "desactualizadas");
});

test("CLAUDE.md: el bloque manda; la marca vieja solo cuenta sin bloque", () => {
  // Tras `insertado-sobre-anterior`: el bloque nuevo arriba y debajo las
  // instrucciones 1.x que el usuario editó. Eso no es una versión instalada.
  const conViejas = bloque("2.6.0") + "\n<!-- mycelium-ia v1.7.0 -->\n# Este vault es tu memoria\n";
  assert.equal(versionDeClaudeMd(conViejas), "2.6.0");
  assert.equal(versionDeClaudeMd("<!-- mycelium-ia v1.7.0 -->\n# Este vault es tu memoria\n"), "1.7.0");
  assert.equal(versionDeClaudeMd("﻿" + bloque("2.1.0").replace(/\n/g, "\r\n")), "2.1.0", "con BOM y CRLF");
  assert.equal(versionDeMarca("<!-- mycelium-ia v2.3.0 -->\r\n# x"), "2.3.0");
});

test("un JSON roto o sin versión no cuenta", () => {
  assert.equal(versionDelJson("{no es json"), null);
  assert.equal(versionDelJson('{"generado":"x"}'), null);
  assert.equal(versionDelJson('{"version":"dos"}'), null);
  assert.equal(versionDelJson(json("2.5.0")), "2.5.0");
});
