// Test headless del recorrido de lo que se suelta desde el explorador del SO
// (`lib/recorrerSoltados.ts`, FUN-S-26 / DEF-128). El módulo es puro, así que se
// transpila en el momento y se le pasan entradas falsas con la misma forma que
// `FileSystemEntry`: el lector de carpeta imita a Chromium y entrega como mucho
// 100 entradas por llamada a `readEntries`.
//
//   node --test scripts/test-soltar-archivos.mjs
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import ts from "typescript";

const rutaTs = fileURLToPath(new URL("../lib/recorrerSoltados.ts", import.meta.url));
const { outputText } = ts.transpileModule(await readFile(rutaTs, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 },
});
const { leerTodasLasEntradas, recorrerEntradas } = await import(
  `data:text/javascript,${encodeURIComponent(outputText)}`
);

/** Un archivo falso: `file()` entrega un objeto con su nombre (hace de `File`). */
function archivo(name) {
  return { name, isFile: true, isDirectory: false, file: (ok) => setTimeout(() => ok({ name })) };
}

/** Una carpeta falsa cuyo lector entrega de a `porLlamada` entradas, como Chromium. */
function carpeta(name, hijos, porLlamada = 100) {
  return {
    name,
    isFile: false,
    isDirectory: true,
    llamadas: 0,
    createReader() {
      let i = 0;
      const self = this;
      return {
        readEntries(ok) {
          self.llamadas++;
          const tanda = hijos.slice(i, i + porLlamada);
          i += tanda.length;
          setTimeout(() => ok(tanda));
        },
      };
    },
  };
}

const muchos = (n, prefijo = "f") => Array.from({ length: n }, (_, i) => archivo(`${prefijo}${i}.png`));

test("DEF-128: una carpeta con más de 100 elementos entra entera", async () => {
  const dir = carpeta("Fotos", muchos(250));
  const out = await recorrerEntradas([dir]);
  assert.equal(out.length, 250);
  assert.equal(out[0].path, "Fotos/f0.png");
  assert.equal(out[249].path, "Fotos/f249.png");
  // 100 + 100 + 50 + la llamada vacía que dice «no hay más».
  assert.equal(dir.llamadas, 4);
});

test("leerTodasLasEntradas repite hasta que vuelve vacío (exactamente 100 también)", async () => {
  const dir = carpeta("x", muchos(100));
  assert.equal((await leerTodasLasEntradas(dir.createReader())).length, 100);
  const vacia = carpeta("v", []);
  assert.deepEqual(await leerTodasLasEntradas(vacia.createReader()), []);
});

test("un lector que falla rechaza la promesa (no se queda colgado)", async () => {
  const lector = { readEntries: (_ok, error) => setTimeout(() => error(new Error("sin permiso"))) };
  await assert.rejects(leerTodasLasEntradas(lector), /sin permiso/);
});

test("cualquier tipo de archivo y subcarpetas anidadas, con su ruta relativa", async () => {
  const arbol = [
    archivo("manual.pdf"),
    carpeta("Proyecto", [
      archivo("plan.md"),
      archivo("datos.csv"),
      carpeta("Sub", [archivo("video.mp4"), ...muchos(120, "s")], 50),
    ]),
  ];
  const rutas = (await recorrerEntradas(arbol)).map((f) => f.path);
  assert.equal(rutas.length, 3 + 1 + 120);
  for (const r of ["manual.pdf", "Proyecto/plan.md", "Proyecto/datos.csv", "Proyecto/Sub/video.mp4", "Proyecto/Sub/s119.png"]) {
    assert.ok(rutas.includes(r), `falta ${r}`);
  }
});

test(".git y .obsidian (carpetas ocultas) quedan fuera; los archivos ocultos no", async () => {
  const arbol = [
    carpeta("Vault", [
      carpeta(".git", muchos(300)),
      carpeta(".obsidian", [archivo("app.json")]),
      archivo(".gitignore"),
      archivo("nota.md"),
    ]),
  ];
  const rutas = (await recorrerEntradas(arbol)).map((f) => f.path).sort();
  assert.deepEqual(rutas, ["Vault/.gitignore", "Vault/nota.md"]);
});
