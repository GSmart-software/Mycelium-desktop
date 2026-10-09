// Test de los temas (HU-12), de la atmósfera Aurora (`FUN-M-54`, al final) y
// de los temas de marca, Arrecife (`FUN-M-51`) y GSmart (`FUN-M-52`): la lógica
// pura de `lib/temas.ts` —qué tema guardado vale, qué muestras se ofrecen según
// el modo dev, si la atmósfera se aplica— y lo que el CSS tiene que cumplir: la
// paleta completa en tokens.css y en el PDF, la forma acotada a cada tema, el
// contraste medido de sus textos y, para GSmart, que la marca esté en los
// mismos lugares que la de Arrecife y que sus letras no se pidan a la red.
//
// El tema Bioluminiscencia experimental (`FUN-M-53`) se retiró el 2026-10-09:
// lo único que queda de él acá es que un vault que lo tenía guardado cae al
// tema por defecto.
//
// Mismo arnés que `scripts/test-modo-dev.mjs`: los módulos se transpilan a una
// carpeta temporal DENTRO de `frontend/`.
//
//   node --test scripts/test-temas.mjs
import assert from "node:assert/strict";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { after, test } from "node:test";
import ts from "typescript";

const AQUI = dirname(fileURLToPath(import.meta.url));
const FRONTEND = join(AQUI, "..");
const TMP = join(FRONTEND, ".tmp-test-temas");

await rm(TMP, { recursive: true, force: true });
await mkdir(TMP, { recursive: true });
for (const nombre of ["modoDev", "atmosferas", "temas"]) {
  const fuente = await readFile(join(FRONTEND, `lib/${nombre}.ts`), "utf8");
  let { outputText } = ts.transpileModule(fuente, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  });
  outputText = outputText.replace(/from "\.\/(modoDev|atmosferas)"/g, 'from "./$1.mjs"');
  await writeFile(join(TMP, `${nombre}.mjs`), outputText);
}
const { TEMAS, TEMA_DEFECTO, TEMAS_DE_MARCA, temaValido, temasVisibles, admiteAtmosfera, atmosferaEnUso } =
  await import(pathToFileURL(join(TMP, "temas.mjs")).href);
const { ATMOSFERAS, atmosferaValida } = await import(pathToFileURL(join(TMP, "atmosferas.mjs")).href);

after(() => rm(TMP, { recursive: true, force: true }));

// Sin los `\r`: el checkout de Windows convierte a CRLF (autocrlf) y los
// `indexOf` de abajo buscan saltos `\n` a secas.
const leer = async (ruta) => (await readFile(join(FRONTEND, ruta), "utf8")).replace(/\r\n/g, "\n");

// ── Lógica pura ──────────────────────────────────────────────────────────────

test("el tema guardado vale si existe; los de marca también, con o sin modo dev", () => {
  for (const t of ["bioluminiscencia", "cantarela", "arrecife", "gsmart"]) assert.equal(temaValido(t), t);
  for (const t of ["neon", "Arrecife", "GSmart", "BioExp", "bioluminiscencia-exp", "", null, undefined, 3, {}]) {
    assert.equal(temaValido(t), TEMA_DEFECTO, JSON.stringify(t));
  }
  assert.equal(temaValido("neon", "cantarela"), "cantarela");
  assert.equal(TEMA_DEFECTO, "bioluminiscencia");
});

test("un vault con el tema experimental retirado (`bioexp`, `FUN-M-53`) abre con el tema por defecto", () => {
  assert.equal(temaValido("bioexp"), TEMA_DEFECTO);
  assert.equal(temaValido("bioexp"), "bioluminiscencia");
  assert.equal(TEMAS.some((t) => t.id === "bioexp"), false);
  assert.equal(TEMAS_DE_MARCA.includes("bioexp"), false);
});

test("sin el modo dev, las muestras de marca no existen; con él, están al final", () => {
  assert.deepEqual(temasVisibles(false).map((t) => t.id), ["bioluminiscencia", "cantarela"]);
  assert.deepEqual(temasVisibles(true).map((t) => t.id), ["bioluminiscencia", "cantarela", "arrecife", "gsmart"]);
  // Solo los de marca son soloDev, y no se muta el catálogo.
  assert.deepEqual(TEMAS.filter((t) => t.soloDev).map((t) => t.id), ["arrecife", "gsmart"]);
  assert.equal(TEMAS.length, 4);
});

test("la muestra de Arrecife lleva los colores de la marca", () => {
  const a = TEMAS.find((t) => t.id === "arrecife");
  assert.equal(a.canvas, "#14171E");
  assert.equal(a.accent, "#3AB8D8");
  assert.equal(a.glow, "#7444E4");
});

test("la muestra de GSmart lleva los colores del símbolo sobre el carbón", () => {
  const g = TEMAS.find((t) => t.id === "gsmart");
  assert.equal(g.nombre, "GSmart");
  assert.equal(g.canvas, "#1E2023");
  assert.equal(g.accent, "#12A8E8");
  assert.equal(g.glow, "#A3ECE2");
});

test("los temas de marca son exactamente Arrecife y GSmart, y no admiten atmósferas", () => {
  assert.deepEqual([...TEMAS_DE_MARCA], ["arrecife", "gsmart"]);
  assert.equal(admiteAtmosfera("bioluminiscencia"), true);
  assert.equal(admiteAtmosfera("cantarela"), true);
  assert.equal(admiteAtmosfera("arrecife"), false);
  assert.equal(admiteAtmosfera("gsmart"), false);
  // Todo tema de marca es del catálogo y va detrás del modo.
  for (const id of TEMAS_DE_MARCA) assert.equal(TEMAS.find((t) => t.id === id)?.soloDev, true, id);
});

test("la atmósfera en uso: la del modo, la de defecto si la guardada no vale, ninguna con un tema de marca", () => {
  const prefs = { atmosferaOscuro: "papel", atmosferaClaro: "abisal" };
  assert.equal(atmosferaEnUso("bioluminiscencia", true, prefs), "papel");
  assert.equal(atmosferaEnUso("cantarela", false, prefs), "abisal");
  assert.equal(atmosferaEnUso("cantarela", true, { atmosferaOscuro: "x", atmosferaClaro: 1 }), "niebla");
  assert.equal(atmosferaEnUso("cantarela", false, { atmosferaOscuro: "x", atmosferaClaro: 1 }), "bosque");
  for (const tema of ["arrecife", "gsmart"]) {
    assert.equal(atmosferaEnUso(tema, true, prefs), null);
    assert.equal(atmosferaEnUso(tema, false, prefs), null);
  }
  // No toca lo guardado: vuelve al cambiar de tema.
  assert.deepEqual(prefs, { atmosferaOscuro: "papel", atmosferaClaro: "abisal" });
});

// ── CSS ──────────────────────────────────────────────────────────────────────

const RAW = ["base", "base-deep", "accent", "glow", "mist", "canvas", "ink", "ink-muted"];

/** Los `--mic-raw-*` del primer bloque cuyo selector es exactamente `selector`. */
function rawsDe(css, selector) {
  const i = css.indexOf(`${selector} {`);
  assert.ok(i >= 0, `falta el bloque ${selector}`);
  const cuerpo = css.slice(i, css.indexOf("}", i));
  const salida = {};
  for (const m of cuerpo.matchAll(/--mic-raw-([a-z-]+):\s*(#[0-9a-fA-F]{6})/g)) salida[m[1]] = m[2].toUpperCase();
  return salida;
}

const tokens = await leer("styles/tokens.css");
const claro = rawsDe(tokens, "[data-theme='arrecife']");
const oscuro = rawsDe(tokens, "[data-theme='arrecife'][data-dark='true']");
const gsClaro = rawsDe(tokens, "[data-theme='gsmart']");
const gsOscuro = rawsDe(tokens, "[data-theme='gsmart'][data-dark='true']");

test("tokens.css define los ocho raw de Arrecife en claro y en oscuro", () => {
  assert.deepEqual(Object.keys(claro).sort(), [...RAW].sort());
  assert.deepEqual(Object.keys(oscuro).sort(), [...RAW].sort());
  // Los valores de la marca que se usan tal cual.
  assert.equal(oscuro.canvas, "#14171E");
  assert.equal(oscuro.ink, "#F7F9FC");
  assert.equal(oscuro["ink-muted"], "#8A9095");
  assert.equal(oscuro.accent, "#3AB8D8");
  assert.equal(claro.canvas, "#EEF1F6");
  assert.equal(claro.ink, "#1A212C");
  assert.equal(claro["ink-muted"], "#5C6672");
  assert.equal(claro.glow, "#7444E4");
});

test("tokens.css define los ocho raw de GSmart con los valores de la marca", () => {
  assert.deepEqual(Object.keys(gsClaro).sort(), [...RAW].sort());
  assert.deepEqual(Object.keys(gsOscuro).sort(), [...RAW].sort());
  // Oscuro: todo tal cual la marca (skill gsmart-marca, tokens.css).
  assert.deepEqual(gsOscuro, {
    canvas: "#1E2023", // fondo
    mist: "#25282B", // fondo 2
    base: "#2E3134", // panel
    "base-deep": "#18191B", // código
    ink: "#ECEFF2",
    "ink-muted": "#B3B9C0",
    accent: "#3B9BE8",
    glow: "#A3ECE2", // aguamarina
  });
  // Claro: tal cual, salvo el glow (el aguamarina no se lee sobre claro) y el
  // tinte de las sombras.
  assert.equal(gsClaro.canvas, "#F3F5F8");
  assert.equal(gsClaro.mist, "#FFFFFF");
  assert.equal(gsClaro.base, "#E8ECF1");
  assert.equal(gsClaro.ink, "#1B1F24");
  assert.equal(gsClaro["ink-muted"], "#4A525B");
  assert.equal(gsClaro.accent, "#1F6FC4");
  assert.equal(gsClaro.glow, "#166A5E");
});

test("el PDF (lib/printStyles.ts) lleva los mismos raw de los temas de marca que la app", async () => {
  const print = await leer("lib/printStyles.ts");
  assert.deepEqual(rawsDe(print, "[data-theme='arrecife']"), claro);
  assert.deepEqual(rawsDe(print, "[data-theme='arrecife'][data-dark='true']"), oscuro);
  assert.deepEqual(rawsDe(print, "[data-theme='gsmart']"), gsClaro);
  assert.deepEqual(rawsDe(print, "[data-theme='gsmart'][data-dark='true']"), gsOscuro);
});

test("el tema retirado no deja paleta en tokens.css ni en el PDF, ni hoja propia", async () => {
  assert.doesNotMatch(tokens, /bioexp/);
  assert.doesNotMatch(await leer("lib/printStyles.ts"), /bioexp/);
  assert.doesNotMatch(await leer("app/layout.tsx"), /bioexp|Space_Grotesk|space-grotesk/);
});

// Contraste WCAG 2.x (no a ojo): luminancia relativa de sRGB.
const lum = (hex) => {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contraste = (a, b) => {
  const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m);
  return (x + 0.05) / (y + 0.05);
};

/** Texto principal y secundario sobre los tres fondos lisos, y los acentos sobre la nota y los paneles. */
function textosLegibles(tema, paletas) {
  for (const [modo, p] of paletas) {
    // canvas = la nota, mist = paneles, base = el marco (rail, barras).
    for (const fondo of ["canvas", "mist", "base"]) {
      for (const texto of ["ink", "ink-muted"]) {
        const c = contraste(p[texto], p[fondo]);
        assert.ok(c >= 4.5, `${tema} ${modo}: ${texto} ${p[texto]} sobre ${fondo} ${p[fondo]} = ${c.toFixed(2)}:1`);
      }
    }
    // Los acentos que se usan como texto (enlaces en oscuro van en crudo).
    for (const fondo of ["canvas", "mist"]) {
      const c = contraste(p.accent, p[fondo]);
      assert.ok(c >= 4.5, `${tema} ${modo}: acento ${p.accent} sobre ${fondo} = ${c.toFixed(2)}:1`);
    }
  }
}

test("contraste de Arrecife: texto principal y secundario ≥4.5:1 sobre sus fondos, en los dos modos", () => {
  textosLegibles("arrecife", [["claro", claro], ["oscuro", oscuro]]);
  // El glow va en crudo como texto solo en oscuro (etiquetas): ahí también.
  for (const fondo of ["canvas", "mist"]) {
    const c = contraste(oscuro.glow, oscuro[fondo]);
    assert.ok(c >= 4.5, `oscuro: glow ${oscuro.glow} sobre ${fondo} = ${c.toFixed(2)}:1`);
  }
});

test("contraste de GSmart: texto, acento y aguamarina ≥4.5:1 sobre sus fondos, en los dos modos", () => {
  textosLegibles("gsmart", [["claro", gsClaro], ["oscuro", gsOscuro]]);
  // El segundo tono va como texto en los dos modos (H2, íconos de nota): el
  // aguamarina en oscuro y su derivado en claro, sobre los tres fondos.
  for (const [modo, p] of [["claro", gsClaro], ["oscuro", gsOscuro]]) {
    for (const fondo of ["canvas", "mist", "base"]) {
      const c = contraste(p.glow, p[fondo]);
      assert.ok(c >= 4.5, `gsmart ${modo}: glow ${p.glow} sobre ${fondo} = ${c.toFixed(2)}:1`);
    }
  }
});

const gsmartCss = await leer("styles/gsmart.css");
const sinComentarios = (css) => css.replace(/\/\*[\s\S]*?\*\//g, "");

test("GSmart: el degradado de la marca, y sus tintas como texto legibles en los dos modos", () => {
  assert.match(gsmartCss, /--gsmart-degradado:\s*linear-gradient\(90deg, #2B4AA6 0%, #12A8E8 100%\)/);
  // Las puntas del degradado que se leen como texto (nombre, título, H1).
  const tintas = (selector) => {
    const i = gsmartCss.indexOf(`${selector} {`);
    assert.ok(i >= 0, `falta ${selector}`);
    const cuerpo = gsmartCss.slice(i, gsmartCss.indexOf("}", i));
    const m = cuerpo.match(/--gsmart-degradado-texto:\s*linear-gradient\(90deg, (#[0-9A-F]{6}) 0%, (#[0-9A-F]{6}) 100%\)/);
    assert.ok(m, `sin degradado de texto en ${selector}`);
    return [m[1], m[2]];
  };
  for (const [modo, selector, p] of [
    ["oscuro", ":root[data-theme='gsmart'][data-dark='true']", gsOscuro],
    ["claro", ":root[data-theme='gsmart']:not([data-dark='true'])", gsClaro],
  ]) {
    for (const color of tintas(selector)) {
      for (const fondo of ["canvas", "mist"]) {
        const c = contraste(color, p[fondo]);
        assert.ok(c >= 4.5, `gsmart ${modo}: degradado de texto ${color} sobre ${fondo} = ${c.toFixed(2)}:1`);
      }
    }
  }
});

test("GSmart: los títulos de la nota (H1–H3 en hex) se leen sobre la nota y los paneles", () => {
  for (const [modo, selector, p] of [
    ["oscuro", ":root[data-theme='gsmart'][data-dark='true']", gsOscuro],
    ["claro", ":root[data-theme='gsmart']:not([data-dark='true'])", gsClaro],
  ]) {
    const css = sinComentarios(gsmartCss);
    const i = css.indexOf(`${selector} {\n  --mic-h1`);
    assert.ok(i >= 0, `faltan los títulos de ${modo}`);
    const cuerpo = css.slice(i, css.indexOf("}", i));
    const hex = [...cuerpo.matchAll(/--mic-h[1-3]:\s*(#[0-9A-F]{6})/g)].map((m) => m[1]);
    assert.equal(hex.length, 3, `${modo}: H1–H3`);
    for (const color of hex) {
      for (const fondo of ["canvas", "mist"]) {
        const c = contraste(color, p[fondo]);
        assert.ok(c >= 4.5, `gsmart ${modo}: título ${color} sobre ${fondo} = ${c.toFixed(2)}:1`);
      }
    }
  }
});

/** El cuerpo del primer bloque de `css` (sin comentarios) con el selector exacto `selector` que declara `variable`. */
function bloqueDe(css, selector, variable) {
  const limpio = sinComentarios(css);
  for (let i = limpio.indexOf(`${selector} {`); i >= 0; i = limpio.indexOf(`${selector} {`, i + 1)) {
    const cuerpo = limpio.slice(i, limpio.indexOf("}", i));
    if (cuerpo.includes(variable)) return cuerpo;
  }
  assert.fail(`falta ${selector} con ${variable}`);
}

/** Los selectores de una hoja (sin comentarios ni @media), con los espacios normalizados. */
const selectoresDe = (css) =>
  [...sinComentarios(css).matchAll(/([^{}]+)\{/g)]
    .map((m) => m[1].trim().replace(/\s+/g, " "))
    .filter((s) => s && !s.startsWith("@media"));

const modulos = [];
const recorrer = async (dir) => {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const ruta = join(dir, e.name);
    if (e.isDirectory()) await recorrer(ruta);
    else if (e.name.endsWith(".module.css")) modulos.push(ruta);
  }
};
await recorrer(join(FRONTEND, "components"));
await recorrer(join(FRONTEND, "app"));

/** Las reglas de los módulos que nombran el tema, por archivo. Cada una tiene que ir acotada. */
async function reglasDeModulos(tema) {
  const salida = new Map();
  for (const ruta of modulos) {
    const texto = sinComentarios(await readFile(ruta, "utf8"));
    for (const m of texto.matchAll(/([^{}]+)\{/g)) {
      const sel = m[1].trim().replace(/\s+/g, " ");
      if (!new RegExp(tema, "i").test(sel)) continue;
      const archivo = relative(FRONTEND, ruta);
      if (!salida.has(archivo)) salida.set(archivo, new Set());
      salida.get(archivo).add(sel);
    }
  }
  return salida;
}

for (const tema of ["arrecife", "gsmart"]) {
  test(`la forma de ${tema} no alcanza a los otros temas`, async () => {
    // styles/<tema>.css: cada regla va bajo :root[data-theme='<tema>'].
    const selectores = selectoresDe(await leer(`styles/${tema}.css`));
    assert.ok(selectores.length > 0);
    for (const lista of selectores) {
      for (const s of lista.split(/,(?![^()]*\))/).map((x) => x.trim())) {
        assert.ok(s.startsWith(`:root[data-theme='${tema}']`), `regla sin acotar: ${s}`);
      }
    }

    // Los módulos: toda regla que nombre el tema empieza con el :global acotado.
    let reglas = 0;
    for (const [archivo, sels] of await reglasDeModulos(tema)) {
      for (const sel of sels) {
        reglas++;
        for (const s of sel.split(/,(?![^()]*\))/).map((x) => x.trim())) {
          assert.ok(s.startsWith(`:global(:root[data-theme='${tema}'])`), `${archivo}: ${s}`);
        }
      }
    }
    assert.ok(reglas >= 10, `se esperaban las reglas de ${tema} en los módulos (hay ${reglas})`);

    // Las atmósferas no tienen reglas para los temas de marca: no se les aplican.
    assert.doesNotMatch(await leer("styles/atmosferas.css"), new RegExp(tema, "i"));
  });
}

test("GSmart lleva su marca en todos los lugares donde Arrecife lleva la suya", async () => {
  // Hoja global: cada selector de arrecife.css tiene su gemelo en gsmart.css.
  const deGsmart = new Set(selectoresDe(gsmartCss));
  for (const s of selectoresDe(await leer("styles/arrecife.css"))) {
    const gemelo = s.replaceAll("'arrecife'", "'gsmart'");
    assert.ok(deGsmart.has(gemelo), `styles/gsmart.css no tiene: ${gemelo}`);
  }
  // Módulos: cada regla de Arrecife tiene la de GSmart en el mismo archivo.
  const arrecife = await reglasDeModulos("arrecife");
  const gsmart = await reglasDeModulos("gsmart");
  for (const [archivo, sels] of arrecife) {
    for (const s of sels) {
      const gemelo = s.replaceAll("'arrecife'", "'gsmart'");
      assert.ok(gsmart.get(archivo)?.has(gemelo), `${archivo} no tiene: ${gemelo}`);
    }
  }
});

test("GSmart: las letras se empaquetan con la app y solo las usa su tema", async () => {
  const layout = await leer("app/layout.tsx");
  for (const [familia, variable] of [
    ["Manrope", "--font-manrope"],
    ["Michroma", "--font-michroma"],
  ]) {
    const i = layout.indexOf(`= ${familia}({`);
    assert.ok(i >= 0, `falta ${familia} con next/font/google`);
    const opciones = layout.slice(i, layout.indexOf("});", i));
    assert.match(opciones, new RegExp(`variable: "${variable}"`));
    assert.match(opciones, /preload: false/, `${familia} no se precarga`);
    assert.match(opciones, /display: "swap"/, `${familia} con display: swap`);
  }
  // Ningún pedido a Google Fonts en ejecución: next/font las baja al compilar.
  for (const dir of ["app", "components", "lib", "stores", "styles"]) {
    const archivos = [];
    const juntar = async (d) => {
      for (const e of await readdir(d, { withFileTypes: true })) {
        const ruta = join(d, e.name);
        if (e.isDirectory()) await juntar(ruta);
        else if (/\.(css|tsx?|mjs)$/.test(e.name)) archivos.push(ruta);
      }
    };
    await juntar(join(FRONTEND, dir));
    for (const ruta of archivos) {
      assert.doesNotMatch(await readFile(ruta, "utf8"), /fonts\.(googleapis|gstatic)\.com/, relative(FRONTEND, ruta));
    }
  }
  // Las variables de las letras nuevas solo se leen bajo el tema GSmart.
  for (const ruta of [join(FRONTEND, "styles/tokens.css"), join(FRONTEND, "styles/editor.css"), join(FRONTEND, "app/globals.css")]) {
    assert.doesNotMatch(await readFile(ruta, "utf8"), /--font-(manrope|michroma)/, relative(FRONTEND, ruta));
  }
  assert.match(gsmartCss, /--mic-font-sans: var\(--font-manrope\)/);
  assert.match(gsmartCss, /--gsmart-letra-titulo: var\(--font-michroma\)/);
});

test("GSmart: el cuerpo de las notas conserva la fuente que elige el usuario", () => {
  // gsmart.css no toca las variables de la tipografía de las notas ni el
  // contenido del editor o de la lectura (solo sus títulos).
  const css = sinComentarios(gsmartCss);
  assert.doesNotMatch(css, /--mic-(editor|preview)-font-family/);
  assert.doesNotMatch(css, /\.cm-content|\.mic-preview\s*\{|\.mic-preview p\b/);
  // Michroma solo en títulos y etiquetas.
  for (const m of css.matchAll(/([^{}]+)\{([^}]*letra-titulo[^}]*)\}/g)) {
    const sel = m[1].trim();
    // El bloque de variables declara la letra sin usarla.
    if (!/font-family/.test(m[2])) continue;
    assert.match(sel, /title|h1|h2|titulo/, `Michroma fuera de un título: ${sel}`);
  }
});

// ── Atmósfera Aurora (`FUN-M-54`) ────────────────────────────────────────────
//
// La quinta atmósfera, pública: degradados, brillos y resplandores con los
// colores del tema que esté puesto. Se prueba que exista y se guarde, que su
// forma esté acotada, que cubra los componentes y selectores de `AURORA_CUBRE`
// y el contraste de sus degradados en los dos temas públicos y los dos modos,
// calculado desde las fórmulas de `styles/aurora.css`.
//
// Antes se comparaba regla por regla con el tema Bioluminiscencia experimental
// (`FUN-M-53`), del que nació el estilo. Al retirarse ese tema (2026-10-09), la
// paridad pasó a ser esta lista explícita, sacada de las reglas que Aurora tenía
// ese día. Lo que Aurora dejó afuera a propósito —la letra de los títulos, el
// radio y el foco de los inputs: una atmósfera reparte color, no cambia la
// letra ni la forma de los controles— lo vigila el test de su hoja (sin
// `font-family`, sin `:focus`).

const auroraCss = await leer("styles/aurora.css");
const AURORA = ":root[data-atmosfera='aurora']";
const AURORA_MODULO = ":global(:root[data-atmosfera='aurora'])";

/** Lo que Aurora tiene que cubrir: los selectores de su hoja y, por módulo, los de cada componente. */
const AURORA_CUBRE = {
  hoja: [
    // Las variables: comunes, y las paradas de cada modo.
    AURORA,
    `${AURORA}[data-dark='true']`,
    `${AURORA}:not([data-dark='true'])`,
    // Títulos en degradado y en color.
    `${AURORA} :is(.mic-doc-title-texto, .mic-doc-title-campo)`,
    `${AURORA} .mic-preview h1`,
    `${AURORA}[data-dark='true'] :is(.mic-live-h1, .mic-live-h2, .mic-live-h3), ${AURORA}[data-dark='true'] .mic-preview :is(h2, h3)`,
    `${AURORA} .mic-preview :is(h1, h2, h3)`,
    // Etiquetas, selección, barras de desplazamiento y viñetas.
    `${AURORA} :is(.mic-tag-cm, .mic-tag-pill)`,
    `${AURORA} ::selection`,
    `${AURORA} *::-webkit-scrollbar-thumb`,
    `${AURORA} *::-webkit-scrollbar-thumb:hover`,
    `${AURORA} :is(.mic-vineta, .mic-preview li)::marker, ${AURORA} .mic-vineta`,
  ],
  // Por módulo, lo que va detrás de `AURORA_MODULO`.
  modulos: {
    "components/bases/BaseView.module.css": [".botonPrimario", ".botonPrimario:hover:not(:disabled)"],
    "components/editor/EditorToolbar.module.css": [".linkConfirm", ".linkConfirm:hover:not(:disabled)"],
    "components/editor/ExcalidrawModal.module.css": [".save", ".save:hover:not(:disabled)"],
    "components/enlaces/RelinkView.module.css": [".primario", ".primario:hover:not(:disabled)"],
    "components/explorer/EsporasPanel.module.css": [".primario", ".primario:hover:not(:disabled)"],
    "components/explorer/ExplorerPanel.module.css": [".rowHoja.rowActive", ".noteIcon"],
    "components/explorer/ImportDialogs.module.css": [".btnPrimary", ".btnPrimary:hover:not(:disabled)"],
    "components/graph/GraphOptionsMenu.module.css": [".switch input:checked + .switchTrack"],
    "components/panes/panes.module.css": [".tabActive", ".paneBody::after"],
    "components/recordatorios/Recordatorios.module.css": [".botonPrimario", ".botonPrimario:hover:not(:disabled)"],
    "components/settings/CssEditorModal.module.css": [".primaryBtn", ".primaryBtn:hover:not(:disabled)"],
    "components/settings/DiccionariosCorrector.module.css": [".botonPrimario", ".botonPrimario:hover:not(:disabled)"],
    "components/settings/Settings.module.css": [
      ".primaryBtn",
      ".primaryBtn:hover:not(:disabled)",
      ".switch input:checked + .switchTrack",
      ".swatchActive",
    ],
    "components/settings/VentanaAjustes.module.css": [".categoriaActiva"],
    "components/vault/AperturaVault.module.css": [".barraRelleno"],
    "components/workspace/AppTopbar.module.css": [".logoFull", ".topbar", ".logoMark"],
    "components/workspace/PaletaComandos.module.css": [".opcionActiva"],
    "components/workspace/Rail.module.css": [
      ".button[aria-pressed='true']::before",
      ".button[aria-pressed='true']",
      ".button[aria-pressed='true'] svg",
      ".rail",
    ],
    "components/workspace/UpdateDialog.module.css": [".primaryBtn", ".primaryBtn:hover:not(:disabled)", ".progressBar"],
    "app/(vaults)/vaults/page.module.css": [".openButton", ".openButton:hover:not(:disabled)"],
    "app/page.module.css": [".cta", ".cta:hover:not(:disabled)"],
  },
};

test("Aurora está en el catálogo de atmósferas, se valida y se aplica con los temas públicos", () => {
  const aurora = ATMOSFERAS.find((a) => a.id === "aurora");
  assert.ok(aurora, "falta Aurora en ATMOSFERAS");
  assert.equal(aurora.nombre, "Aurora");
  assert.ok(aurora.descripcion.length > 0 && aurora.descripcion.length <= 60, "una línea corta");
  assert.deepEqual(ATMOSFERAS.map((a) => a.id), ["abisal", "niebla", "bosque", "papel", "aurora"]);
  assert.equal(atmosferaValida("aurora", "niebla"), "aurora");
  assert.equal(atmosferaValida("Aurora", "niebla"), "niebla");
  // Se elige para cada modo, con los dos temas públicos.
  const prefs = { atmosferaOscuro: "aurora", atmosferaClaro: "aurora" };
  for (const tema of ["bioluminiscencia", "cantarela"]) {
    assert.equal(atmosferaEnUso(tema, true, prefs), "aurora");
    assert.equal(atmosferaEnUso(tema, false, prefs), "aurora");
  }
  // Nunca encima de un tema de marca.
  for (const tema of TEMAS_DE_MARCA) {
    assert.equal(atmosferaEnUso(tema, true, prefs), null, tema);
    assert.equal(atmosferaEnUso(tema, false, prefs), null, tema);
  }
});

test("Aurora: su hoja va acotada a la atmósfera, no redefine tokens y no cambia la letra", async () => {
  const layout = await leer("app/layout.tsx");
  assert.match(layout, /import "\.\.\/styles\/aurora\.css";/);
  const selectores = selectoresDe(auroraCss);
  assert.ok(selectores.length > 0);
  for (const lista of selectores) {
    for (const s of lista.split(/,(?![^()]*\))/).map((x) => x.trim())) {
      assert.ok(s.startsWith(AURORA), `regla sin acotar: ${s}`);
    }
  }
  const css = sinComentarios(auroraCss);
  // Sin colores propios ni fondos: los tokens son los del tema (y los fondos, los de Abisal).
  assert.doesNotMatch(css, /--mic-[a-z0-9-]+\s*:/, "Aurora no redefine tokens --mic-*");
  assert.doesNotMatch(css, /data-theme/, "Aurora no depende de un tema");
  assert.doesNotMatch(css, /font-family|letter-spacing|--font-/, "una atmósfera no cambia la letra");
  // Sin halo en el foco de los inputs (DEF-155).
  assert.doesNotMatch(css, /:focus/);
  // atmosferas.css no la nombra: sus reglas viven aparte.
  assert.doesNotMatch(await leer("styles/atmosferas.css"), /aurora/i);
});

test("Aurora: en los módulos, toda regla va bajo el :global acotado (salvo su muestra en Apariencia)", async () => {
  let reglas = 0;
  for (const [archivo, sels] of await reglasDeModulos("aurora")) {
    for (const sel of sels) {
      reglas++;
      for (const s of sel.split(/,(?![^()]*\))/).map((x) => x.trim())) {
        if (archivo.endsWith("Settings.module.css") && s.startsWith(".muestra[data-atmosfera='aurora']")) continue;
        assert.ok(s.startsWith(AURORA_MODULO), `${archivo}: ${s}`);
        assert.doesNotMatch(s, /data-dark/, `${archivo}: lo que cambia con el modo va en variables: ${s}`);
      }
    }
  }
  assert.ok(reglas >= 30, `se esperaban las reglas de Aurora en los módulos (hay ${reglas})`);
});

test("Aurora lleva la luz en todos los componentes y selectores de su lista", async () => {
  const deAurora = new Set(selectoresDe(auroraCss));
  for (const s of AURORA_CUBRE.hoja) assert.ok(deAurora.has(s), `styles/aurora.css no tiene: ${s}`);
  // Las claves con barras normales: `relative` da barras invertidas en Windows.
  const aurora = new Map([...(await reglasDeModulos("aurora"))].map(([archivo, sels]) => [archivo.replaceAll("\\", "/"), sels]));
  for (const [archivo, sufijos] of Object.entries(AURORA_CUBRE.modulos)) {
    for (const sufijo of sufijos) {
      const s = `${AURORA_MODULO} ${sufijo}`;
      assert.ok(aurora.get(archivo)?.has(s), `${archivo} no tiene: ${s}`);
    }
  }
});

// Contraste: se resuelven las fórmulas de aurora.css (y las de tokens.css que
// usa) con los raw de cada tema y modo, como lo haría el navegador.
const AURORA_PALETAS = [
  ["bioluminiscencia", "claro", "[data-theme='bioluminiscencia']"],
  ["bioluminiscencia", "oscuro", "[data-theme='bioluminiscencia'][data-dark='true']"],
  ["cantarela", "claro", "[data-theme='cantarela']"],
  ["cantarela", "oscuro", "[data-theme='cantarela'][data-dark='true']"],
];

/** Las declaraciones `--x: valor;` de un cuerpo de bloque. */
const declaraciones = (cuerpo) =>
  Object.fromEntries([...cuerpo.matchAll(/(--[a-z0-9-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim().replace(/\s+/g, " ")]));

const hexDe = (c) => "#" + c.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("").toUpperCase();
const rgbDe = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
/** `color-mix(in srgb, a p, b)` con colores opacos. */
const mezclar = (a, p, b) => hexDe(rgbDe(a).map((v, i) => v * p + rgbDe(b)[i] * (1 - p)));

function resolver(expr, vars) {
  const e = expr.trim();
  if (/^#[0-9a-fA-F]{6}$/.test(e)) return e.toUpperCase();
  let m = e.match(/^var\((--[a-z0-9-]+)\)$/);
  if (m) {
    assert.ok(vars[m[1]], `sin valor para ${m[1]}`);
    return resolver(vars[m[1]], vars);
  }
  m = e.match(/^color-mix\(in srgb, (var\([^)]+\)|#[0-9a-fA-F]{6}) (\d+)%, (var\([^)]+\)|#[0-9a-fA-F]{6})\)$/);
  assert.ok(m, `fórmula no soportada: ${e}`);
  return mezclar(resolver(m[1], vars), Number(m[2]) / 100, resolver(m[3], vars));
}

/** Las variables de una combinación tema × modo con Aurora puesta. */
function varsAurora(selectorTema, oscuro) {
  const raw = rawsDe(tokens, selectorTema);
  const vars = Object.fromEntries(Object.entries(raw).map(([k, v]) => [`--mic-raw-${k}`, v]));
  Object.assign(vars, {
    "--mic-glow": "var(--mic-raw-glow)",
    "--mic-accent": "var(--mic-raw-accent)",
    "--mic-text-primary": "var(--mic-raw-ink)",
    "--mic-text-muted": "var(--mic-raw-ink-muted)",
    "--mic-bg-canvas": "var(--mic-raw-canvas)",
    "--mic-bg-surface": "var(--mic-raw-mist)",
    "--mic-bg-sidebar": "var(--mic-raw-base)",
  });
  // Los roles del glow (texto, enlace, marco) de tokens.css, y los de claro encima.
  Object.assign(vars, declaraciones(bloqueDe(tokens, ":root", "--mic-glow-texto:")));
  if (!oscuro) Object.assign(vars, declaraciones(bloqueDe(tokens, ":root:not([data-dark='true'])", "--mic-glow-texto:")));
  Object.assign(vars, declaraciones(bloqueDe(auroraCss, AURORA, "--aurora-degradado:")));
  const modo = oscuro ? `${AURORA}[data-dark='true']` : `${AURORA}:not([data-dark='true'])`;
  Object.assign(vars, declaraciones(bloqueDe(auroraCss, modo, "--aurora-desde:")));
  return vars;
}

const porcentaje = (texto, re) => {
  const m = texto.match(re);
  assert.ok(m, `no se encontró ${re}`);
  return Number(m[1]) / 100;
};

for (const [tema, modo, selectorTema] of AURORA_PALETAS) {
  const oscuro = modo === "oscuro";
  test(`contraste de Aurora con ${tema} en ${modo}: botones, títulos en degradado, marco, selección, etiquetas y luz`, () => {
    const v = varsAurora(selectorTema, oscuro);
    const c = (n) => resolver(`var(${n})`, v);
    const [canvas, mist, base, ink, muted] = ["--mic-raw-canvas", "--mic-raw-mist", "--mic-raw-base", "--mic-raw-ink", "--mic-raw-ink-muted"].map(c);
    const glow = c("--mic-glow"), accent = c("--mic-accent"), glowTexto = c("--mic-glow-texto"), enlace = c("--mic-enlace");
    const fallos = [];
    const exigir = (que, a, b) => {
      const r = contraste(a, b);
      if (r < 4.5) fallos.push(`${que}: ${a} sobre ${b} = ${r.toFixed(2)}:1`);
    };

    // El texto del botón sobre cada parada del degradado.
    const desde = c("--aurora-desde"), hasta = c("--aurora-hasta"), sobre = c("--aurora-sobre-degradado");
    exigir("botón, 1ª parada", sobre, desde);
    exigir("botón, 2ª parada", sobre, hasta);

    // Las paradas del degradado de texto (título de la nota, H1 de lectura).
    const m = v["--aurora-degradado-texto"].match(/^linear-gradient\(90deg, (var\([^)]+\)) 0%, (var\([^)]+\)) 100%\)$/);
    assert.ok(m, "el degradado de texto tiene dos paradas");
    for (const parada of [resolver(m[1], v), resolver(m[2], v)]) {
      exigir("título en degradado / nota", parada, canvas);
      exigir("título en degradado / paneles", parada, mist);
    }

    // El nombre de la app, en el degradado del marco, sobre el marco.
    exigir("nombre sobre el marco, 1ª parada", c("--mic-marco-glow"), base);
    exigir("nombre sobre el marco, 2ª parada", c("--mic-marco-acento"), base);

    // La selección suave (pestaña, nota abierta, categoría, opción de la paleta).
    const suaveGlow = porcentaje(v["--aurora-degradado-suave"], /var\(--mic-glow\) (\d+)%/);
    const suaveAcento = porcentaje(v["--aurora-suave-hasta"], /^(\d+)%$/);
    for (const fondo of [canvas, mist]) {
      for (const [color, p] of [[glow, suaveGlow], [accent, suaveAcento]]) {
        const bg = mezclar(color, p, fondo);
        exigir("principal sobre la selección suave", ink, bg);
        exigir("secundario sobre la selección suave", muted, bg);
      }
    }

    // Las etiquetas sobre su pastilla.
    const pastilla = [
      [glow, porcentaje(v["--aurora-pastilla-desde"], /^(\d+)%$/)],
      [accent, porcentaje(v["--aurora-pastilla-hasta"], /^(\d+)%$/)],
    ];
    for (const fondo of [canvas, mist]) {
      for (const [color, p] of pastilla) exigir("etiqueta sobre su pastilla", glowTexto, mezclar(color, p, fondo));
    }

    // La luz ambiente va ENCIMA del texto: tiñe texto y fondo a la vez.
    const amb = v["--aurora-ambiente"];
    for (const [color, p] of [
      [glow, porcentaje(amb, /var\(--mic-glow\) (\d+)%/)],
      [accent, porcentaje(amb, /var\(--mic-accent\) (\d+)%/)],
    ]) {
      const bg = mezclar(color, p, canvas);
      for (const [que, texto] of [["principal", ink], ["secundario", muted], ["enlace", enlace], ["etiqueta", glowTexto], ["título 1", resolver(m[1], v)], ["título 2", resolver(m[2], v)]]) {
        exigir(`${que} bajo la luz ambiente`, mezclar(color, p, texto), bg);
      }
    }

    assert.deepEqual(fallos, [], `${tema} ${modo}`);
  });
}

test("Aurora: el degradado va del glow al acento del tema (en claro, hundidos en el tono de base)", () => {
  const oscuro = declaraciones(bloqueDe(auroraCss, `${AURORA}[data-dark='true']`, "--aurora-desde:"));
  assert.equal(oscuro["--aurora-desde"], "var(--mic-glow)");
  assert.equal(oscuro["--aurora-hasta"], "var(--mic-accent)");
  const claro = declaraciones(bloqueDe(auroraCss, `${AURORA}:not([data-dark='true'])`, "--aurora-desde:"));
  assert.match(claro["--aurora-desde"], /^color-mix\(in srgb, var\(--mic-glow\) \d+%, var\(--mic-raw-base-deep\)\)$/);
  assert.match(claro["--aurora-hasta"], /^color-mix\(in srgb, var\(--mic-accent\) \d+%, var\(--mic-raw-base-deep\)\)$/);
  // Con Bioluminiscencia, del verde agua al cian; con Cantarela, del dorado al ámbar.
  const bio = varsAurora("[data-theme='bioluminiscencia'][data-dark='true']", true);
  assert.deepEqual([resolver("var(--aurora-desde)", bio), resolver("var(--aurora-hasta)", bio)], ["#3DFFC4", "#19E6FF"]);
  const can = varsAurora("[data-theme='cantarela'][data-dark='true']", true);
  assert.deepEqual([resolver("var(--aurora-desde)", can), resolver("var(--aurora-hasta)", can)], ["#FFC247", "#C77F2E"]);
});
