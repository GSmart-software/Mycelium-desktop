// Test headless (sin navegador ni Tauri) de la lógica de renombrar desde el
// título (`FUN-M-24`). El módulo bajo prueba (`lib/tituloEditable.ts`) es puro y
// sin imports, así que se transpila en el momento y se importa vía data: URL,
// igual que `scripts/test-bases.mjs`.
//
//   node --test scripts/test-titulo.mjs
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import ts from "typescript";

async function cargar(ruta, opcional = false) {
  let fuente;
  try {
    fuente = await readFile(fileURLToPath(new URL(ruta, import.meta.url)), "utf8");
  } catch (e) {
    if (opcional && e.code === "ENOENT") return null;
    throw e;
  }
  const { outputText } = ts.transpileModule(fuente, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 },
  });
  return import(`data:text/javascript,${encodeURIComponent(outputText)}`);
}

const { aplicarTitulo, motivoNombreInvalido } = await cargar("../lib/tituloEditable.ts");
// `lib/db/` es solo-desktop; en `web-cloud` el saneo vive en el backend .NET.
const nombres = await cargar("../lib/db/nombres.ts", true);
const soloDesktop = nombres === null ? { skip: "lib/db/nombres.ts es solo-desktop" } : {};

/** Un renombrado que anota si lo llamaron, para poder afirmar que NO se llamó. */
function espia(implementacion = async () => {}) {
  const llamadas = [];
  const fn = async (titulo) => {
    llamadas.push(titulo);
    return implementacion(titulo);
  };
  fn.llamadas = llamadas;
  return fn;
}

test("un nombre nuevo renombra", async () => {
  const renombrar = espia();
  const r = await aplicarTitulo("Viejo", "Nuevo", renombrar);
  assert.deepEqual(r, { estado: "renombrado", titulo: "Nuevo" });
  assert.deepEqual(renombrar.llamadas, ["Nuevo"]);
});

test("el mismo nombre NO toca el disco", async () => {
  const renombrar = espia();
  const r = await aplicarTitulo("Igual", "Igual", renombrar);
  assert.deepEqual(r, { estado: "sin-cambios" });
  assert.deepEqual(
    renombrar.llamadas,
    [],
    "renombrar reescribe los enlaces entrantes y recarga el arbol: no es gratis",
  );
});

test("los espacios de los bordes no cuentan como cambio", async () => {
  const renombrar = espia();
  assert.deepEqual(await aplicarTitulo("Igual", "  Igual  ", renombrar), { estado: "sin-cambios" });
  assert.deepEqual(renombrar.llamadas, []);
});

test("el nombre que SI cambia se manda recortado", async () => {
  const renombrar = espia();
  const r = await aplicarTitulo("Viejo", "  Nuevo  ", renombrar);
  assert.deepEqual(r, { estado: "renombrado", titulo: "Nuevo" });
  assert.deepEqual(renombrar.llamadas, ["Nuevo"]);
});

test("un nombre vacio se rechaza sin preguntar", async () => {
  const renombrar = espia();
  const r = await aplicarTitulo("Viejo", "   ", renombrar);
  assert.equal(r.estado, "error");
  assert.match(r.motivo, /vac/i);
  assert.deepEqual(renombrar.llamadas, [], "la respuesta seria la misma tras un viaje de ida y vuelta");
});

test("el motivo del error es el de quien renombra, no uno inventado", async () => {
  const renombrar = espia(async () => {
    throw new Error("Ya existe una nota o carpeta con ese nombre aquí.");
  });
  const r = await aplicarTitulo("Viejo", "Ocupado", renombrar);
  assert.deepEqual(r, {
    estado: "error",
    motivo: "Ya existe una nota o carpeta con ese nombre aquí.",
  });
});

test("un error sin mensaje no deja al usuario sin explicacion", async () => {
  const r = await aplicarTitulo("Viejo", "Otro", async () => {
    throw new Error("   ");
  });
  assert.equal(r.estado, "error");
  assert.equal(r.motivo, "No se pudo renombrar el archivo.");
});

test("algo que no es un Error tampoco rompe", async () => {
  const r = await aplicarTitulo("Viejo", "Otro", async () => {
    // eslint-disable-next-line no-throw-literal
    throw "vaya";
  });
  assert.equal(r.estado, "error");
  assert.equal(r.motivo, "No se pudo renombrar el archivo.");
});

// ── FUN-M-24: un nombre invalido se RECHAZA, no se corrige ───────────────────

test("los caracteres prohibidos se rechazan, y se dice cuales", async () => {
  const renombrar = espia();
  const r = await aplicarTitulo("Viejo", "Nota: la buena?", renombrar);
  assert.equal(r.estado, "error");
  assert.match(r.motivo, /:/);
  assert.match(r.motivo, /[?]/);
  assert.deepEqual(renombrar.llamadas, [], "`sanearNombre` los habria sustituido por `-`");
});

test("cada caracter prohibido se nombra UNA vez, aunque se repita", async () => {
  const motivo = motivoNombreInvalido("a?b?c?");
  assert.equal((motivo.match(/[?]/g) ?? []).length, 1);
});

test("un nombre que termina en punto se rechaza; uno en espacio se recorta", () => {
  // Windows recorta los dos en silencio, y entonces el nombre en disco dejaria
  // de coincidir con el del indice. Pero un espacio de sobra al final es un
  // resbalon al teclear, no una intencion: se recorta y ya. El punto SI puede
  // ser intencional, asi que se dice.
  assert.notEqual(motivoNombreInvalido("Notas."), null);
  assert.equal(motivoNombreInvalido("Notas "), null, "el espacio del borde se recorta antes");
  assert.equal(motivoNombreInvalido("Notas.md incompleto"), null, "solo molesta al FINAL");
});

test("los nombres reservados de Windows se rechazan", () => {
  for (const n of ["CON", "con", "PRN", "aux", "NUL", "com3", "LPT9"]) {
    assert.notEqual(motivoNombreInvalido(n), null, n);
  }
  assert.equal(motivoNombreInvalido("Console"), null, "empezar igual no basta");
  assert.equal(motivoNombreInvalido("con permiso"), null);
});

test("un nombre normal pasa, con acentos, guiones y puntos en medio", () => {
  for (const n of ["Rediseño del API", "notas-2026", "v1.2.0 del plan", "C# y .NET"]) {
    assert.equal(motivoNombreInvalido(n), null, n);
  }
});

test("LA GUARDA: rechazar y sanear miran los MISMOS caracteres", soloDesktop, () => {
  // Estan escritos en dos modulos que no se pueden importar entre si (los dos
  // son puros y `lib/db/` es solo-desktop). Esto es lo que impide que se
  // separen sin que nadie lo note.
  const candidatos = [...'\\/:*?"<>|', ..."-_. aA0áÑ#()[]{}!$%&+=~^`'"];
  for (const c of candidatos) {
    const rechazado = motivoNombreInvalido(`n${c}n`) !== null;
    const saneado = nombres.sanearNombre(`n${c}n`) !== `n${c}n`;
    assert.equal(
      rechazado,
      saneado,
      `«${c}»: uno lo toca y el otro no — las dos listas se separaron`,
    );
  }
});
