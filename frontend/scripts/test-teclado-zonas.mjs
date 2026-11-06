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

const z = await import(ZONAS);
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
  assert.deepEqual([...z.ZONAS], ["rail", "izquierda", "panel", "lateral", "estado"]);
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
    tecla("ArrowLeft", { ctrlKey: true, altKey: true }),
    tecla("ArrowRight", { ctrlKey: true, altKey: true }),
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

const NUEVOS = ["zona.siguiente", "zona.anterior", "panel.izquierda", "panel.derecha"];

test("los comandos de zonas y paneles existen, con su atajo", () => {
  const atajo = (id) => at.textoAtajo(COMANDOS_APP.find((c) => c.id === id).atajos[0]);
  assert.equal(atajo("zona.siguiente"), "F6");
  assert.equal(atajo("zona.anterior"), "Shift+F6");
  assert.equal(atajo("panel.izquierda"), "Ctrl+Alt+←");
  assert.equal(atajo("panel.derecha"), "Ctrl+Alt+→");
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

test("F6 y Shift+F6 se atienden en captura; Ctrl+Alt+←/→, en burbuja", () => {
  assert.equal(reg.comandoParaTecla(tecla("F6"), COMANDOS_APP, false, "captura")?.id, "zona.siguiente");
  assert.equal(reg.comandoParaTecla(tecla("F6", { shiftKey: true }), COMANDOS_APP, false, "captura")?.id, "zona.anterior");
  assert.equal(reg.comandoParaTecla(tecla("F6"), COMANDOS_APP, false, "burbuja"), null);
  const izq = tecla("ArrowLeft", { ctrlKey: true, altKey: true });
  assert.equal(reg.comandoParaTecla(izq, COMANDOS_APP, false)?.id, "panel.izquierda");
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
