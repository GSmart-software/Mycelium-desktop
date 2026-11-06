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
const PERSONALIZAR = await fuente("../lib/comandos/personalizar.ts", { "./atajos": ATAJOS });
const REGISTRO = await fuente("../lib/comandos/registro.ts", {
  "@/lib/modoDev": MODO_DEV,
  "./atajos": ATAJOS,
  "./personalizar": PERSONALIZAR,
});
const ATMOSFERAS = await fuente("../lib/atmosferas.ts");
const NUEVO = await fuente("../lib/comandos/nuevo.ts");
const APP = await fuente(
  "../lib/comandos/comandosApp.ts",
  { "@/lib/modoDev": MODO_DEV, "@/lib/atmosferas": ATMOSFERAS, "./nuevo": NUEVO },
  { falsos: true },
);

const EXPLORADOR = await fuente("../lib/comandos/comandosExplorador.ts", {}, { falsos: true });

const at = await import(ATAJOS);
const nuevo = await import(NUEVO);
const { comandosExplorador } = await import(EXPLORADOR);
const reg = await import(REGISTRO);
const { COMANDOS_APP } = await import(APP);
const { ATMOSFERAS: LISTA_ATMOSFERAS } = await import(ATMOSFERAS);

/** AltGr en Windows: Ctrl+Alt, y `getModifierState("AltGraph")`. */
const ALTGR = { ctrlKey: true, altKey: true, getModifierState: (k) => k === "AltGraph" };

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

test("la paleta lista los comandos en su orden y con su texto", () => {
  const paleta = reg.comandosDePaleta(COMANDOS_APP, ctx(false)).map((c) => ({
    id: c.id,
    ...reg.textoEnPaleta(c, COMANDOS_APP),
  }));
  const titulos = paleta.map((p) => p.titulo);
  const primeros = [
    "Nueva nota",
    // Crear (Parte 4): el menú «Nuevo…» y cada tipo.
    "Nuevo…",
    "Nueva carpeta",
    "Nuevo canvas",
    "Nueva base",
    "Nuevo dibujo Excalidraw",
    "Nuevo diagrama draw.io",
    "Nueva desde Espora…",
    "Captura rápida",
    "Buscar en el contenido del vault",
    "Abrir el grafo de conexiones",
    "Abrir el calendario",
    "Revisar la salud del vault",
    "Abrir la salud del vault en una pestaña",
    "Generar informe de salud del vault",
    "Nuevo recordatorio",
    "Mostrar u ocultar el explorador",
    // Las secciones del rail y los paneles (Parte 4).
    "Abrir el explorador",
    "Abrir el panel de Esporas",
    "Abrir el panel del calendario",
    "Abrir el panel de consolas",
    "Abrir la actividad de la IA",
    "Abrir la papelera",
    // Sin pestañas ni vista dividida ni ancladas (los stores son falsos en
    // esta prueba), dividir, cerrar el panel y anclar dependen de
    // `disponible`: se comprueban en vivo.
  ];
  assert.deepEqual(titulos.slice(0, primeros.length), primeros);
  // El del cambio de modo (dinámico), Configuración, Ayuda y las atmósferas.
  const i = titulos.indexOf("Nueva consola");
  assert.ok(i >= primeros.length);
  assert.match(titulos[i + 1], /^Cambiar a modo (claro|oscuro)$/);
  assert.deepEqual(titulos.slice(i + 2, i + 7), [
    "Abrir la configuración (Ctrl+,)",
    "Ayuda",
    // La hoja de atajos y Configuración → Atajos de teclado (Parte 3).
    "Ver los atajos de teclado",
    "Cambiar los atajos de teclado",
    // El modo pistas (Parte 5).
    "Mostrar las pistas para hacer clic con el teclado",
  ]);
  assert.deepEqual(
    titulos.slice(i + 7),
    LISTA_ATMOSFERAS.map((a) => `Atmósfera: ${a.nombre}`),
  );
  const detalle = (id) => paleta.find((p) => p.id === id).detalle;
  assert.equal(detalle("bandeja.capturar"), "Ctrl+Shift+Espacio · anotar en la Bandeja del vault o en la personal");
  assert.equal(detalle("explorador.alternar"), "Ctrl+Shift+E");
  assert.equal(detalle("ayuda.abrir"), "F1 · Cómo se usa Mycelium");
  assert.equal(detalle("nota.nueva"), "Ctrl+N · En la carpeta seleccionada");
  assert.match(detalle("crear.nuevo"), /^Ctrl\+Shift\+N · /);
  assert.equal(detalle("busqueda.vault"), "Ctrl+Shift+F");
  assert.equal(detalle("configuracion.abrir"), undefined);
  assert.equal(detalle("pistas.mostrar"), "F10");
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
    // AltGr+←/→ (en Windows llega como Ctrl+Alt con AltGraph): el historial.
    [tecla("ArrowLeft", ALTGR), "historial.atras"],
    [tecla("ArrowRight", ALTGR), "historial.adelante"],
    // Los niveles: Alt+flechas se mueve, Ctrl+Enter entra, Ctrl+Num salta.
    [tecla("ArrowLeft", { altKey: true }), "nivel.izquierda"],
    [tecla("ArrowRight", { altKey: true }), "nivel.derecha"],
    [tecla("ArrowUp", { altKey: true }), "nivel.arriba"],
    [tecla("ArrowDown", { altKey: true }), "nivel.abajo"],
    [tecla("Enter", { ctrlKey: true }), "nivel.entrar"],
    [tecla("Numpad1", { ctrlKey: true }), "zona.rail"],
    [tecla("Numpad2", { ctrlKey: true }), "zona.izquierda"],
    [tecla("Numpad3", { ctrlKey: true }), "zona.pestanas"],
    [tecla("Numpad4", { ctrlKey: true }), "zona.enlaces"],
    [tecla("Numpad5", { ctrlKey: true }), "zona.estado"],
    // Crear y mostrar/ocultar (Parte 4).
    [tecla("KeyN", { ctrlKey: true }), "nota.nueva"],
    [tecla("KeyN", { ctrlKey: true, shiftKey: true }), "crear.nuevo"],
    [tecla("KeyE", { ctrlKey: true, shiftKey: true }), "explorador.alternar"],
    [tecla("KeyF", { ctrlKey: true, shiftKey: true }), "busqueda.vault"],
  ];
  for (const [e, id] of casos) assert.equal(reg.comandoParaTecla(e, COMANDOS_APP, false)?.id, id, id);
});

test("el despachador no toca las teclas de los manejadores propios ni las sueltas", () => {
  for (const e of [
    // Esc lo atiende `useTecladoZonas` (salir un nivel); Tab ya no recorre.
    tecla("Escape"),
    tecla("Tab"),
    // Ctrl+Alt+← (sin AltGr) ya no es de nadie: los paneles contiguos van por la paleta.
    tecla("ArrowLeft", { ctrlKey: true, altKey: true }),
    tecla("ArrowRight", { ctrlKey: true, altKey: true }),
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

test("el historial y los niveles respetan lo que el editor o un componente ya consumió", () => {
  for (const id of [
    "historial.atras",
    "historial.adelante",
    "nivel.izquierda",
    "nivel.derecha",
    "nivel.arriba",
    "nivel.abajo",
    "nivel.entrar",
  ]) {
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

// ── crear y mostrar/ocultar (Parte 4) ──────────────────────────────────────

test("cada opción de «Nuevo…» es un comando del catálogo", () => {
  const ids = new Set(COMANDOS_APP.map((c) => c.id));
  for (const o of nuevo.OPCIONES_NUEVO) assert.ok(ids.has(o.comando), o.comando);
  for (const id of ["crear.carpeta", "crear.lienzo", "crear.tabla", "crear.dibujo", "crear.diagrama", "crear.desde-espora"]) {
    assert.ok(ids.has(id), id);
  }
  // Los textos del explorador salen de acá: «Nueva base (tabla de notas)».
  assert.equal(nuevo.tituloConDetalle(nuevo.opcionDe("tabla")), "Nueva base (tabla de notas)");
  assert.equal(nuevo.tituloConDetalle(nuevo.opcionDe("dibujo")), "Nuevo dibujo Excalidraw");
});

test("los atajos nuevos: con Ctrl, sin letra sola, sin reservadas ni CodeMirror", async () => {
  const nuevos = {
    "nota.nueva": { ctrl: true, code: "KeyN" },
    "crear.nuevo": { ctrl: true, shift: true, code: "KeyN" },
    "explorador.alternar": { ctrl: true, shift: true, code: "KeyE" },
    "busqueda.vault": { ctrl: true, shift: true, code: "KeyF" },
  };
  for (const [id, atajo] of Object.entries(nuevos)) {
    const c = COMANDOS_APP.find((x) => x.id === id);
    assert.deepEqual(c.atajos, [atajo], id);
    assert.equal(at.problemaDeAtajo(atajo), null, id);
    assert.equal(at.reservaQueChoca(atajo, id), null, id);
  }
  // Si Excalidraw ya usó Ctrl+Shift+E (exportar), el explorador no actúa.
  assert.equal(COMANDOS_APP.find((c) => c.id === "explorador.alternar").ignorarSiPrevenido, true);
  // CodeMirror no las usa en Windows ni Linux (`Ctrl-n` del estilo Emacs es
  // solo de macOS, donde Ctrl no es Cmd).
  const { defaultKeymap, historyKeymap, standardKeymap } = await import("@codemirror/commands");
  const { searchKeymap } = await import("@codemirror/search");
  const teclas = new Set(["mod-n", "shift-mod-n", "mod-shift-n", "mod-shift-e", "shift-mod-e", "mod-shift-f", "shift-mod-f"]);
  for (const b of [...defaultKeymap, ...historyKeymap, ...standardKeymap, ...searchKeymap]) {
    const k = (b.win ?? b.key ?? "").toLowerCase();
    if (!k) continue;
    assert.ok(!teclas.has(k), `CodeMirror usa ${k}`);
    assert.ok(!/^ctrl-(shift-)?[nef]$/.test(k), `CodeMirror usa ${k}`);
  }
});

test("el menú «Nuevo…» con el teclado: flechas con vuelta, Enter, → a las Esporas, ← y Esc vuelven", () => {
  const n = nuevo.OPCIONES_NUEVO.length;
  const ini = nuevo.ESTADO_INICIAL_NUEVO;
  assert.deepEqual(nuevo.teclaEnNuevo(ini, "ArrowDown", n), { accion: "mover", estado: { paso: "tipos", activa: 1 } });
  assert.deepEqual(nuevo.teclaEnNuevo(ini, "ArrowUp", n), { accion: "mover", estado: { paso: "tipos", activa: n - 1 } });
  assert.deepEqual(nuevo.teclaEnNuevo(ini, "End", n), { accion: "mover", estado: { paso: "tipos", activa: n - 1 } });
  assert.equal(nuevo.teclaEnNuevo({ paso: "tipos", activa: 3 }, "Home", n).estado.activa, 0);
  assert.deepEqual(nuevo.teclaEnNuevo({ paso: "tipos", activa: 2 }, "Enter", n), { accion: "elegir", indice: 2 });
  // → solo entra si la opción abre otro paso.
  assert.deepEqual(nuevo.teclaEnNuevo(ini, "ArrowRight", n, false), { accion: "nada" });
  const espora = nuevo.OPCIONES_NUEVO.findIndex((o) => o.tipo === "espora");
  assert.deepEqual(nuevo.teclaEnNuevo({ paso: "tipos", activa: espora }, "ArrowRight", n, true), {
    accion: "elegir",
    indice: espora,
  });
  assert.deepEqual(nuevo.teclaEnNuevo(ini, "Escape", n), { accion: "cerrar" });
  const enEsporas = { paso: "esporas", activa: 0 };
  for (const k of ["ArrowLeft", "Backspace", "Escape"]) {
    assert.deepEqual(nuevo.teclaEnNuevo(enEsporas, k, 3), { accion: "volver" }, k);
  }
  // Sin Esporas, las flechas y Enter no hacen nada; ← vuelve igual.
  assert.deepEqual(nuevo.teclaEnNuevo(enEsporas, "Enter", 0), { accion: "nada" });
  assert.deepEqual(nuevo.teclaEnNuevo(enEsporas, "ArrowDown", 0), { accion: "nada" });
  // Una letra no hace nada (no hay atajos de letra sola).
  assert.deepEqual(nuevo.teclaEnNuevo(ini, "n", n), { accion: "nada" });
});

test("los comandos del explorador: ids únicos, sin atajos, y según lo seleccionado", () => {
  let sel = null;
  let disco = true;
  const hechos = [];
  const acciones = {
    seleccion: () => sel,
    hayCarpetaEnDisco: () => disco,
  };
  for (const k of ["renombrar", "mover", "duplicar", "copiarEnlace", "abrirAlLado", "exportarMd", "exportarPdf", "mostrarEnSistema", "eliminar"]) {
    acciones[k] = () => hechos.push(k);
  }
  const lista = comandosExplorador(acciones);
  // Juntos con los de la app, sin problemas (ids, títulos, atajos).
  assert.deepEqual(reg.validarComandos([...COMANDOS_APP, ...lista]), []);
  for (const c of lista) {
    assert.match(c.id, /^explorador\./);
    assert.equal(c.atajos, undefined, c.id);
    assert.equal(c.categoria, "explorador");
  }
  const disponibles = () => reg.comandosDePaleta(lista, ctx(false)).map((c) => c.id);
  // Sin selección, ninguno.
  assert.deepEqual(disponibles(), []);
  sel = { tipo: "nota", nombre: "Ideas", markdown: true };
  assert.equal(disponibles().length, 9);
  const renombrar = lista.find((c) => c.id === "explorador.renombrar");
  assert.equal(reg.resolverTexto(renombrar.titulo), "Renombrar «Ideas»");
  renombrar.ejecutar(ctx());
  assert.deepEqual(hechos, ["renombrar"]);
  // Una carpeta no se duplica, ni se copia su enlace, ni se exporta.
  sel = { tipo: "carpeta", nombre: "Proyectos" };
  assert.deepEqual(disponibles(), [
    "explorador.renombrar",
    "explorador.mover",
    "explorador.mostrar-en-sistema",
    "explorador.eliminar",
  ]);
  // Un lienzo no se exporta como .md; sin vault de carpeta, no se muestra en el sistema.
  sel = { tipo: "nota", nombre: "Mapa", markdown: false };
  disco = false;
  const d = disponibles();
  assert.ok(!d.includes("explorador.exportar-md") && !d.includes("explorador.mostrar-en-sistema"));
  // Ejecutar uno que no vale para lo seleccionado no hace nada.
  lista.find((c) => c.id === "explorador.exportar-md").ejecutar(ctx());
  assert.deepEqual(hechos, ["renombrar"]);
});
