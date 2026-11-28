// Test headless de lo que se escribe al soltar archivos en la consola
// (`FUN-S-43`, `lib/rutasSoltadas.ts`): como Windows Terminal, cada ruta entre
// comillas dobles si la shell la partiría o la interpretaría, separadas por un
// espacio y con uno al final. Nunca un Enter: soltar no ejecuta nada.
//
//   node --test scripts/test-rutas-soltadas.mjs
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import ts from "typescript";

const rutaTs = fileURLToPath(new URL("../lib/rutasSoltadas.ts", import.meta.url));
const { outputText } = ts.transpileModule(await readFile(rutaTs, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
});
const { citarRuta, esRutaWindows, rutaAbsolutaEnVault, textoDeRutas } = await import(
  `data:text/javascript,${encodeURIComponent(outputText)}`
);

test("una ruta sin nada especial va tal cual", () => {
  assert.equal(citarRuta("C:\\Users\\ana\\captura.png"), "C:\\Users\\ana\\captura.png");
  assert.equal(citarRuta("/home/ana/captura.png"), "/home/ana/captura.png");
  assert.equal(citarRuta("C:\\Fotos\\canción_ñandú.png"), "C:\\Fotos\\canción_ñandú.png", "las tildes no se citan");
});

test("con espacios va entre comillas dobles", () => {
  assert.equal(citarRuta("C:\\Mis imágenes\\a b.png"), '"C:\\Mis imágenes\\a b.png"');
  assert.equal(citarRuta("C:\\x\\tab\tdentro"), '"C:\\x\\tab\tdentro"');
});

test("con caracteres que interpreta alguna shell va entre comillas", () => {
  for (const c of ["&", "(", ")", ";", ",", "'", "$", "@", "#", "%", "^", "!", "[", "]", "{", "}", "`", "=", "+", "~"]) {
    const ruta = `C:\\carpeta\\a${c}b.txt`;
    assert.equal(citarRuta(ruta), `"${ruta}"`, `con ${c}`);
  }
});

test("en Windows las comillas no se escapan (una ruta no puede tenerlas)", () => {
  assert.equal(citarRuta("C:\\a$b\\c.txt"), '"C:\\a$b\\c.txt"');
  assert.equal(citarRuta("\\\\servidor\\recurso compartido\\x"), '"\\\\servidor\\recurso compartido\\x"');
});

test("en POSIX se escapa lo que bash expande dentro de comillas dobles", () => {
  assert.equal(citarRuta("/tmp/a b/$HOME"), '"/tmp/a b/\\$HOME"');
  assert.equal(citarRuta('/tmp/di"jo'), '"/tmp/di\\"jo"');
  assert.equal(citarRuta("/tmp/a`b"), '"/tmp/a\\`b"');
});

test("varias rutas: separadas por un espacio y con uno al final, sin Enter", () => {
  const texto = textoDeRutas(["C:\\a.png", "C:\\Mis fotos\\b.png"]);
  assert.equal(texto, 'C:\\a.png "C:\\Mis fotos\\b.png" ');
  assert.ok(!/[\r\n]/.test(texto), "nunca un salto de línea");
});

test("una ruta sola también lleva el espacio final; sin rutas, nada", () => {
  assert.equal(textoDeRutas(["C:\\a.png"]), "C:\\a.png ");
  assert.equal(textoDeRutas([]), "");
  assert.equal(textoDeRutas(["", ""]), "", "las vacías no cuentan");
});

test("reconoce las rutas de Windows", () => {
  assert.equal(esRutaWindows("C:\\x"), true);
  assert.equal(esRutaWindows("d:/x"), true);
  assert.equal(esRutaWindows("\\\\srv\\x"), true);
  assert.equal(esRutaWindows("/home/x"), false);
  assert.equal(esRutaWindows("relativa\\x"), false);
});

test("arma la ruta absoluta de algo del vault con el separador de la raíz", () => {
  assert.equal(rutaAbsolutaEnVault("C:\\Vaults\\Mi vault", "Notas/idea.md"), "C:\\Vaults\\Mi vault\\Notas\\idea.md");
  assert.equal(rutaAbsolutaEnVault("C:\\Vaults\\Mi vault\\", "img/a.png"), "C:\\Vaults\\Mi vault\\img\\a.png", "sin doble separador");
  assert.equal(rutaAbsolutaEnVault("C:\\", "a.md"), "C:\\a.md", "la raíz del disco");
  assert.equal(rutaAbsolutaEnVault("/home/ana/vault", "Notas/idea.md"), "/home/ana/vault/Notas/idea.md");
  assert.equal(rutaAbsolutaEnVault("/home/ana/vault/", "x.md"), "/home/ana/vault/x.md");
  assert.equal(rutaAbsolutaEnVault("C:\\Vaults\\v", "Proyectos"), "C:\\Vaults\\v\\Proyectos", "una carpeta");
  assert.equal(rutaAbsolutaEnVault("C:\\Vaults\\v", ""), "C:\\Vaults\\v", "la raíz del vault");
});

test("no arma nada sin raíz, ni para salir del vault", () => {
  assert.equal(rutaAbsolutaEnVault(null, "a.md"), null);
  assert.equal(rutaAbsolutaEnVault("", "a.md"), null);
  assert.equal(rutaAbsolutaEnVault("C:\\v", null), null);
  assert.equal(rutaAbsolutaEnVault("C:\\v", "../fuera.txt"), null);
  assert.equal(rutaAbsolutaEnVault("C:\\v", "a/../../b"), null);
});
