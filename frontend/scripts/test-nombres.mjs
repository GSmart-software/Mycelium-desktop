// Test headless (sin navegador ni Tauri) del saneo/desambiguación de nombres del
// "vault en carpeta" (fase 7). El módulo bajo prueba (`lib/db/nombres.ts`) es puro
// —sin imports—, así que se transpila en el momento con el compilador de
// TypeScript (devDep ya instalada) y se importa vía data: URL. No hace falta ni
// framework de test ni build previo.
//
//   node --test scripts/test-nombres.mjs
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import ts from "typescript";

const rutaTs = fileURLToPath(new URL("../lib/db/nombres.ts", import.meta.url));
const fuente = await readFile(rutaTs, "utf8");
const { outputText } = ts.transpileModule(fuente, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 },
});
const mod = await import(`data:text/javascript,${encodeURIComponent(outputText)}`);
const { sanearNombre, esReservadoWindows, desambiguar, crearCola, caracteresProhibidosEn, avisoCaracteresReemplazados } =
  mod;

test("reemplaza los caracteres prohibidos por guion", () => {
  assert.equal(sanearNombre('a/b\\c:d*e?f"g<h>i|j'), "a-b-c-d-e-f-g-h-i-j");
});

test("recorta espacios y puntos finales (Windows los recorta)", () => {
  assert.equal(sanearNombre("nota...  "), "nota");
  assert.equal(sanearNombre("  hola  "), "hola");
});

test("colapsa espacios repetidos", () => {
  assert.equal(sanearNombre("a    b"), "a b");
});

test("nombre vacío tras sanear usa el fallback", () => {
  assert.equal(sanearNombre("   "), "Sin título");
  assert.equal(sanearNombre("///"), "Sin título");
  assert.equal(sanearNombre("", "Sin nombre"), "Sin nombre");
  assert.equal(sanearNombre("...", "Sin nombre"), "Sin nombre");
});

test("nombres reservados de Windows reciben sufijo _", () => {
  assert.equal(sanearNombre("CON"), "CON_");
  assert.equal(sanearNombre("con"), "con_");
  assert.equal(sanearNombre("NUL"), "NUL_");
  assert.equal(sanearNombre("com1"), "com1_");
  assert.equal(sanearNombre("LPT9"), "LPT9_");
  // No reservados: se dejan igual.
  assert.equal(sanearNombre("COM0"), "COM0");
  assert.equal(sanearNombre("COM10"), "COM10");
  assert.equal(sanearNombre("console"), "console");
});

test("esReservadoWindows es case-insensitive y solo nombres exactos", () => {
  assert.equal(esReservadoWindows("con"), true);
  assert.equal(esReservadoWindows("  AUX "), true);
  assert.equal(esReservadoWindows("aux2"), false);
  assert.equal(esReservadoWindows("miconarchivo"), false);
});

test("desambiguar añade sufijo incremental estilo Obsidian", () => {
  const ocupados = new Set(["Nota", "Nota 1"]);
  assert.equal(desambiguar("Nota", (c) => ocupados.has(c)), "Nota 2");
  assert.equal(desambiguar("Libre", (c) => ocupados.has(c)), "Libre");
});

// ── DEF-136: elegir el nombre libre y ocuparlo es un solo paso ────────────────

/**
 * Réplica de `crearNota`: lee los ocupados, viaja a «disco» (un `await` real,
 * como el `invoke` de escribir el archivo) y recién después «inserta» —y la
 * inserción falla si el id ya existe, como la clave primaria del índice—.
 */
function crearConIndice(indice) {
  return async () => {
    const ocupados = new Set(indice);
    const nombre = desambiguar("Sin título", (c) => ocupados.has(c));
    await new Promise((r) => setTimeout(r, 1));
    if (indice.has(nombre)) throw "UNIQUE constraint failed: notas.id";
    indice.add(nombre);
    return nombre;
  };
}

test("sin cola, dos creaciones seguidas eligen el mismo nombre y una choca (la causa)", async () => {
  const indice = new Set(["Sin título"]);
  const crear = crearConIndice(indice);
  const r = await Promise.allSettled([crear(), crear()]);
  assert.equal(r.filter((x) => x.status === "rejected").length, 1);
});

test("con la cola, diez creaciones seguidas dan diez nombres distintos", async () => {
  const indice = new Set(["Sin título"]);
  const crear = crearConIndice(indice);
  const enCola = crearCola();
  const nombres = await Promise.all(Array.from({ length: 10 }, () => enCola(crear)));
  assert.equal(new Set(nombres).size, 10);
  assert.deepEqual(nombres, Array.from({ length: 10 }, (_, i) => `Sin título ${i + 1}`));
});

test("la cola respeta el orden y sigue después de una tarea que falla", async () => {
  const enCola = crearCola();
  const orden = [];
  const a = enCola(async () => {
    await new Promise((r) => setTimeout(r, 5));
    orden.push("a");
    return "a";
  });
  const b = enCola(async () => {
    orden.push("b");
    throw new Error("falla b");
  });
  const c = enCola(async () => {
    orden.push("c");
    return "c";
  });
  assert.equal(await a, "a");
  await assert.rejects(b, /falla b/);
  assert.equal(await c, "c");
  assert.deepEqual(orden, ["a", "b", "c"]);
});

// DEF-150 m: el saneo ya no es silencioso; estas dos funciones arman el aviso.
test("caracteresProhibidosEn lista los prohibidos sin repetir y en orden", () => {
  assert.deepEqual(caracteresProhibidosEn("¿Qué es? Nota: a/b: c?"), ["?", ":", "/"]);
  assert.deepEqual(caracteresProhibidosEn("Nota normal"), []);
  assert.deepEqual(caracteresProhibidosEn('a\\b*c"d<e>f|g'), ["\\", "*", '"', "<", ">", "|"]);
});

test("avisoCaracteresReemplazados: null sin prohibidos, texto con ellos", () => {
  assert.equal(avisoCaracteresReemplazados("Nota normal", "Nota normal"), null);
  const aviso = avisoCaracteresReemplazados("Hora: 10?", sanearNombre("Hora: 10?"));
  assert.equal(
    aviso,
    "Se reemplazaron caracteres no permitidos en un nombre de archivo («:» «?») por «-»: quedó «Hora- 10-».",
  );
  assert.match(avisoCaracteresReemplazados("a:b"), /\(«:»\) por «-»\.$/);
});
