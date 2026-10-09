// Test de la plantilla de snippets de CSS (`DEF-123`): `public/plantilla-estilos.css`,
// la que baja «Descargar plantilla» y con la que nace un snippet nuevo.
//
// La plantilla envejeció en silencio: cubría 18 de casi cien variables y no
// conocía nada de lo que llegó después de junio de 2026, porque nadie la tenía en
// la lista de cosas a tocar al agregar una superficie. Este test la ata al código:
//
// 1. Tal como se entrega no cambia nada (todo es comentario) y cada ejemplo,
//    descomentado, es CSS válido.
// 2. Cada variable `--mic-*` y cada clase `.mic-*` que nombra existe hoy en el
//    estilo o en el código. Si se renombra algo, este test falla.
// 3. Cada variable de `styles/tokens.css` está en la plantilla o en la lista de
//    exclusión de abajo, con su motivo. Así, agregar un token obliga a decidir si
//    el usuario lo puede tocar.
//
// Convención de la plantilla que el test usa: un EJEMPLO es un comentario que
// abre con `/*` solo en su línea (el texto empieza con un salto de línea); las
// explicaciones abren con `/* ` y texto en la misma línea.
//
//   node --test scripts/test-plantilla-estilos.mjs
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import postcss from "postcss";
import { parser as parserCss } from "@lezer/css";

const FRONTEND = join(dirname(fileURLToPath(import.meta.url)), "..");
const PLANTILLA = readFileSync(join(FRONTEND, "public/plantilla-estilos.css"), "utf8");
const TOKENS = readFileSync(join(FRONTEND, "styles/tokens.css"), "utf8");

/**
 * Variables de `tokens.css` que la plantilla NO ofrece, a propósito. Cada una con
 * su motivo: si un token nuevo cae acá, que sea por una decisión y no por olvido.
 */
const EXCLUIDOS = new Map([
  // Lo definen tokens.css y las atmósferas, pero hoy ningún componente lo lee
  // (el fondo de un callout sale de --mic-callout-color). Ofrecerlo sería
  // prometer un cambio que no se ve.
  ["--mic-callout-bg", "sin uso en la interfaz"],
  // Estructura de la ventana: medidas que el layout usa en cálculos cruzados
  // (alturas de las barras, el rail, los paneles). Cambiarlas desde un snippet
  // desarma la ventana, y el ancho del panel lo pisa el arrastre del usuario.
  ["--mic-topbar-height", "estructura de la ventana"],
  ["--mic-toolbar-height", "estructura de la ventana"],
  ["--mic-statusbar-height", "estructura de la ventana"],
  ["--mic-rail-width", "estructura de la ventana"],
  ["--mic-gap-inferior", "estructura de la ventana"],
  ["--mic-panel-left-width", "estructura de la ventana (lo fija el arrastre)"],
  ["--mic-panel-handle-width", "estructura de la ventana"],
  ["--mic-panel-min-width", "estructura de la ventana"],
  ["--mic-panel-transition", "estructura de la ventana"],
  ["--mic-editor-min-width", "estructura de la ventana"],
]);

// ── Fuentes: el estilo y el código de la app ─────────────────────────────────

/** Archivos .css/.ts/.tsx de la app (sin la plantilla ni lo generado). */
function archivosDeLaApp() {
  const salida = [];
  const recorrer = (dir) => {
    for (const nombre of readdirSync(dir)) {
      if (["node_modules", ".next", "out"].includes(nombre)) continue;
      const ruta = join(dir, nombre);
      if (statSync(ruta).isDirectory()) recorrer(ruta);
      else if (/\.(css|tsx?)$/.test(nombre)) salida.push(ruta);
    }
  };
  for (const dir of ["styles", "app", "components", "lib", "stores"]) recorrer(join(FRONTEND, dir));
  // La ayuda generada cita la plantilla en su texto: contarla como «código» haría
  // que la plantilla se validara contra sí misma.
  return salida.filter((r) => !relative(FRONTEND, r).replace(/\\/g, "/").startsWith("lib/ayuda/paginasGeneradas"));
}

const FUENTES = archivosDeLaApp().map((r) => ({ ruta: r, texto: readFileSync(r, "utf8"), css: r.endsWith(".css") }));

/** Variables `--mic-*` DEFINIDAS en algún lado: declaradas en CSS o fijadas desde el código. */
const variablesDefinidas = new Set();
/** Prefijos de variables armadas en el código (`var(--mic-recordatorio-${n})`). */
const prefijosDeVariable = [];
/** Clases `mic-*` que existen: en un selector de CSS o en un string del código. */
const clasesConocidas = new Set();
/** Prefijos de clases armadas en el código (`mic-live-tarea-${estilo}`). */
const prefijosDeClase = [];

for (const { texto, css } of FUENTES) {
  for (const m of texto.matchAll(/(--mic-[a-z0-9-]+)\s*:/g)) variablesDefinidas.add(m[1]);
  for (const m of texto.matchAll(/["'`](--mic-[a-z0-9-]+)["'`]/g)) variablesDefinidas.add(m[1]);
  for (const m of texto.matchAll(/(--mic-[a-z0-9-]+-)\$\{/g)) prefijosDeVariable.push(m[1]);
  if (css) {
    for (const m of texto.matchAll(/\.(mic-[a-z0-9]+(?:-[a-z0-9]+)*)/g)) clasesConocidas.add(m[1]);
  } else {
    for (const m of texto.matchAll(/(?<![\w-])(mic-[a-z0-9]+(?:-[a-z0-9]+)*)(?![\w-])/g)) clasesConocidas.add(m[1]);
    for (const m of texto.matchAll(/(?<![\w-])(mic-[a-z0-9-]+-)\$\{/g)) prefijosDeClase.push(m[1]);
  }
}

// ── Lo que dice la plantilla ─────────────────────────────────────────────────

const comentarios = [...PLANTILLA.matchAll(/\/\*([\s\S]*?)\*\//g)].map((m) => m[1]);
const ejemplos = comentarios.filter((c) => /^\r?\n/.test(c));
const variablesNombradas = new Set([...PLANTILLA.matchAll(/--mic-[a-z0-9]+(?:-[a-z0-9]+)*/g)].map((m) => m[0]));
const clasesNombradas = new Set([
  ...[...PLANTILLA.matchAll(/\.(mic-[a-z0-9]+(?:-[a-z0-9]+)*)/g)].map((m) => m[1]),
  ...[...PLANTILLA.matchAll(/::highlight\((mic-[a-z0-9-]+)\)/g)].map((m) => m[1]),
]);
const tokensPublicos = [...new Set([...TOKENS.matchAll(/^\s*(--mic-[a-z0-9-]+)\s*:/gm)].map((m) => m[1]))];

// ── 1. CSS válido y sin efecto ───────────────────────────────────────────────

test("tal como se entrega, la plantilla es CSS válido y no cambia nada", () => {
  const raiz = postcss.parse(PLANTILLA, { from: "plantilla-estilos.css" });
  const activos = raiz.nodes.filter((n) => n.type !== "comment");
  assert.deepEqual(
    activos.map((n) => n.toString().slice(0, 80)),
    [],
    "todo tiene que estar comentado: un snippet nuevo no puede cambiar la apariencia",
  );
});

test("hay ejemplos y cada uno, descomentado, es CSS válido", () => {
  assert.ok(ejemplos.length >= 30, `se esperaban muchos ejemplos y hay ${ejemplos.length}`);
  for (const ejemplo of ejemplos) {
    const resumen = ejemplo.trim().split("\n")[0];
    let raiz;
    assert.doesNotThrow(() => {
      raiz = postcss.parse(ejemplo);
    }, `postcss no entiende el ejemplo «${resumen}»`);
    const reglas = raiz.nodes.filter((n) => n.type === "rule");
    assert.ok(reglas.length > 0, `el ejemplo «${resumen}» no tiene ninguna regla`);
    for (const regla of reglas) {
      assert.ok(
        regla.nodes.some((n) => n.type === "decl"),
        `la regla «${regla.selector}» del ejemplo «${resumen}» está vacía`,
      );
    }
    // Segundo parser, el de CodeMirror (el mismo idioma que el editor de
    // snippets): es estricto con lo que postcss deja pasar, como un `;` de más
    // o una llave mal puesta dentro de un valor.
    const errores = [];
    parserCss.parse(ejemplo).iterate({
      enter(n) {
        if (n.type.isError) errores.push(ejemplo.slice(Math.max(0, n.from - 20), n.to + 20));
      },
    });
    assert.deepEqual(errores, [], `el ejemplo «${resumen}» tiene errores de sintaxis`);
  }
});

// ── 2. Lo que nombra existe ──────────────────────────────────────────────────

test("cada variable --mic-* que nombra la plantilla existe en la app", () => {
  const faltan = [...variablesNombradas].filter(
    (v) => !variablesDefinidas.has(v) && !prefijosDeVariable.some((p) => v.startsWith(p)),
  );
  assert.deepEqual(faltan, [], "la plantilla nombra variables que ya no existen (¿se renombraron?)");
});

test("cada clase .mic-* que nombra la plantilla existe en la app", () => {
  assert.ok(clasesNombradas.size > 40, `se esperaban muchas clases y hay ${clasesNombradas.size}`);
  const faltan = [...clasesNombradas].filter(
    (c) => !clasesConocidas.has(c) && !prefijosDeClase.some((p) => c.startsWith(p)),
  );
  assert.deepEqual(faltan, [], "la plantilla nombra clases que ya no existen (¿se renombraron?)");
});

// ── 3. Lo que existe está en la plantilla (o se decidió que no) ──────────────

test("cada variable de tokens.css está en la plantilla o excluida con motivo", () => {
  const sinDecidir = tokensPublicos.filter((t) => !variablesNombradas.has(t) && !EXCLUIDOS.has(t));
  assert.deepEqual(
    sinDecidir,
    [],
    "hay tokens nuevos que la plantilla no menciona: documentalos en public/plantilla-estilos.css " +
      "o agregalos a EXCLUIDOS en este test, con el motivo",
  );
});

test("la lista de exclusión está al día", () => {
  for (const [token] of EXCLUIDOS) {
    assert.ok(tokensPublicos.includes(token), `${token} está excluido pero ya no existe en tokens.css: sacalo de la lista`);
    assert.ok(!variablesNombradas.has(token), `${token} está excluido pero la plantilla lo menciona: decidí uno de los dos`);
  }
});
