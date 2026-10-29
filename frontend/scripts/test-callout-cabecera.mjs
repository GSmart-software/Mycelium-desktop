// Test headless de la cabecera de callout del editor (`DEF-171`): las dos
// expresiones de `lib/editor/calloutCabecera.ts` capturan lo mismo que las de
// antes y no se cuelgan con una línea de muchos `>` que no es un callout.
//
// Por qué importa: el editor las corre sobre cada línea que empieza con `>`. Con
// `(?:\s*>\s*)+`, 14 niveles separados por espacios tardaban unos 4 s y 18,
// minutos: una nota de un vault ajeno congelaba la app.
//
//   node --test scripts/test-callout-cabecera.mjs
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { after, test } from "node:test";
import ts from "typescript";

const AQUI = dirname(fileURLToPath(import.meta.url));
const FUENTE = join(AQUI, "..", "lib", "editor", "calloutCabecera.ts");

// Sin imports: alcanza con transpilarlo a una carpeta temporal cualquiera.
const TMP = await mkdtemp(join(tmpdir(), "test-callout-cabecera-"));
after(() => rm(TMP, { recursive: true, force: true }));
const js = ts.transpileModule(await readFile(FUENTE, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
await writeFile(join(TMP, "calloutCabecera.mjs"), js);
const { CALLOUT_HEAD_RE, CALLOUT_PLIEGUE_RE } = await import(pathToFileURL(join(TMP, "calloutCabecera.mjs")).href);

// Las de antes de DEF-171: la referencia de qué hay que capturar.
const CABECERA_VIEJA = /^((?:\s*>\s*)+)\[!([\w-]+)\]([-+]?)/;
const PLIEGUE_VIEJO = /^((?:\s*>\s*)+\[!\w+\])([-+])/;

const LINEAS = [
  "> [!note] Título",
  "> > [!tip]- plegado",
  "  >  >  [!warning]+",
  ">[!info]",
  ">>[!x]-",
  "\t> \t>[!a-b]+ texto",
  "> > > [!note]-",
  "> texto común",
  "  [!note] sin marcador",
  "",
];

test("capturan exactamente lo mismo que las expresiones anteriores", () => {
  for (const linea of LINEAS) {
    assert.deepEqual(CALLOUT_HEAD_RE.exec(linea), CABECERA_VIEJA.exec(linea), JSON.stringify(linea));
    assert.deepEqual(CALLOUT_PLIEGUE_RE.exec(linea), PLIEGUE_VIEJO.exec(linea), JSON.stringify(linea));
  }
});

test("la profundidad sale de contar los `>` del grupo 1", () => {
  const m = CALLOUT_HEAD_RE.exec("> >  > [!note]-");
  assert.ok(m);
  assert.equal((m[1].match(/>/g) ?? []).length, 3);
  assert.equal(m[2], "note");
  assert.equal(m[3], "-");
});

test("una línea de miles de `>` con espacios, sin cabecera, se resuelve al instante", () => {
  for (const niveles of [14, 18, 5000]) {
    const linea = ">   ".repeat(niveles) + "x";
    const inicio = performance.now();
    assert.equal(CALLOUT_HEAD_RE.test(linea), false);
    assert.equal(CALLOUT_PLIEGUE_RE.test(linea), false);
    // Con la expresión vieja, 14 niveles ya pasaban de 4000 ms.
    assert.ok(performance.now() - inicio < 100, `${niveles} niveles`);
  }
});
