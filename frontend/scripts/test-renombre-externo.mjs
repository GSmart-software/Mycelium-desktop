// Test headless de `lib/renombreExterno.ts` (`FUN-M-47`): cuándo un borrado y
// una creación de la misma ráfaga del watcher parecen un renombre hecho por
// fuera de Mycelium. Se transpila en el momento, como los demás.
//
//   node --test scripts/test-renombre-externo.mjs
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import ts from "typescript";

const aUrl = (codigo) => `data:text/javascript,${encodeURIComponent(codigo)}`;

async function fuente(ruta, mapa = {}) {
  const texto = await readFile(fileURLToPath(new URL(ruta, import.meta.url)), "utf8");
  let { outputText } = ts.transpileModule(texto, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 },
  });
  for (const [especificador, url] of Object.entries(mapa)) {
    outputText = outputText.split(`"${especificador}"`).join(`"${url}"`);
  }
  return aUrl(outputText);
}

const R = await import(
  await fuente("../lib/renombreExterno.ts", { "@/lib/frontmatter": await fuente("../lib/frontmatter.ts") })
);

const nota = (id, contenido) => ({ id, titulo: id.slice(id.lastIndexOf("/") + 1).replace(/\.[^.]+$/, ""), contenido });
const LARGA = "# Plan\n\nPrimera línea del plan.\nSegunda línea.\nTercera línea.\nCuarta línea.\nQuinta.\nSexta.\nSéptima.\nOctava.\nNovena.\nDécima.";

test("idéntica, o igual salvo el frontmatter y los finales de línea: similitud 1", () => {
  assert.equal(R.similitud("Hola", "Hola"), 1);
  assert.equal(R.similitud("---\naliases: [A]\n---\nHola\n", "Hola  \r\n"), 1);
  assert.equal(R.similitud(LARGA, `---\nfecha: 2026-11-01\n---\n${LARGA}`), 1);
});

test("vacías o solo con frontmatter: nunca", () => {
  assert.equal(R.similitud("", ""), 0);
  assert.equal(R.similitud("---\nx: 1\n---\n", "  \n"), 0);
});

test("similitud por líneas: alta cuenta, poca o con muy pocas líneas no", () => {
  const una = LARGA.replace("Quinta.", "Quinta, corregida.");
  assert.ok(R.similitud(LARGA, una) >= R.UMBRAL_SIMILITUD, String(R.similitud(LARGA, una)));
  const dos = una.replace("Sexta.", "Otra.");
  assert.ok(R.similitud(LARGA, dos) < R.UMBRAL_SIMILITUD);
  assert.equal(R.similitud("a\nb", "a\nc"), 0, "menos de MIN_LINEAS");
});

test("detectarRenombres: el par de la ráfaga, uno a uno y con la misma extensión", () => {
  const idas = [nota("Viejo.md", LARGA), nota("Borrada.md", "Algo que no volvió.")];
  const nuevas = [nota("Docs/Nuevo.md", LARGA), nota("Otra.md", "Algo distinto.")];
  const r = R.detectarRenombres(idas, nuevas);
  assert.equal(r.length, 1);
  assert.equal(r[0].de.id, "Viejo.md");
  assert.equal(r[0].a.id, "Docs/Nuevo.md");
  assert.equal(r[0].similitud, 1);
  // Otra extensión no empareja.
  assert.deepEqual(R.detectarRenombres([nota("Viejo.md", LARGA)], [nota("Viejo.canvas", LARGA)]), []);
  // Sin nada que se fue, o nada que llegó, nada.
  assert.deepEqual(R.detectarRenombres([], nuevas), []);
});

test("detectarRenombres: un empate no se adivina", () => {
  const r = R.detectarRenombres([nota("A.md", LARGA)], [nota("B.md", LARGA), nota("C.md", LARGA)]);
  assert.deepEqual(r, []);
  // Dos renombres a la vez, cada uno con su par.
  const otra = "Otra nota\ncon\nsus\nlíneas\npropias";
  const dos = R.detectarRenombres(
    [nota("A.md", LARGA), nota("X.md", otra)],
    [nota("Y.md", otra), nota("B.md", LARGA)],
  );
  assert.deepEqual(dos.map((p) => `${p.de.id}>${p.a.id}`).sort(), ["A.md>B.md", "X.md>Y.md"]);
});

test("textoOferta: dice cuántos enlaces y en cuántas notas", () => {
  assert.equal(
    R.textoOferta("Viejo", "Nuevo", 3, 2),
    "Parece que «Viejo» se renombró a «Nuevo» fuera de Mycelium. ¿Reparar 3 enlaces (en 2 notas) que apuntaban a «Viejo»?",
  );
  assert.match(R.textoOferta("A", "B", 1, 1), /1 enlace \(en 1 nota\)/);
});
