// Test del catálogo de comandos (`FUN-XL-04`, Parte 1): los atajos
// (`lib/comandos/atajos.ts`), el registro y el despachador
// (`lib/comandos/registro.ts`) y la lista de comandos de la app
// (`lib/comandos/comandosApp.ts`): ids únicos, todos con título, atajos sin
// duplicados, ninguno con una tecla reservada, `code` válidos, los de
// desarrollador ocultos sin el modo y la fila de números distinta del teclado
// numérico.
//
// Los módulos se transpilan en el momento, como en `scripts/test-bandeja.mjs`.
// `comandosApp.ts` importa stores, íconos y Tauri: esos imports se reemplazan
// por módulos falsos (todo lo que exportan es un objeto que acepta cualquier
// uso), salvo los módulos puros, que van de verdad.
//
//   node --test scripts/test-comandos.mjs
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import ts from "typescript";

const aUrl = (codigo) => `data:text/javascript,${encodeURIComponent(codigo)}`;

/** Un objeto que acepta cualquier uso: leerle algo, llamarlo, construirlo. */
const FALSO = `
const falso = new Proxy(function () {}, {
  get: (_, k) => (k === Symbol.toPrimitive ? () => "falso" : k === "then" ? undefined : falso),
  apply: () => falso,
  construct: () => falso,
});`;

/** Un módulo falso con los nombres que el import pide. */
function moduloFalso(nombres) {
  const lineas = [FALSO];
  for (const n of nombres) lineas.push(n === "default" ? "export default falso;" : `export const ${n} = falso;`);
  return aUrl(lineas.join("\n"));
}

/**
 * Transpila un módulo. Los especificadores de `mapa` van al módulo dado; el
 * resto de los imports con valores, a un módulo falso (si `falsos`).
 */
async function fuente(ruta, mapa = {}, { falsos = false } = {}) {
  const texto = await readFile(fileURLToPath(new URL(ruta, import.meta.url)), "utf8");
  let { outputText } = ts.transpileModule(texto, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  });
  outputText = outputText.replace(/import\s*\{([^}]*)\}\s*from\s*"([^"]+)";/g, (todo, lista, esp) => {
    if (mapa[esp]) return `import {${lista}} from "${mapa[esp]}";`;
    if (!falsos) return todo;
    const nombres = lista
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => s.split(/\s+as\s+/)[0].trim());
    return `import {${lista}} from "${moduloFalso(nombres)}";`;
  });
  return aUrl(outputText);
}

const MODO_DEV = await fuente("../lib/modoDev.ts");
const ATAJOS = await fuente("../lib/comandos/atajos.ts");
const REGISTRO = await fuente("../lib/comandos/registro.ts", { "@/lib/modoDev": MODO_DEV, "./atajos": ATAJOS });
const ATMOSFERAS = await fuente("../lib/atmosferas.ts");
const APP = await fuente(
  "../lib/comandos/comandosApp.ts",
  { "@/lib/modoDev": MODO_DEV, "@/lib/atmosferas": ATMOSFERAS },
  { falsos: true },
);

const at = await import(ATAJOS);
const reg = await import(REGISTRO);
const { COMANDOS_APP } = await import(APP);
const { ATMOSFERAS: LISTA_ATMOSFERAS } = await import(ATMOSFERAS);

const tecla = (code, mods = {}) => ({
  code,
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  altKey: false,
  ...mods,
});
const ctx = (dev = false) => ({ navegar: () => {}, dev });

// ── los atajos ─────────────────────────────────────────────────────────────

test("la fila de números y el teclado numérico son atajos distintos", () => {
  const fila = { ctrl: true, code: "Digit1" };
  const num = { ctrl: true, code: "Numpad1" };
  assert.equal(at.mismoAtajo(fila, num), false);
  assert.equal(at.coincide(fila, tecla("Digit1", { ctrlKey: true })), true);
  assert.equal(at.coincide(fila, tecla("Numpad1", { ctrlKey: true })), false);
  assert.equal(at.coincide(num, tecla("Numpad1", { ctrlKey: true })), true);
  assert.equal(at.textoAtajo(fila), "Ctrl+1");
  assert.equal(at.textoAtajo(num), "Ctrl+Num 1");
  // Y los dos pueden convivir en el registro.
  const dos = [
    { id: "a.uno", titulo: "Uno", icono: null, categoria: "app", atajos: [fila], ejecutar() {} },
    { id: "a.num-uno", titulo: "Num uno", icono: null, categoria: "app", atajos: [num], ejecutar() {} },
  ];
  assert.deepEqual(reg.validarComandos(dos), []);
});

test("los modificadores se comparan exactos; Cmd cuenta como Ctrl", () => {
  const w = { ctrl: true, code: "KeyW" };
  assert.equal(at.coincide(w, tecla("KeyW", { ctrlKey: true })), true);
  assert.equal(at.coincide(w, tecla("KeyW", { metaKey: true })), true);
  assert.equal(at.coincide(w, tecla("KeyW", { ctrlKey: true, shiftKey: true })), false);
  // AltGr en Windows es Ctrl+Alt: no es Ctrl+W.
  assert.equal(at.coincide(w, tecla("KeyW", { ctrlKey: true, altKey: true })), false);
  assert.equal(at.coincide(w, tecla("KeyW")), false);
});

test("el texto de los atajos es el que la paleta mostraba", () => {
  assert.equal(at.textoAtajo({ ctrl: true, shift: true, code: "Space" }), "Ctrl+Shift+Espacio");
  assert.equal(at.textoAtajo({ ctrl: true, code: "Backslash" }), "Ctrl+\\");
  assert.equal(at.textoAtajo({ ctrl: true, code: "Comma" }), "Ctrl+,");
  assert.equal(at.textoAtajo({ code: "F1" }), "F1");
  assert.equal(at.textoAtajo({ code: "F12" }), "F12");
  assert.equal(at.textoAtajo({ alt: true, code: "ArrowLeft" }), "Alt+←");
});

test("Alt+Tab y Ctrl+Shift+Espacio están reservadas; la segunda, para la captura", () => {
  assert.notEqual(at.reservaQueChoca({ alt: true, code: "Tab" }, "cualquiera.cosa"), null);
  assert.notEqual(at.reservaQueChoca({ ctrl: true, shift: true, code: "Space" }, "otro.comando"), null);
  assert.equal(at.reservaQueChoca({ ctrl: true, shift: true, code: "Space" }, "bandeja.capturar"), null);
  const problemas = reg.validarComandos([
    { id: "x.alt-tab", titulo: "X", icono: null, categoria: "app", atajos: [{ alt: true, code: "Tab" }], ejecutar() {} },
  ]);
  assert.equal(problemas.length, 1);
  assert.match(problemas[0], /reservada/);
});

// ── la lista de la app ─────────────────────────────────────────────────────

test("los comandos de la app no tienen problemas (ids, títulos, teclas, duplicados, reservadas)", () => {
  assert.deepEqual(reg.validarComandos(COMANDOS_APP), []);
});

test("ids únicos y con forma `area.accion`", () => {
  const ids = COMANDOS_APP.map((c) => c.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const id of ids) assert.match(id, /^[a-z][a-z0-9-]*(\.[a-z0-9-]+)+$/, id);
});

test("todo comando tiene título, ícono, categoría y `ejecutar`", () => {
  for (const c of COMANDOS_APP) {
    assert.ok(reg.resolverTexto(c.titulo)?.trim(), `${c.id} sin título`);
    assert.ok(c.icono, `${c.id} sin ícono`);
    assert.ok(c.categoria, `${c.id} sin categoría`);
    assert.equal(typeof c.ejecutar, "function", `${c.id} sin ejecutar`);
  }
});

test("ningún atajo se repite y todos usan una tecla que existe", () => {
  const todos = COMANDOS_APP.flatMap((c) => (c.atajos ?? []).map((a) => ({ a, id: c.id })));
  for (const { a, id } of todos) assert.ok(at.CODES_VALIDOS.has(a.code), `${id}: ${a.code}`);
  for (let i = 0; i < todos.length; i++) {
    for (let j = i + 1; j < todos.length; j++) {
      assert.equal(at.mismoAtajo(todos[i].a, todos[j].a), false, `${todos[i].id} y ${todos[j].id}`);
    }
  }
});

test("ningún comando usa una tecla reservada que no es suya", () => {
  for (const c of COMANDOS_APP) {
    for (const a of c.atajos ?? []) assert.equal(at.reservaQueChoca(a, c.id), null, `${c.id}: ${at.textoAtajo(a)}`);
  }
  // Ctrl+Shift+Espacio es de la captura, y la atiende su propio manejador.
  const captura = COMANDOS_APP.find((c) => c.id === "bandeja.capturar");
  assert.ok(captura?.manejadorPropio);
});

test("la paleta lista los mismos comandos que antes, en el mismo orden y con el mismo texto", () => {
  const paleta = reg.comandosDePaleta(COMANDOS_APP, ctx(false)).map((c) => ({
    id: c.id,
    ...reg.textoEnPaleta(c, COMANDOS_APP),
  }));
  const titulos = paleta.map((p) => p.titulo);
  assert.deepEqual(titulos.slice(0, 11), [
    "Nueva nota",
    "Captura rápida",
    "Buscar en el contenido del vault",
    "Abrir el grafo de conexiones",
    "Abrir el calendario",
    "Revisar la salud del vault",
    "Abrir la salud del vault en una pestaña",
    "Generar informe de salud del vault",
    "Nuevo recordatorio",
    "Mostrar u ocultar el explorador",
    "Nueva consola",
  ]);
  // El del cambio de modo (dinámico), Configuración, Ayuda y las atmósferas.
  assert.match(titulos[11], /^Cambiar a modo (claro|oscuro)$/);
  assert.deepEqual(titulos.slice(12, 14), ["Abrir la configuración (Ctrl+,)", "Ayuda"]);
  assert.deepEqual(
    titulos.slice(14),
    LISTA_ATMOSFERAS.map((a) => `Atmósfera: ${a.nombre}`),
  );
  const detalle = (id) => paleta.find((p) => p.id === id).detalle;
  assert.equal(detalle("bandeja.capturar"), "Ctrl+Shift+Espacio · anotar en la Bandeja del vault");
  assert.equal(detalle("explorador.alternar"), "Ctrl+\\");
  assert.equal(detalle("ayuda.abrir"), "F1 · Cómo se usa Mycelium");
  assert.equal(detalle("nota.nueva"), "En la carpeta seleccionada");
  assert.equal(detalle("configuracion.abrir"), undefined);
});

test("sin el modo dev, sus comandos no están en la paleta; con él, al final y con F12", () => {
  const sin = reg.comandosDePaleta(COMANDOS_APP, ctx(false));
  assert.equal(sin.some((c) => c.soloDev), false);
  const con = reg.comandosDePaleta(COMANDOS_APP, ctx(true));
  const dev = con.filter((c) => c.soloDev).map((c) => ({ id: c.id, ...reg.textoEnPaleta(c, COMANDOS_APP) }));
  assert.deepEqual(dev, [
    { id: "dev.desactivar", titulo: "Desactivar el modo desarrollador", detalle: undefined },
    { id: "dev.herramientas", titulo: "Abrir las herramientas de desarrollador", detalle: "F12" },
  ]);
  assert.deepEqual(con.slice(-2).map((c) => c.id), ["dev.desactivar", "dev.herramientas"]);
});

test("el comando oculto `>dev` no es un comando del registro", () => {
  for (const c of COMANDOS_APP) {
    assert.notEqual(c.id, "dev", c.id);
    assert.notEqual(reg.resolverTexto(c.titulo).trim().toLowerCase(), "dev", c.id);
  }
});

// ── el despachador ─────────────────────────────────────────────────────────

test("el despachador encuentra el comando de cada atajo global", () => {
  const casos = [
    [tecla("KeyO", { ctrlKey: true }), "paleta.notas"],
    [tecla("KeyP", { ctrlKey: true }), "paleta.comandos"],
    [tecla("KeyP", { ctrlKey: true, shiftKey: true }), "paleta.comandos"],
    [tecla("Comma", { ctrlKey: true }), "configuracion.abrir"],
    [tecla("KeyF", { ctrlKey: true }), "nota.buscar"],
    [tecla("Backslash", { ctrlKey: true }), "panel-izquierdo.alternar"],
    [tecla("Backslash", { ctrlKey: true, shiftKey: true }), "panel-derecho.alternar"],
    [tecla("Tab", { ctrlKey: true }), "pestana.siguiente"],
    [tecla("Tab", { ctrlKey: true, shiftKey: true }), "pestana.anterior"],
    [tecla("KeyW", { ctrlKey: true }), "pestana.cerrar"],
    [tecla("KeyT", { ctrlKey: true, shiftKey: true }), "pestana.reabrir"],
    [tecla("ArrowLeft", { altKey: true }), "historial.atras"],
    [tecla("ArrowRight", { altKey: true }), "historial.adelante"],
  ];
  for (const [e, id] of casos) assert.equal(reg.comandoParaTecla(e, COMANDOS_APP, false)?.id, id, id);
});

test("el despachador no toca las teclas de los manejadores propios ni las sueltas", () => {
  for (const e of [
    tecla("F1"),
    tecla("F12"),
    tecla("KeyI", { ctrlKey: true, shiftKey: true }),
    tecla("Space", { ctrlKey: true, shiftKey: true }),
    tecla("Tab", { altKey: true }),
    tecla("KeyW"),
    tecla("KeyO", { ctrlKey: true, shiftKey: true }),
  ]) {
    assert.equal(reg.comandoParaTecla(e, COMANDOS_APP, true), null, e.code);
  }
});

test("Alt+←/→ respetan lo que el editor ya consumió", () => {
  for (const id of ["historial.atras", "historial.adelante"]) {
    assert.equal(COMANDOS_APP.find((c) => c.id === id).ignorarSiPrevenido, true, id);
  }
});

// ── el registro vivo ───────────────────────────────────────────────────────

test("alta y baja: la baja saca solo lo suyo y un id repetido no pisa al primero", () => {
  const avisos = [];
  const original = console.error;
  console.error = (m) => avisos.push(m);
  try {
    let cambios = 0;
    const fuera = reg.suscribirComandos(() => cambios++);
    const a = { id: "t.a", titulo: "A", icono: null, categoria: "app", ejecutar() {} };
    const b = { id: "t.b", titulo: "B", icono: null, categoria: "app", ejecutar() {} };
    const otraA = { ...a, titulo: "Otra A" };
    const bajaAB = reg.registrarComandos([a, b]);
    const bajaOtra = reg.registrarComandos([otraA]);
    assert.deepEqual(reg.listarComandos().map((c) => c.titulo), ["A", "B"]);
    assert.equal(avisos.length, 1);
    // La lista es estable mientras no cambia nada.
    assert.equal(reg.listarComandos(), reg.listarComandos());
    bajaOtra();
    assert.deepEqual(reg.listarComandos().map((c) => c.id), ["t.a", "t.b"]);
    bajaAB();
    assert.deepEqual(reg.listarComandos(), []);
    assert.equal(cambios, 2);
    fuera();
  } finally {
    console.error = original;
  }
});
