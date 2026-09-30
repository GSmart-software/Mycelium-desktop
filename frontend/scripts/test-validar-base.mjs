// Tests del validador de `.base` de la skill `mycelium-base` (`FUN-L-26`)
// contra el mini vault de `fixtures/ia/base/`.
//
//   node --test scripts/test-validar-base.mjs
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { contextoDeVault, validarBase } from "./validar-base.mjs";

const DIR = fileURLToPath(new URL("./fixtures/ia/base/", import.meta.url));
const VAULT = `${DIR}vault`;
const ctx = await contextoDeVault(VAULT);

async function validar(ruta) {
  return validarBase(await readFile(`${DIR}${ruta}`, "utf8"), ctx);
}
const codigos = (lista) => [...new Set(lista.map((x) => x.codigo))].sort();
/** Nombres de las filas de una vista, en orden. */
const filas = (r, vista) => {
  const v = r.vistas.find((x) => x.nombre === vista);
  assert.ok(v, `no hay vista «${vista}»`);
  assert.ok(v.tabla.ok, `la vista «${vista}» no se muestra: ${v.tabla.motivo}`);
  return v.tabla.filas.map((f) => f.nota.nombre);
};

// ── El vault que ve una base ─────────────────────────────────────────────────

test("el vault de fixtures: solo .md visibles, sin el directorio oculto", () => {
  const nombres = ctx.notas.map((n) => n.nombre).sort();
  assert.ok(!nombres.includes("Secreta"), "`.oculto/` lo ignora el .mycignore por defecto");
  assert.ok(nombres.includes("Idea"), "las Esporas son notas y entran");
  assert.equal(ctx.carpetaEsporas, "Esporas");
});

test("etiquetas: frontmatter + cuerpo, sin las que están en código", () => {
  const jardin = ctx.notas.find((n) => n.nombre === "Jardín vertical");
  assert.deepEqual(jardin.tags, ["idea", "huerta"]);
});

// ── Bases buenas ────────────────────────────────────────────────────────────

test("Proyectos activos: filtra por carpeta y estado, ordena por prioridad numérica", async () => {
  const r = await validar("vault/Tablas/Proyectos activos.base");
  assert.deepEqual(r.errores, []);
  assert.deepEqual(r.avisos, []);
  // 10 > 5 > 3: se compara como número, no como texto ("10" < "3").
  assert.deepEqual(filas(r, "Activos"), ["Grafo 3D", "Riego automático", "Rediseño del API"]);
});

test("Tareas pendientes: casilla con != true y fechas como texto ISO", async () => {
  const r = await validar("vault/Tablas/Tareas pendientes.base");
  assert.deepEqual(r.errores, []);
  // La que no tiene `vence` va al final (las notas sin el valor, siempre últimas).
  assert.deepEqual(filas(r, "Por vencimiento"), ["Pagar dominio", "Renovar pasaporte", "Llamar al plomero"]);
  // El filtro de la vista se suma (and) al de la base.
  assert.deepEqual(filas(r, "Vencidas al 30-09"), ["Pagar dominio"]);
});

test("Etiquetadas idea: not + inFolder excluye las Esporas", async () => {
  const r = await validar("vault/Tablas/Etiquetadas idea.base");
  assert.deepEqual(r.errores, []);
  assert.deepEqual(r.avisos, []);
  assert.deepEqual(filas(r, "Ideas"), ["Grafo 3D", "Jardín vertical"]);
});

test("Proyectos por prioridad: or, not anidado, limit, sort por dos claves, isEmpty", async () => {
  const r = await validar("vault/Tablas/Proyectos por prioridad.base");
  assert.deepEqual(r.errores, []);
  const urgentes = r.vistas.find((v) => v.nombre === "Urgentes").tabla;
  assert.equal(urgentes.total, 3);
  assert.equal(urgentes.recortadas, 1);
  assert.deepEqual(filas(r, "Urgentes"), ["Grafo 3D", "Riego automático"]);
  assert.deepEqual(filas(r, "Sin vencimiento"), ["Grafo 3D"]);
});

// ── Bases malas: lo que la app rechaza ──────────────────────────────────────

test("YAML roto → error de parseo", async () => {
  const r = await validar("malas/yaml-roto.base");
  assert.deepEqual(codigos(r.errores), ["yaml"]);
});

test("dos combinadores en un mismo mapa → la tabla no se muestra", async () => {
  const r = await validar("malas/dos-combinadores.base");
  assert.deepEqual(codigos(r.errores), ["filtro"]);
  assert.equal(r.vistas[0].tabla.ok, false);
});

test("funciones no soportadas → la tabla no se muestra", async () => {
  const r = await validar("malas/funcion-no-soportada.base");
  assert.deepEqual(codigos(r.errores), ["filtro"]);
  assert.equal(r.vistas[0].tabla.ok, false);
});

test("vista cards no se dibuja; formulas/groupBy se ignoran con aviso", async () => {
  const r = await validar("malas/vista-cards-y-obsidian.base");
  assert.deepEqual(codigos(r.errores), ["vista"]);
  assert.ok(codigos(r.avisos).includes("no-modelada"));
  assert.ok(codigos(r.avisos).includes("formula"));
  assert.equal(r.vistas.find((v) => v.nombre === "Agrupada").tabla.ok, true);
});

test("«: » dentro de una expresión parte el YAML", async () => {
  const r = await validar("malas/dos-puntos.base");
  assert.deepEqual(codigos(r.errores), ["dos-puntos"]);
});

// ── Bases malas: lo que la app acepta y hace MAL en silencio ────────────────

test("comentario al final de una línea: rompe el filtro y el tipo de vista", async () => {
  const r = await validar("malas/comentario-en-linea.base");
  assert.ok(codigos(r.errores).includes("comentario"));
  assert.ok(codigos(r.errores).includes("vista"));
});

test("&& y ! de JavaScript: la app da 0 filas sin quejarse; el validador lo marca", async () => {
  const r = await validar("malas/operadores-js.base");
  assert.deepEqual(codigos(r.errores), ["js"]);
  assert.equal(r.vistas[0].tabla.ok, true, "la app NO avisa");
});

test("today() a la derecha: se compara como texto y da verdadero para todo", async () => {
  const r = await validar("malas/fecha-dinamica.base");
  assert.deepEqual(codigos(r.errores), ["llamada-derecha"]);
  assert.equal(r.vistas[0].tabla.filas.length, 3, "las tres tareas, vencidas o no");
});

test("claves mal escritas, sort en línea y limit no numérico se ignoran en silencio", async () => {
  const r = await validar("malas/claves-mal-escritas.base");
  assert.deepEqual(codigos(r.errores), ["campo-file", "clave-desconocida", "clave-vista", "limit", "sort"]);
  assert.ok(codigos(r.avisos).includes("propiedad-desconocida"));
});

test("número entre comillas, inFolder con otra capitalización y file.mtime → avisos", async () => {
  const r = await validar("malas/silenciosos.base");
  assert.deepEqual(r.errores, []);
  // `hasTag("proyecto")` existe exacta, pero deja afuera `#proyecto/huerta`.
  assert.deepEqual(codigos(r.avisos), ["carpeta", "etiqueta", "fecha-indice", "numero-comillas"]);
  assert.match(r.avisos.find((a) => a.codigo === "etiqueta").msg, /startsWith\("proyecto\/"\)/);
});

test("hasTag + file.tags.startsWith cubre las anidadas: sin aviso", () => {
  const r = validarBase(
    'filters:\n  or:\n    - file.hasTag("proyecto")\n    - file.tags.startsWith("proyecto/")\nviews:\n  - type: table\n    name: Todos\n',
    ctx,
  );
  assert.deepEqual(r.avisos, []);
  assert.ok(filas(r, "Todos").includes("Riego automático"));
});

test("una base sin excluir la carpeta de Esporas avisa que las incluye", async () => {
  const r = await validar("malas/incluye-esporas.base");
  assert.deepEqual(codigos(r.avisos), ["esporas"]);
});

test("hasTag no incluye las etiquetas anidadas: el validador lo sugiere", () => {
  const r = validarBase('filters:\n  and:\n    - file.hasTag("proyecto")\n', {
    ...ctx,
    notas: ctx.notas.filter((n) => n.nombre === "Riego automático"),
  });
  assert.deepEqual(codigos(r.avisos), ["etiqueta", "sin-vistas"]);
  assert.match(r.avisos.find((a) => a.codigo === "etiqueta").msg, /proyecto\/huerta/);
  assert.equal(r.vistas[0].tabla.filas.length, 0);
});

// ── Lo que enseña el borrador de la skill ───────────────────────────────────

const SKILL = (await readFile(fileURLToPath(new URL("../lib/ia/borradores/mycelium-base.md", import.meta.url)), "utf8")).replace(/\r\n/g, "\n");
const bloques = [...SKILL.matchAll(/```yaml\n([\s\S]*?)```/g)].map((m) => m[1]).filter((b) => !/^\s/.test(b));

test("el borrador trae ejemplos completos", () => {
  assert.ok(bloques.length >= 6, `solo ${bloques.length} bloques yaml`);
});

bloques.forEach((b, i) => {
  test(`el ejemplo ${i + 1} del borrador no tiene errores y la app lo muestra`, () => {
    const r = validarBase(b, ctx);
    assert.deepEqual(r.errores, [], b);
    for (const v of r.vistas) assert.ok(v.tabla.ok, `vista «${v.nombre}»: ${v.tabla.motivo}`);
    assert.ok(!r.avisos.some((a) => a.codigo === "esporas"), "un ejemplo deja entrar la plantilla");
  });
});

test("receta por estado: las pestañas reparten los proyectos de Mycelium", () => {
  const receta = bloques.find((b) => b.includes('name: Pausados'));
  const r = validarBase(receta, ctx);
  assert.deepEqual(filas(r, "Activos"), ["Rediseño del API"]);
  assert.deepEqual(filas(r, "Pausados"), ["Grafo 3D"]);
});

test("receta de tareas: vencidas y por vencer se reparten TODAS las pendientes, sin fecha incluidas", () => {
  const receta = bloques.find((b) => b.includes("name: Por vencer y sin fecha"));
  const r = validarBase(receta, ctx);
  assert.deepEqual(filas(r, "Vencidas"), ["Pagar dominio"]);
  assert.deepEqual(filas(r, "Por vencer y sin fecha"), ["Renovar pasaporte", "Llamar al plomero"]);
  // Lo que el borrador advierte: `>=` pierde las que no tienen fecha.
  const conMayorIgual = validarBase(receta.replace("not:\n        - vence <", "and:\n        - vence >="), ctx);
  assert.deepEqual(filas(conMayorIgual, "Por vencer y sin fecha"), ["Renovar pasaporte"]);
});

test("receta de índice por etiqueta: el or con startsWith trae las anidadas", () => {
  const receta = bloques.find((b) => b.includes("name: Recetas")).replaceAll("receta", "proyecto");
  const r = validarBase(receta, ctx);
  assert.deepEqual(r.avisos.filter((a) => a.codigo === "etiqueta"), []);
  assert.ok(filas(r, "Recetas").includes("Riego automático"), "#proyecto/huerta");
});

// Los comandos de «Del pedido a la consulta» corren en sh; se prueban si hay uno.
const sh = spawnSync("sh", ["-c", "true"]).status === 0;
const comandos = /## Del pedido a la consulta[\s\S]*?```sh\n([\s\S]*?)```/.exec(SKILL)?.[1] ?? "";

test("los comandos para conocer el vault saltean lo oculto y los CLAUDE*.md", { skip: !sh && "sin sh" }, () => {
  assert.ok(comandos.includes("find ."), "no se encontró el bloque sh");
  const r = spawnSync("sh", ["-c", comandos], { cwd: VAULT, encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  const n = (re) => Number(re.exec(r.stdout)?.[1] ?? 0);
  // Cinco notas con `estado` (la de `.oculto/` no cuenta) y los valores reales.
  assert.equal(n(/^\s*(\d+) estado$/m), 5);
  assert.equal(n(/^\s*(\d+) estado: activo$/m), 2);
  assert.match(r.stdout, /^\s*1 tags: \[proyecto\/huerta\]$/m);
  assert.doesNotMatch(r.stdout, /Secreta|No debería/);
});

test("sin vault: valida la sintaxis y no evalúa", () => {
  const r = validarBase("views:\n  - type: table\n    name: Todas\n    order:\n      - file.name\n");
  assert.deepEqual(r.errores, []);
  assert.deepEqual(r.vistas, []);
});
