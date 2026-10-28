// Test headless del texto de lo que la importación dejó fuera
// (`lib/resumenImportacion.ts`, DEF-165). El módulo es puro: se transpila en el
// momento.
//
//   node --test scripts/test-resumen-importacion.mjs
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import ts from "typescript";

const rutaTs = fileURLToPath(new URL("../lib/resumenImportacion.ts", import.meta.url));
const { outputText } = ts.transpileModule(await readFile(rutaTs, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 },
});
const { textoExcluidos } = await import(`data:text/javascript,${encodeURIComponent(outputText)}`);

test("sin nada excluido no hay texto", () => {
  assert.equal(textoExcluidos([]), null);
});

test("las carpetas se nombran una vez y los archivos ocultos se cuentan", () => {
  assert.equal(
    textoExcluidos([".claude/", "a/.git/", ".git/", ".mcp.json", ".env", "x/.env"]),
    ".claude/, .git/ y 3 archivos ocultos",
  );
});

test("pocos archivos ocultos se nombran", () => {
  assert.equal(textoExcluidos([".mcp.json"]), ".mcp.json");
  assert.equal(textoExcluidos([".claude/", ".mcp.json", "Notas/.env"]), ".claude/, .mcp.json y .env");
  assert.equal(textoExcluidos(["node_modules/", "Proy/target/"]), "node_modules/ y target/");
});
