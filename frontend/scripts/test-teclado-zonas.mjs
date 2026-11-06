// Test de las zonas y los modos del teclado (`FUN-XL-04`, Parte 2): el orden de
// las zonas con F6 (`lib/teclado/zonas.ts`), a qué panel se pasa con
// Ctrl+Alt+←/→, en qué modo queda el documento tras cambiar de pestaña, cuándo
// Esc saca de escribir, la lista de teclas que la consola deja pasar
// (`lib/comandos/teclasConsola.ts`) y que los comandos nuevos no usen una
// tecla reservada ni una letra sola.
//
// Los módulos se transpilan en el momento, como en `scripts/test-comandos.mjs`.
//
//   node --test scripts/test-teclado-zonas.mjs
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import ts from "typescript";

const aUrl = (codigo) => `data:text/javascript,${encodeURIComponent(codigo)}`;

const FALSO = `
const falso = new Proxy(function () {}, {
  get: (_, k) => (k === Symbol.toPrimitive ? () => "falso" : k === "then" ? undefined : falso),
  apply: () => falso,
  construct: () => falso,
});`;

function moduloFalso(nombres) {
  const lineas = [FALSO];
  for (const n of nombres) lineas.push(n === "default" ? "export default falso;" : `export const ${n} = falso;`);
  return aUrl(lineas.join("\n"));
}

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

const ZONAS = await fuente("../lib/teclado/zonas.ts");
const ATAJOS = await fuente("../lib/comandos/atajos.ts");
const MODO_DEV = await fuente("../lib/modoDev.ts");
const PERSONALIZAR = await fuente("../lib/comandos/personalizar.ts", { "./atajos": ATAJOS });
const REGISTRO = await fuente("../lib/comandos/registro.ts", {
  "@/lib/modoDev": MODO_DEV,
  "./atajos": ATAJOS,
  "./personalizar": PERSONALIZAR,
});
const CONSOLA = await fuente("../lib/comandos/teclasConsola.ts", { "./atajos": ATAJOS, "./registro": REGISTRO });
const ATMOSFERAS = await fuente("../lib/atmosferas.ts");
const NUEVO = await fuente("../lib/comandos/nuevo.ts");
const APP = await fuente(
  "../lib/comandos/comandosApp.ts",
  { "@/lib/modoDev": MODO_DEV, "@/lib/atmosferas": ATMOSFERAS, "./nuevo": NUEVO },
  { falsos: true },
);

const NIVELES = await fuente("../lib/teclado/niveles.ts");
const z = await import(ZONAS);
const niv = await import(NIVELES);
const at = await import(ATAJOS);
const consola = await import(CONSOLA);
const reg = await import(REGISTRO);
const { COMANDOS_APP } = await import(APP);

const tecla = (code, mods = {}) => ({ code, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...mods });

// ── F6: el orden de las zonas ──────────────────────────────────────────────

test("F6 recorre las zonas con vuelta; desde fuera de todas, a la primera o la última", () => {
  assert.equal(z.zonaVecina(5, 0, 1), 1);
  assert.equal(z.zonaVecina(5, 4, 1), 0);
  assert.equal(z.zonaVecina(5, 0, -1), 4);
  assert.equal(z.zonaVecina(5, -1, 1), 0);
  assert.equal(z.zonaVecina(5, -1, -1), 4);
  assert.equal(z.zonaVecina(1, 0, 1), 0);
  assert.equal(z.zonaVecina(0, -1, 1), -1);
});

test("las zonas, en el orden de la ventana", () => {
  assert.deepEqual([...z.ZONAS], ["superior", "rail", "izquierda", "panel", "lateral", "estado"]);
});

// ── Ctrl+Alt+←/→: el panel contiguo ────────────────────────────────────────

const caja = (left, top, right, bottom) => ({ left, top, right, bottom });

test("dos paneles lado a lado: → va al de la derecha, ← vuelve", () => {
  const p = [
    { id: "a", caja: caja(0, 0, 500, 800) },
    { id: "b", caja: caja(504, 0, 1000, 800) },
  ];
  assert.equal(z.panelContiguo(p, "a", "derecha"), "b");
  assert.equal(z.panelContiguo(p, "b", "izquierda"), "a");
  assert.equal(z.panelContiguo(p, "a", "izquierda"), null);
  assert.equal(z.panelContiguo(p, "b", "derecha"), null);
});

test("con una columna partida a la derecha, se va al de arriba si se comparte más altura", () => {
  const p = [
    { id: "izq", caja: caja(0, 0, 500, 300) },
    { id: "arriba", caja: caja(504, 0, 1000, 400) },
    { id: "abajo", caja: caja(504, 404, 1000, 800) },
  ];
  assert.equal(z.panelContiguo(p, "izq", "derecha"), "arriba");
  assert.equal(z.panelContiguo(p, "abajo", "izquierda"), "izq");
});

test("paneles apilados: sin nadie al costado, el siguiente o el anterior en orden", () => {
  const p = [
    { id: "arriba", caja: caja(0, 0, 1000, 400) },
    { id: "abajo", caja: caja(0, 404, 1000, 800) },
  ];
  assert.equal(z.panelContiguo(p, "arriba", "derecha"), "abajo");
  assert.equal(z.panelContiguo(p, "abajo", "izquierda"), "arriba");
  assert.equal(z.panelContiguo(p, "abajo", "derecha"), null);
  assert.equal(z.panelContiguo(p, "nadie", "derecha"), null);
});

// ── el foco tras cambiar de pestaña ───────────────────────────────────────

test("tras Ctrl+Tab/Ctrl+W: se sigue escribiendo solo de editor a editor; la consola nunca", () => {
  assert.equal(z.modoTrasCambio(true, "editor"), "escribir");
  assert.equal(z.modoTrasCambio(true, "consola"), "navegar");
  assert.equal(z.modoTrasCambio(true, "otro"), "navegar");
  assert.equal(z.modoTrasCambio(false, "editor"), "navegar");
  assert.equal(z.modoTrasCambio(false, "consola"), "navegar");
});

test("la clase de documento de cada pestaña", () => {
  assert.equal(z.claseDeDocumento("nota", "markdown"), "editor");
  assert.equal(z.claseDeDocumento("nota", null), "editor");
  for (const t of ["canvas", "base", "excalidraw", "drawio"]) assert.equal(z.claseDeDocumento("nota", t), "otro", t);
  assert.equal(z.claseDeDocumento("terminal", null), "consola");
  for (const t of ["grafo", "calendario", "salud", "archivo", "enlaces"]) assert.equal(z.claseDeDocumento(t, null), "otro", t);
});

// ── Esc: salir de escribir ────────────────────────────────────────────────

test("Esc sale de escribir solo si no había nada que cerrar", () => {
  const foco = {};
  const base = { foco, valor: null, emergentes: 0 };
  assert.equal(z.escSaleDeEscribir(false, base, { ...base }), true);
  // Alguien atendió la tecla (el autocompletado de CodeMirror, un menú).
  assert.equal(z.escSaleDeEscribir(true, base, { ...base }), false);
  // Cerró algo y el foco se fue (la barra de búsqueda, la tarjeta del lienzo).
  assert.equal(z.escSaleDeEscribir(false, base, { ...base, foco: {} }), false);
  // Vació un buscador.
  assert.equal(z.escSaleDeEscribir(false, { ...base, valor: "hola" }, { ...base, valor: "" }), false);
  // Se cerró un emergente.
  assert.equal(z.escSaleDeEscribir(false, { ...base, emergentes: 1 }, base), false);
  // Uno que se abre no cuenta como cierre.
  assert.equal(z.escSaleDeEscribir(false, base, { ...base, emergentes: 1 }), true);
});

// ── la consola ────────────────────────────────────────────────────────────

test("la consola deja pasar F6, la paleta, Ctrl+O, Ctrl+Tab, Ctrl+\\, Ctrl+, y F1", () => {
  for (const e of [
    tecla("F6"),
    tecla("F6", { shiftKey: true }),
    tecla("F1"),
    tecla("KeyP", { ctrlKey: true }),
    tecla("KeyP", { ctrlKey: true, shiftKey: true }),
    tecla("KeyO", { ctrlKey: true }),
    tecla("Tab", { ctrlKey: true }),
    tecla("Tab", { ctrlKey: true, shiftKey: true }),
    tecla("Backslash", { ctrlKey: true }),
    tecla("Comma", { ctrlKey: true }),
    // Los accesos por el teclado numérico (niveles): también sacan de la consola.
    tecla("Numpad1", { ctrlKey: true }),
    tecla("Numpad3", { ctrlKey: true }),
    tecla("Numpad5", { ctrlKey: true }),
  ]) {
    assert.equal(consola.teclaSaleDeLaConsola(e), true, JSON.stringify(e));
  }
});

test("la consola se queda con lo de la shell: Ctrl+W, Ctrl+Shift+T, Ctrl+C, Ctrl+V, Esc, Tab, letras", () => {
  for (const e of [
    tecla("KeyW", { ctrlKey: true }),
    tecla("KeyT", { ctrlKey: true, shiftKey: true }),
    tecla("KeyC", { ctrlKey: true }),
    tecla("KeyV", { ctrlKey: true }),
    tecla("KeyR", { ctrlKey: true }),
    tecla("Escape"),
    tecla("Tab"),
    tecla("KeyP"),
    tecla("ArrowLeft", { altKey: true }),
    // Ctrl+flechas (moverse en el nivel) son de la shell: saltar de palabra.
    tecla("ArrowLeft", { ctrlKey: true }),
    tecla("ArrowUp", { ctrlKey: true }),
    tecla("ArrowUp", { ctrlKey: true, altKey: true }),
  ]) {
    assert.equal(consola.teclaSaleDeLaConsola(e), false, JSON.stringify(e));
  }
});

test("cada tecla que la consola deja pasar es el atajo de un comando de la app", () => {
  for (const { atajo, para } of consola.TECLAS_QUE_SALEN_DE_LA_CONSOLA) {
    const c = COMANDOS_APP.find((x) => x.id === para);
    assert.ok(c, `no existe el comando «${para}»`);
    assert.ok(
      c.atajos?.some((a) => at.mismoAtajo(a, atajo)),
      `${at.textoAtajo(atajo)} no es un atajo de «${para}»`,
    );
  }
});

// ── los comandos nuevos ───────────────────────────────────────────────────

const NUEVOS = [
  "zona.siguiente",
  "zona.anterior",
  "nivel.izquierda",
  "nivel.derecha",
  "nivel.arriba",
  "nivel.abajo",
  "nivel.entrar",
  "zona.rail",
  "zona.izquierda",
  "zona.pestanas",
  "zona.enlaces",
  "zona.estado",
];

test("los comandos de zonas y paneles existen, con su atajo", () => {
  const atajo = (id) => at.textoAtajo(COMANDOS_APP.find((c) => c.id === id).atajos[0]);
  assert.equal(atajo("zona.siguiente"), "F6");
  assert.equal(atajo("zona.anterior"), "Shift+F6");
  assert.equal(atajo("nivel.izquierda"), "Ctrl+←");
  assert.equal(atajo("nivel.abajo"), "Ctrl+↓");
  assert.equal(atajo("nivel.entrar"), "Enter");
  // Salir: Alt solo o Esc (los dos para la hoja).
  const salir = COMANDOS_APP.find((c) => c.id === "nivel.salir");
  assert.deepEqual(salir.atajos.map((a) => at.textoAtajo(a)), ["Alt", "Esc"]);
  assert.equal(salir.manejadorPropio, true);
  assert.equal(atajo("zona.rail"), "Ctrl+Num 1");
  assert.equal(atajo("zona.estado"), "Ctrl+Num 5");
  // Los paneles contiguos quedan sin atajo (chocaban con AltGr), en la paleta.
  for (const id of ["panel.izquierda", "panel.derecha"]) {
    const c = COMANDOS_APP.find((x) => x.id === id);
    assert.equal(c.atajos?.length ?? 0, 0, id);
    assert.notEqual(c.enPaleta, false, id);
  }
});

test("ningún atajo nuevo es una tecla reservada ni una letra o un dígito sin Ctrl ni Alt", () => {
  for (const id of NUEVOS) {
    const c = COMANDOS_APP.find((x) => x.id === id);
    for (const a of c.atajos) {
      assert.equal(at.reservaQueChoca(a, id), null, `${id}: ${at.textoAtajo(a)}`);
      const imprime = /^(Key|Digit|Numpad)/.test(a.code) || a.code === "Space";
      assert.ok(!imprime || a.ctrl || a.alt, `${id}: ${at.textoAtajo(a)} se escribiría`);
    }
  }
  // Ctrl+Alt+↑/↓ quedan para el multicursor de CodeMirror.
  for (const code of ["ArrowUp", "ArrowDown"]) {
    assert.equal(reg.comandoParaTecla(tecla(code, { ctrlKey: true, altKey: true }), COMANDOS_APP, false), null);
  }
});

test("F6 y Shift+F6 se atienden en captura; Ctrl+flechas, en burbuja", () => {
  assert.equal(reg.comandoParaTecla(tecla("F6"), COMANDOS_APP, false, "captura")?.id, "zona.siguiente");
  assert.equal(reg.comandoParaTecla(tecla("F6", { shiftKey: true }), COMANDOS_APP, false, "captura")?.id, "zona.anterior");
  assert.equal(reg.comandoParaTecla(tecla("F6"), COMANDOS_APP, false, "burbuja"), null);
  const izq = tecla("ArrowLeft", { ctrlKey: true });
  assert.equal(reg.comandoParaTecla(izq, COMANDOS_APP, false)?.id, "nivel.izquierda");
  assert.equal(reg.comandoParaTecla(izq, COMANDOS_APP, false, "captura"), null);
  // En captura no se cuela ningún atajo de burbuja.
  assert.equal(reg.comandoParaTecla(tecla("KeyW", { ctrlKey: true }), COMANDOS_APP, false, "captura"), null);
});

test("ningún comando de la app usa una letra o un dígito sin Ctrl ni Alt (modo escribir)", () => {
  for (const c of COMANDOS_APP) {
    for (const a of c.atajos ?? []) {
      const imprime = /^(Key|Digit|Numpad)/.test(a.code) || a.code === "Space";
      assert.ok(!imprime || a.ctrl || a.alt, `${c.id}: ${at.textoAtajo(a)}`);
    }
  }
});

// ── los niveles (rediseño tras la revisión del usuario, 2026-11-06) ───────


test("Esc sale un nivel: escribiendo → documento → sección; en las secciones, nada", () => {
  assert.equal(niv.destinoDeEsc("dentro"), "documento");
  assert.equal(niv.destinoDeEsc("documento"), "seccion");
  assert.equal(niv.destinoDeEsc("elemento"), "seccion");
  assert.equal(niv.destinoDeEsc("contenido-de-pestana"), "pestana");
  assert.equal(niv.destinoDeEsc("seccion"), null);
  assert.equal(niv.destinoDeEsc("fuera"), null);
});

test("Enter entra un nivel según dónde esté el foco", () => {
  assert.equal(niv.entradaDe("seccion", false), "a-la-seccion");
  assert.equal(niv.entradaDe("documento", false), "al-documento");
  assert.equal(niv.entradaDe("elemento", true), "pestana");
  assert.equal(niv.entradaDe("elemento", false), "activar");
  assert.equal(niv.entradaDe("dentro", false), "activar");
  assert.equal(niv.entradaDe("fuera", false), null);
});

test("Tab no recorre el workspace; sí los diálogos y lo que usa Tab", () => {
  assert.equal(niv.tabRecorre({ enDialogo: false, enComponenteConTab: false, enWorkspace: true }), false);
  assert.equal(niv.tabRecorre({ enDialogo: true, enComponenteConTab: false, enWorkspace: true }), true);
  assert.equal(niv.tabRecorre({ enDialogo: false, enComponenteConTab: true, enWorkspace: true }), true);
  // Fuera del workspace (un aviso suelto), Tab es lo único que hay.
  assert.equal(niv.tabRecorre({ enDialogo: false, enComponenteConTab: false, enWorkspace: false }), true);
});

test("las flechas de un componente: Ctrl cuenta solo dentro de un documento; Alt nunca", () => {
  const e = (m = {}) => ({ ctrlKey: false, altKey: false, metaKey: false, ...m });
  assert.equal(niv.flechaDelComponente(e(), false), true);
  assert.equal(niv.flechaDelComponente(e({ ctrlKey: true }), true), true);
  assert.equal(niv.flechaDelComponente(e({ metaKey: true }), true), true);
  assert.equal(niv.flechaDelComponente(e({ ctrlKey: true }), false), false);
  assert.equal(niv.flechaDelComponente(e({ altKey: true }), true), false);
  assert.equal(niv.flechaDelComponente(e({ altKey: true }), false), false);
});

// ── las teclas de la segunda vuelta (2026-11-06): Ctrl+flechas y Alt solo ──

test("Ctrl+flechas se mueve en el nivel; Alt+flechas ya no", () => {
  for (const [code, id] of [
    ["ArrowLeft", "nivel.izquierda"],
    ["ArrowRight", "nivel.derecha"],
    ["ArrowUp", "nivel.arriba"],
    ["ArrowDown", "nivel.abajo"],
  ]) {
    assert.equal(reg.comandoParaTecla(tecla(code, { ctrlKey: true }), COMANDOS_APP, false)?.id, id);
    assert.equal(reg.comandoParaTecla(tecla(code, { altKey: true }), COMANDOS_APP, false), null, "Alt+" + code);
    // Ctrl+Shift+flechas (seleccionar de a palabra, mover una tarjeta) no es moverse.
    assert.equal(reg.comandoParaTecla(tecla(code, { ctrlKey: true, shiftKey: true }), COMANDOS_APP, false), null);
  }
  // Ningún otro comando de la app usa Ctrl+flechas.
  for (const c of COMANDOS_APP) {
    if (c.id.startsWith("nivel.")) continue;
    for (const a of c.atajos ?? []) {
      assert.ok(!(a.ctrl && !a.alt && !a.shift && a.code.startsWith("Arrow")), c.id + ": " + at.textoAtajo(a));
    }
  }
});

test("Ctrl+flechas: escribiendo es del editor; en un campo, ←/→ es del campo y ↑/↓ sale", () => {
  const ctx = (m = {}) => ({ escribiendo: false, enCampoDeTexto: false, ...m });
  for (const dir of ["izquierda", "derecha", "arriba", "abajo"]) {
    assert.equal(niv.ctrlFlechaMueve(ctx(), dir), true, dir);
    // El editor, la consola, Excalidraw (el `contenteditable` del editor no cuenta como campo).
    assert.equal(niv.ctrlFlechaMueve(ctx({ escribiendo: true }), dir), false, dir);
    assert.equal(niv.ctrlFlechaMueve(ctx({ escribiendo: true, enCampoDeTexto: true }), dir), false, dir);
  }
  assert.equal(niv.ctrlFlechaMueve(ctx({ enCampoDeTexto: true }), "izquierda"), false);
  assert.equal(niv.ctrlFlechaMueve(ctx({ enCampoDeTexto: true }), "derecha"), false);
  assert.equal(niv.ctrlFlechaMueve(ctx({ enCampoDeTexto: true }), "arriba"), true);
  assert.equal(niv.ctrlFlechaMueve(ctx({ enCampoDeTexto: true }), "abajo"), true);
});

/** Pasa una secuencia de teclas por la máquina de Alt solo; devuelve si al final salió. */
function altSolo(pasos) {
  let estado = false;
  let salio = false;
  for (const [tipo, code, mods = {}] of pasos) {
    const e = { code, ctrlKey: false, shiftKey: false, metaKey: false, altGr: false, ...mods };
    if (tipo === "baja") estado = niv.altSoloAlBajar(e);
    else if (code === "AltLeft") {
      salio = niv.altSoloAlSoltar(estado, e);
      estado = false;
    }
  }
  return salio;
}

test("Alt solo sale; Alt con otra tecla en el medio, no; AltGr y el Alt derecho, tampoco", () => {
  assert.equal(altSolo([["baja", "AltLeft"], ["sube", "AltLeft"]]), true);
  // Mantenerlo apretado (la repetición) sigue siendo Alt solo.
  assert.equal(altSolo([["baja", "AltLeft"], ["baja", "AltLeft"], ["sube", "AltLeft"]]), true);
  // Alt+Tab, Alt+flecha, Alt+F4, Alt+Shift (cambiar el idioma), Alt+código numérico: no.
  for (const otra of ["Tab", "ArrowLeft", "F4", "ShiftLeft", "KeyD", "Numpad6"]) {
    assert.equal(altSolo([["baja", "AltLeft"], ["baja", otra], ["sube", "AltLeft"]]), false, otra);
  }
  // Ctrl apretado antes (Ctrl+Alt) o Shift al soltar: no.
  assert.equal(
    altSolo([["baja", "ControlLeft"], ["baja", "AltLeft", { ctrlKey: true }], ["sube", "AltLeft", { ctrlKey: true }]]),
    false,
  );
  assert.equal(altSolo([["baja", "AltLeft"], ["sube", "AltLeft", { shiftKey: true }]]), false);
  // AltGr (en Windows: ControlLeft + AltRight, con AltGraph) y el Alt derecho solo: no.
  assert.equal(
    altSolo([
      ["baja", "ControlLeft"],
      ["baja", "AltRight", { ctrlKey: true, altGr: true }],
      ["sube", "AltRight", { altGr: true }],
    ]),
    false,
  );
  assert.equal(altSolo([["baja", "AltRight"], ["sube", "AltRight"]]), false);
  assert.equal(altSolo([["baja", "AltLeft", { altGr: true }], ["sube", "AltLeft", { altGr: true }]]), false);
});

test("Alt solo no es un atajo que se pueda grabar ni guardar", () => {
  assert.equal(at.atajoDeEvento(tecla("AltLeft", { altKey: true })), null);
  assert.equal(at.atajoValido({ code: "AltLeft" }), null);
  assert.equal(at.textoAtajo({ code: "AltLeft" }), "Alt");
});

// La ventana de prueba: barra superior, rail, panel izquierdo, dos paneles
// (el izquierdo con su panel de enlaces adentro) y la barra de estado.
const SECCIONES = {
  superior: caja(0, 0, 1200, 30),
  rail: caja(0, 30, 40, 780),
  izquierda: caja(40, 30, 300, 780),
  panelA: caja(300, 30, 750, 780),
  lateral: caja(550, 70, 750, 780),
  panelB: caja(750, 30, 1200, 780),
  estado: caja(0, 780, 1200, 800),
};
const lista = (excepto) =>
  Object.entries(SECCIONES)
    .filter(([id]) => id !== excepto)
    .map(([id, c]) => ({ id, caja: c }));
const ir = (desde, dir) => niv.vecinoPorCajas(SECCIONES[desde], lista(desde), dir)?.id ?? null;

test("Ctrl+flechas entre secciones: a la más cercana en esa dirección", () => {
  assert.equal(ir("rail", "derecha"), "izquierda");
  assert.equal(ir("izquierda", "izquierda"), "rail");
  assert.equal(ir("izquierda", "derecha"), "panelA");
  assert.equal(ir("izquierda", "arriba"), "superior");
  assert.equal(ir("panelA", "abajo"), "estado");
  assert.equal(ir("estado", "arriba") !== null, true);
  // El panel de enlaces vive dentro de su panel: es lo primero a la derecha…
  assert.equal(ir("panelA", "derecha"), "lateral");
  // …y de ahí se sigue al otro panel, o se vuelve al suyo.
  assert.equal(ir("lateral", "derecha"), "panelB");
  assert.equal(ir("lateral", "izquierda"), "panelA");
  assert.equal(ir("panelB", "izquierda"), "lateral");
  // Sin nada de ese lado, null (no se sale del nivel).
  assert.equal(ir("superior", "arriba"), null);
  assert.equal(ir("panelB", "derecha"), null);
});

test("Ctrl+flechas dentro de una sección: del primer archivo a los botones de arriba, y de vuelta", () => {
  // El explorador: una barra con tres botones chicos y filas anchas debajo.
  const botones = [
    { id: "nueva", caja: caja(50, 40, 74, 64) },
    { id: "carpeta", caja: caja(80, 40, 104, 64) },
    { id: "ordenar", caja: caja(260, 40, 284, 64) },
  ];
  const filas = [0, 1, 2, 3, 4].map((i) => ({ id: `fila${i}`, caja: caja(44, 72 + i * 24, 296, 94 + i * 24) }));
  const todos = [...botones, ...filas];
  const desde = (id, dir) => {
    const o = todos.find((x) => x.id === id);
    return niv.vecinoPorCajas(o.caja, todos.filter((x) => x !== o), dir)?.id ?? null;
  };
  // Ctrl+↑ desde la primera fila sube a un botón (no se queda en la fila).
  assert.ok(botones.some((b) => b.id === desde("fila0", "arriba")));
  // Desde cualquier botón, Ctrl+↓ va a la PRIMERA fila, no a una más abajo
  // (con centros, desde el botón de la derecha se iba a la quinta).
  for (const b of botones) assert.equal(desde(b.id, "abajo"), "fila0", b.id);
  assert.equal(desde("fila2", "abajo"), "fila3");
  assert.equal(desde("fila2", "arriba"), "fila1");
  assert.equal(desde("nueva", "derecha"), "carpeta");
  assert.equal(desde("carpeta", "derecha"), "ordenar");
  assert.equal(desde("ordenar", "derecha"), null);
  assert.equal(desde("fila4", "abajo"), null);
});

// ── los grupos de una sección (pedido del usuario, 2026-11-06) ────────────

test("grupos: Esc del árbol vuelve al título de Archivos, y de ahí a la sección", () => {
  // Un elemento dentro de un grupo (una fila del árbol, un botón de la barra).
  assert.equal(niv.destinoDeEsc("elemento", true), "grupo");
  // El título de un grupo de la sección: a la sección elegida.
  assert.equal(niv.destinoDeEsc("grupo", false), "seccion");
  // El título de un grupo dentro de otro grupo: al título del de afuera.
  assert.equal(niv.destinoDeEsc("grupo", true), "grupo");
  // Sin grupos, como siempre.
  assert.equal(niv.destinoDeEsc("elemento", false), "seccion");
  assert.equal(niv.destinoDeEsc("dentro", false), "documento");
  assert.equal(niv.destinoDeEsc("contenido-de-pestana", true), "pestana");
  assert.equal(niv.destinoDeEsc("seccion", true), null);
});

test("grupos: Enter sobre el título entra al grupo (no lo pliega)", () => {
  assert.equal(niv.entradaDe("grupo", false), "al-grupo");
  // Adentro, Enter sigue siendo de la fila o del botón.
  assert.equal(niv.entradaDe("elemento", false), "activar");
});

test("grupos: ← pliega, → despliega y, desplegado, entra; sin plegado, → entra", () => {
  assert.equal(niv.flechaEnGrupo("izquierda", true), "plegar");
  assert.equal(niv.flechaEnGrupo("izquierda", false), null);
  assert.equal(niv.flechaEnGrupo("derecha", false), "desplegar");
  assert.equal(niv.flechaEnGrupo("derecha", true), "entrar");
  // La barra de botones no se pliega.
  assert.equal(niv.flechaEnGrupo("derecha", null), "entrar");
  assert.equal(niv.flechaEnGrupo("izquierda", null), null);
});

test("grupos: Ctrl+flechas no sale del grupo; desde un título, entre los grupos", () => {
  // Dentro de un grupo (el árbol), solo entre sus elementos.
  assert.equal(niv.nivelDeMovimiento("elemento", true), "grupo");
  // Desde el título de un grupo de la sección, entre los grupos y lo suelto.
  assert.equal(niv.nivelDeMovimiento("grupo", false), "seccion");
  // Desde el título de un grupo anidado, entre los de su grupo.
  assert.equal(niv.nivelDeMovimiento("grupo", true), "grupo");
  // Lo de siempre.
  assert.equal(niv.nivelDeMovimiento("seccion"), "secciones");
  assert.equal(niv.nivelDeMovimiento("elemento"), "seccion");
  assert.equal(niv.nivelDeMovimiento("documento"), "seccion");
  assert.equal(niv.nivelDeMovimiento("dentro"), "documento");
  assert.equal(niv.nivelDeMovimiento("fuera"), null);
});

test("grupos: los títulos del explorador, uno debajo del otro, se recorren con Ctrl+↑/↓", () => {
  // La barra de botones (sin título: el grupo entero), la Bandeja y Archivos.
  const grupos = [
    { id: "herramientas", caja: caja(44, 40, 296, 66) },
    { id: "bandeja", caja: caja(44, 70, 296, 90) },
    { id: "archivos", caja: caja(44, 150, 296, 170) },
  ];
  const desde = (id, dir) => {
    const o = grupos.find((x) => x.id === id);
    return niv.vecinoPorCajas(o.caja, grupos.filter((x) => x !== o), dir)?.id ?? null;
  };
  assert.equal(desde("herramientas", "abajo"), "bandeja");
  assert.equal(desde("bandeja", "abajo"), "archivos");
  assert.equal(desde("archivos", "arriba"), "bandeja");
  assert.equal(desde("archivos", "abajo"), null);
  assert.equal(desde("bandeja", "derecha"), null);
});
