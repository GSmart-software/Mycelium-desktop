// Test de los atajos configurables y la hoja de atajos (`FUN-XL-04`, Parte 3):
// grabar y normalizar combinaciones (`lib/comandos/atajos.ts`), las
// sobreescrituras del usuario, los conflictos, las reservadas y la prohibición
// de la letra sola (`lib/comandos/personalizar.ts`), el despachador y la hoja
// con las personalizaciones (`lib/comandos/registro.ts`), la lista de teclas
// que salen de la consola (`lib/comandos/teclasConsola.ts`), los comandos
// nuevos de la app y los atajos dinámicos de la ayuda (`lib/ayuda/render.ts`).
//
// Los módulos se transpilan en el momento, como en `scripts/test-comandos.mjs`.
//
//   node --test scripts/test-atajos.mjs
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
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

const MODO_DEV = await fuente("../lib/modoDev.ts");
const ATAJOS = await fuente("../lib/comandos/atajos.ts");
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
const RENDER = await fuente("../lib/ayuda/render.ts", {}, { falsos: true });

const at = await import(ATAJOS);
const per = await import(PERSONALIZAR);
const reg = await import(REGISTRO);
const consola = await import(CONSOLA);
const { COMANDOS_APP } = await import(APP);
const render = await import(RENDER);

const tecla = (code, mods = {}) => ({ code, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...mods });
const cmd = (id, atajos, extra = {}) => ({ id, titulo: id, icono: null, categoria: "app", atajos, ejecutar() {}, ...extra });

// ── grabar y normalizar ────────────────────────────────────────────────────

test("grabar: el `code` y los modificadores exactos; Cmd es Ctrl; un modificador solo no es un atajo", () => {
  assert.deepEqual(at.atajoDeEvento(tecla("KeyK", { ctrlKey: true, shiftKey: true })), { code: "KeyK", ctrl: true, shift: true });
  assert.deepEqual(at.atajoDeEvento(tecla("KeyK", { metaKey: true })), { code: "KeyK", ctrl: true });
  assert.deepEqual(at.atajoDeEvento(tecla("F7")), { code: "F7" });
  for (const code of ["ControlLeft", "ShiftRight", "AltLeft", "MetaLeft", "AltRight"]) {
    assert.equal(at.atajoDeEvento(tecla(code, { ctrlKey: true })), null, code);
  }
  assert.equal(at.atajoDeEvento(tecla("MediaPlayPause", { ctrlKey: true })), null);
});

test("Digit1 y Numpad1 se graban y se muestran distintos", () => {
  const fila = at.atajoDeEvento(tecla("Digit1", { ctrlKey: true }));
  const num = at.atajoDeEvento(tecla("Numpad1", { ctrlKey: true }));
  assert.equal(at.mismoAtajo(fila, num), false);
  assert.equal(at.textoAtajo(fila), "Ctrl+1");
  assert.equal(at.textoAtajo(num), "Ctrl+Num 1");
  // Aunque la distribución diga otra cosa de los dígitos, se ven como dígitos.
  const fr = new Map([["Digit1", "&"]]);
  assert.equal(at.textoAtajo(fila, fr), "Ctrl+1");
});

test("con la distribución del usuario, las letras y la puntuación se ven como en su teclado", () => {
  const es = new Map([
    ["Semicolon", "ñ"],
    ["Backslash", "ç"],
    ["Slash", "-"],
    ["KeyQ", "q"],
  ]);
  assert.equal(at.textoAtajo({ ctrl: true, code: "Semicolon" }, es), "Ctrl+Ñ");
  assert.equal(at.textoAtajo({ ctrl: true, code: "Backslash" }, es), "Ctrl+Ç");
  assert.equal(at.textoAtajo({ ctrl: true, shift: true, code: "Slash" }, es), "Ctrl+Shift+-");
  assert.equal(at.textoAtajo({ ctrl: true, code: "KeyQ" }, es), "Ctrl+Q");
  // Sin distribución, los nombres de EE. UU.
  assert.equal(at.textoAtajo({ ctrl: true, code: "Backslash" }), "Ctrl+\\");
  // Las teclas que no son de posición no cambian.
  assert.equal(at.textoAtajo({ code: "F6" }, es), "F6");
});

test("atajoValido descarta lo que no es un atajo y limpia los modificadores", () => {
  assert.deepEqual(at.atajoValido({ code: "KeyP", ctrl: true, shift: false, alt: "si" }), { code: "KeyP", ctrl: true });
  assert.equal(at.atajoValido({ code: "Inventada" }), null);
  assert.equal(at.atajoValido("Ctrl+P"), null);
  assert.equal(at.atajoValido(null), null);
});

// ── lo que no se puede asignar ─────────────────────────────────────────────

test("una letra, un número o un signo sin Ctrl ni Alt no es un atajo; las F sí", () => {
  for (const a of [
    { code: "KeyA" },
    { shift: true, code: "KeyA" },
    { code: "Digit1" },
    { code: "Numpad1" },
    { code: "Semicolon" },
    { code: "Space" },
    { code: "Enter" },
    { code: "Tab" },
    { code: "ArrowLeft" },
  ]) {
    assert.ok(at.problemaDeAtajo(a), at.textoAtajo(a));
  }
  for (const a of [{ code: "F7" }, { shift: true, code: "F7" }, { ctrl: true, code: "KeyA" }, { alt: true, code: "KeyA" }, { ctrl: true, code: "Numpad1" }]) {
    assert.equal(at.problemaDeAtajo(a), null, at.textoAtajo(a));
  }
  // Ctrl+Alt+letra es AltGr en muchos teclados; Ctrl+Alt+flecha no.
  assert.ok(at.problemaDeAtajo({ ctrl: true, alt: true, code: "KeyQ" }));
  assert.equal(at.problemaDeAtajo({ ctrl: true, alt: true, code: "ArrowLeft" }), null);
});

test("las reservadas: Alt+Tab, la captura (salvo su dueño), las del sistema y las de editar texto", () => {
  const efectivos = per.calcularEfectivos(COMANDOS_APP, {});
  for (const a of [
    { alt: true, code: "Tab" },
    { ctrl: true, shift: true, code: "Space" },
    { code: "F12" },
    { ctrl: true, shift: true, code: "KeyI" },
    { code: "F5" },
    { ctrl: true, code: "KeyR" },
    { alt: true, code: "F4" },
    { ctrl: true, code: "KeyC" },
    { ctrl: true, code: "KeyV" },
    { ctrl: true, code: "KeyZ" },
  ]) {
    const choque = per.choqueDe(a, "nota.nueva", COMANDOS_APP, efectivos);
    assert.ok(choque && (choque.tipo === "reservada" || choque.tipo === "invalido"), at.textoAtajo(a));
  }
  assert.equal(at.reservaQueChoca({ ctrl: true, shift: true, code: "Space" }, "bandeja.capturar"), null);
});

test("conflicto con otro comando: se puede reemplazar; con uno fijo (F1), no", () => {
  const efectivos = per.calcularEfectivos(COMANDOS_APP, {});
  assert.deepEqual(per.choqueDe({ ctrl: true, code: "KeyO" }, "nota.nueva", COMANDOS_APP, efectivos), {
    tipo: "otro",
    id: "paleta.notas",
  });
  assert.deepEqual(per.choqueDe({ code: "F1" }, "nota.nueva", COMANDOS_APP, efectivos), { tipo: "fijo", id: "ayuda.abrir" });
  // El mismo comando no choca consigo.
  assert.equal(per.choqueDe({ ctrl: true, code: "KeyO" }, "paleta.notas", COMANDOS_APP, efectivos), null);
  // Una libre.
  assert.equal(per.choqueDe({ ctrl: true, code: "KeyN" }, "nota.nueva", COMANDOS_APP, efectivos), null);
});

// ── las sobreescrituras ────────────────────────────────────────────────────

const LISTA = [
  cmd("a.uno", [{ ctrl: true, code: "KeyO" }]),
  cmd("a.dos", [{ ctrl: true, code: "KeyP" }, { ctrl: true, shift: true, code: "KeyP" }]),
  cmd("a.tres", []),
  cmd("a.fijo", [{ code: "F1" }], { manejadorPropio: true }),
];

test("asignar, quitar y restaurar; lo que vuelve a ser de fábrica no queda guardado", () => {
  let s = per.asignarAtajo({}, LISTA, "a.tres", null, { ctrl: true, code: "KeyN" });
  assert.deepEqual(s, { "a.tres": [{ ctrl: true, code: "KeyN" }] });
  s = per.asignarAtajo(s, LISTA, "a.uno", 0, { ctrl: true, code: "KeyL" });
  assert.deepEqual(s["a.uno"], [{ ctrl: true, code: "KeyL" }]);
  s = per.quitarAtajo(s, LISTA, "a.dos", 0);
  assert.deepEqual(s["a.dos"], [{ ctrl: true, shift: true, code: "KeyP" }]);
  s = per.quitarAtajo(s, LISTA, "a.dos", 0);
  assert.equal(s["a.dos"], null, "sin atajos = null");
  s = per.restaurarAtajo(s, LISTA, "a.dos");
  assert.equal("a.dos" in s, false);
  // Volver a poner el de fábrica borra la sobreescritura.
  s = per.asignarAtajo(s, LISTA, "a.uno", 0, { ctrl: true, code: "KeyO" });
  assert.equal("a.uno" in s, false);
  // Un comando fijo no se personaliza.
  assert.deepEqual(per.asignarAtajo({}, LISTA, "a.fijo", 0, { code: "F2" }), {});
});

test("reemplazar: el comando que tenía la tecla la suelta y conserva el resto", () => {
  const s = per.asignarAtajo({}, LISTA, "a.tres", null, { ctrl: true, code: "KeyP" });
  assert.deepEqual(s["a.tres"], [{ ctrl: true, code: "KeyP" }]);
  assert.deepEqual(s["a.dos"], [{ ctrl: true, shift: true, code: "KeyP" }]);
  const ef = per.calcularEfectivos(LISTA, s);
  assert.equal(ef.desplazados.length, 0, "un reemplazo explícito no es un desplazado");
  // Restaurar a.dos le devuelve Ctrl+P y a.tres la suelta.
  const r = per.restaurarAtajo(s, LISTA, "a.dos");
  assert.equal("a.dos" in r, false);
  assert.equal("a.tres" in r, false, "a.tres vuelve a su fábrica: sin atajo");
});

test("un comando nuevo que choca con un atajo personalizado queda sin esa tecla, y se avisa", () => {
  // El usuario le dio Ctrl+K a a.tres; en una versión futura llega a.nuevo con Ctrl+K de fábrica.
  const sobre = { "a.tres": [{ ctrl: true, code: "KeyK" }] };
  const conNuevo = [...LISTA, cmd("a.nuevo", [{ ctrl: true, code: "KeyK" }, { ctrl: true, code: "KeyJ" }])];
  const ef = per.calcularEfectivos(conNuevo, sobre);
  assert.deepEqual(ef.porId.get("a.nuevo"), [{ ctrl: true, code: "KeyJ" }]);
  assert.deepEqual(ef.desplazados, [{ id: "a.nuevo", atajo: { ctrl: true, code: "KeyK" }, por: "a.tres" }]);
  // El despachador le da Ctrl+K al personalizado.
  assert.equal(reg.comandoParaTecla(tecla("KeyK", { ctrlKey: true }), conNuevo, false, "burbuja", sobre)?.id, "a.tres");
  assert.equal(reg.comandoParaTecla(tecla("KeyJ", { ctrlKey: true }), conNuevo, false, "burbuja", sobre)?.id, "a.nuevo");
});

test("normalizar lo guardado: descarta ids raros, teclas inválidas, reservadas y letras solas", () => {
  const s = per.normalizarSobreescrituras({
    "paleta.notas": [{ ctrl: true, code: "KeyL" }, { code: "KeyL" }, { alt: true, code: "Tab" }, { ctrl: true, code: "KeyL" }],
    "pestana.cerrar": null,
    "x": [{ ctrl: true, code: "KeyM" }],
    "nota.nueva": "Ctrl+N",
    "nota.buscar": [{ code: "Inventada" }],
  });
  assert.deepEqual(s, { "paleta.notas": [{ ctrl: true, code: "KeyL" }], "pestana.cerrar": null, "nota.buscar": null });
  assert.deepEqual(per.normalizarSobreescrituras("basura"), {});
  assert.deepEqual(per.normalizarSobreescrituras([1, 2]), {});
});

// ── el despachador y la hoja con las personalizaciones ────────────────────

test("el despachador usa los atajos de hoy: el nuevo funciona y el viejo ya no", () => {
  const sobre = per.asignarAtajo({}, COMANDOS_APP, "paleta.notas", 0, { ctrl: true, code: "KeyE" });
  assert.equal(reg.comandoParaTecla(tecla("KeyE", { ctrlKey: true }), COMANDOS_APP, false, "burbuja", sobre)?.id, "paleta.notas");
  assert.equal(reg.comandoParaTecla(tecla("KeyO", { ctrlKey: true }), COMANDOS_APP, false, "burbuja", sobre), null);
  // Las sobreescrituras en uso (las del registro) también valen por defecto.
  reg.fijarSobreescrituras(sobre);
  try {
    assert.equal(reg.comandoParaTecla(tecla("KeyE", { ctrlKey: true }), COMANDOS_APP, false)?.id, "paleta.notas");
    const { detalle } = reg.textoEnPaleta(COMANDOS_APP.find((c) => c.id === "atajos.hoja"), COMANDOS_APP);
    assert.match(detalle, /^Ctrl\+Shift\+\//);
  } finally {
    reg.fijarSobreescrituras({});
  }
});

test("Ctrl+1..4 son las vistas por la fila de números; Ctrl+Num1..4 quedan libres", () => {
  const ids = ["editor.vista-en-vivo", "editor.vista-dividido", "editor.vista-lectura", "editor.vista-crudo"];
  ids.forEach((id, i) => {
    assert.equal(reg.comandoParaTecla(tecla(`Digit${i + 1}`, { ctrlKey: true }), COMANDOS_APP, false)?.id, id);
    assert.equal(reg.comandoParaTecla(tecla(`Numpad${i + 1}`, { ctrlKey: true }), COMANDOS_APP, false), null);
  });
  // Con Shift o Alt, no.
  assert.equal(reg.comandoParaTecla(tecla("Digit1", { ctrlKey: true, shiftKey: true }), COMANDOS_APP, false), null);
});

test("la hoja: Ctrl+Shift+/ la abre, y refleja las personalizaciones", () => {
  assert.equal(reg.comandoParaTecla(tecla("Slash", { ctrlKey: true, shiftKey: true }), COMANDOS_APP, false)?.id, "atajos.hoja");
  const hoja = (sobre) =>
    reg.gruposDeAtajos(COMANDOS_APP, false, { soloConAtajo: true, sobre }).flatMap((g) => g.comandos.map((c) => c));
  const antes = hoja({});
  assert.ok(antes.every((c) => c.atajos.length > 0));
  assert.ok(!antes.some((c) => c.comando.id === "recordatorio.nuevo"), "sin atajo no está en la hoja");
  const sobre = per.asignarAtajo({}, COMANDOS_APP, "recordatorio.nuevo", null, { alt: true, code: "KeyR" });
  const despues = hoja(sobre);
  assert.deepEqual(despues.find((c) => c.comando.id === "recordatorio.nuevo")?.atajos, [
    { alt: true, code: "KeyR" },
  ]);
  // Quitarle el atajo a uno lo saca de la hoja.
  const sin = hoja({ "pestana.cerrar": null });
  assert.ok(!sin.some((c) => c.comando.id === "pestana.cerrar"));
});

test("sin el modo dev, sus comandos no están ni en la hoja ni en Configuración", () => {
  for (const soloConAtajo of [true, false]) {
    const sin = reg.gruposDeAtajos(COMANDOS_APP, false, { soloConAtajo, sobre: {} });
    assert.ok(!sin.some((g) => g.categoria === "dev" || g.comandos.some((c) => c.comando.soloDev)));
    const con = reg.gruposDeAtajos(COMANDOS_APP, true, { soloConAtajo, sobre: {} });
    assert.ok(con.some((g) => g.categoria === "dev"));
  }
  // Un choque con F12 no nombra al comando oculto: es una reservada.
  const visibles = COMANDOS_APP.filter((c) => !c.soloDev);
  const choque = per.choqueDe({ code: "F12" }, "nota.nueva", visibles, per.calcularEfectivos(COMANDOS_APP, {}));
  assert.equal(choque.tipo, "reservada");
  assert.doesNotMatch(choque.motivo, /desarrollador/);
});

test("la hoja agrupa en el orden de las categorías; el explorador, con su Ctrl+Shift+E", () => {
  const grupos = reg.gruposDeAtajos(COMANDOS_APP, false, { soloConAtajo: true, sobre: {} });
  const orden = Object.keys(reg.NOMBRE_CATEGORIA);
  const indices = grupos.map((g) => orden.indexOf(g.categoria));
  assert.deepEqual(indices, [...indices].sort((a, b) => a - b));
  // Desde la Parte 4 tiene un atajo propio y ya no presta el de Ctrl+\.
  const explorador = grupos.flatMap((g) => g.comandos).find((c) => c.comando.id === "explorador.alternar");
  assert.deepEqual(explorador?.atajos, [{ ctrl: true, shift: true, code: "KeyE" }]);
});

// ── la consola ─────────────────────────────────────────────────────────────

const filas = (sobre, prefs) => consola.filasConsola(COMANDOS_APP, per.calcularEfectivos(COMANDOS_APP, sobre).porId, prefs);
const fila = (lista, id, atajo) => lista.find((f) => f.id === id && at.mismoAtajo(f.atajo, atajo));

test("la lista de la consola: de fábrica como antes; Ctrl+W apagada; F6 fija", () => {
  const l = filas({}, {});
  for (const { atajo, para } of consola.TECLAS_QUE_SALEN_DE_LA_CONSOLA) {
    assert.equal(fila(l, para, atajo)?.sale, true, `${para} ${at.textoAtajo(atajo)}`);
  }
  assert.equal(fila(l, "pestana.cerrar", { ctrl: true, code: "KeyW" }).sale, false);
  assert.equal(fila(l, "zona.siguiente", { code: "F6" }).fija, true);
  // La captura rápida y las devtools escuchan en captura: no se ofrecen.
  assert.ok(!l.some((f) => f.id === "bandeja.capturar" || f.id === "dev.herramientas"));
});

test("la lista de la consola se cambia: Ctrl+P vuelve a la shell, Ctrl+W sale; F6 no se apaga", () => {
  const p = { ctrl: true, code: "KeyP" };
  const w = { ctrl: true, code: "KeyW" };
  const prefs = {
    [consola.claveFilaConsola("paleta.comandos", p)]: false,
    [consola.claveFilaConsola("pestana.cerrar", w)]: true,
    [consola.claveFilaConsola("zona.siguiente", { code: "F6" })]: false,
  };
  const l = filas({}, prefs);
  assert.equal(fila(l, "paleta.comandos", p).sale, false);
  assert.equal(fila(l, "paleta.comandos", { ctrl: true, shift: true, code: "KeyP" }).sale, true);
  assert.equal(fila(l, "pestana.cerrar", w).sale, true);
  assert.equal(fila(l, "zona.siguiente", { code: "F6" }).sale, true);
  // Y teclaSaleDeLaConsola, con los comandos registrados, lo respeta.
  const baja = reg.registrarComandos(COMANDOS_APP);
  consola.fijarPrefsConsola(prefs);
  try {
    assert.equal(consola.teclaSaleDeLaConsola(tecla("KeyP", { ctrlKey: true })), false);
    assert.equal(consola.teclaSaleDeLaConsola(tecla("KeyW", { ctrlKey: true })), true);
    assert.equal(consola.teclaSaleDeLaConsola(tecla("F6")), true);
    assert.equal(consola.teclaSaleDeLaConsola(tecla("KeyC", { ctrlKey: true })), false);
  } finally {
    consola.fijarPrefsConsola({});
    baja();
  }
});

test("un atajo nuevo de un comando que sale de la consola sale también", () => {
  const sobre = per.asignarAtajo({}, COMANDOS_APP, "paleta.notas", 0, { ctrl: true, code: "KeyE" });
  const l = filas(sobre, {});
  assert.equal(fila(l, "paleta.notas", { ctrl: true, code: "KeyE" }).sale, true);
  assert.equal(fila(l, "paleta.notas", { ctrl: true, code: "KeyO" }), undefined);
});

test("normalizar las preferencias de la consola", () => {
  assert.deepEqual(consola.normalizarPrefsConsola({ "paleta.comandos|ctrl+KeyP": false, "x": "si", "a|<script>": true }), {
    "paleta.comandos|ctrl+KeyP": false,
  });
});

// ── la ayuda ───────────────────────────────────────────────────────────────

test("los atajos dinámicos de la ayuda: el de hoy, el de fábrica sin comando, «sin atajo»", () => {
  const cuerpo = "| {{atajo:panel-izquierdo.alternar|Ctrl+\\}} | panel |";
  assert.equal(render.sustituirAtajos(cuerpo), "| **Ctrl+\\\\** | panel |");
  assert.equal(render.sustituirAtajos(cuerpo, () => ["Ctrl+Ç"]), "| **Ctrl+Ç** | panel |");
  assert.equal(render.sustituirAtajos(cuerpo, () => ["Ctrl+P", "Ctrl+Shift+P"]), "| **Ctrl+P** o **Ctrl+Shift+P** | panel |");
  assert.equal(render.sustituirAtajos(cuerpo, () => null), "| *sin atajo* | panel |");
  assert.equal(render.sustituirAtajos("{{atajo:x.y|A|B}}"), "**A\\|B**");
});

test("cada {{atajo:…}} de la ayuda nombra un comando que existe, con su atajo de fábrica", () => {
  const raiz = fileURLToPath(new URL("../ayuda", import.meta.url));
  const archivos = [];
  const recorrer = (d) => {
    for (const n of readdirSync(d)) {
      const r = join(d, n);
      if (statSync(r).isDirectory()) recorrer(r);
      else if (n.endsWith(".md")) archivos.push(r);
    }
  };
  recorrer(raiz);
  let vistos = 0;
  for (const archivo of archivos) {
    for (const [, id, fabrica] of readFileSync(archivo, "utf8").matchAll(render.RE_ATAJO)) {
      vistos++;
      const c = COMANDOS_APP.find((x) => x.id === id);
      assert.ok(c, `${archivo}: no existe el comando «${id}»`);
      assert.ok(c.atajos?.length, `${id} no tiene atajo de fábrica`);
      assert.equal(at.textoAtajo(c.atajos[0]), fabrica, `${archivo}: ${id}`);
    }
  }
  assert.ok(vistos >= 10, `solo ${vistos} atajos dinámicos`);
});

// ── el editor ──────────────────────────────────────────────────────────────

test("el editor le deja a la app Ctrl+I (cursiva) y Ctrl+Shift+\\ (panel de enlaces)", async () => {
  // CodeMirror trae esas dos teclas en su keymap por defecto…
  const { defaultKeymap } = await import("@codemirror/commands");
  const BARRA = String.fromCharCode(92);
  const quitadas = ["Mod-i", `Shift-Mod-${BARRA}`];
  for (const k of quitadas) assert.ok(defaultKeymap.some((b) => b.key === k), `CodeMirror ya no trae ${k}`);
  // …y NoteEditor las filtra antes de armar el suyo, y usa el filtrado.
  const editor = readFileSync(fileURLToPath(new URL("../components/editor/NoteEditor.tsx", import.meta.url)), "utf8");
  assert.match(editor, /const KEYMAP_BASE = defaultKeymap\.filter\(\(k\) => k\.key !== "Mod-i" && k\.key !== "Shift-Mod-\\\\"\)/);
  assert.match(editor, /keymap\.of\(\[\.\.\.KEYMAP_BASE,/);
  assert.doesNotMatch(editor, /keymap\.of\(\[\.\.\.defaultKeymap/);
  // El formato sigue teniendo Mod-i → cursiva.
  assert.match(editor, /\{ key: "Mod-i", run: \(v\) => \(wrapSelection\(v, "\*"\), true\) \}/);
  // Y ya no hay un Ctrl+1..4 por `e.key` (confundía el teclado numérico).
  assert.doesNotMatch(editor, /\["1", "2", "3", "4"\]\.indexOf/);
});
