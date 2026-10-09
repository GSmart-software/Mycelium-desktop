// Test de los temas (HU-12) y de los temas de marca, Arrecife (`FUN-M-51`) y
// GSmart (`FUN-M-52`): la lógica pura de `lib/temas.ts` —qué tema guardado vale,
// qué muestras se ofrecen según el modo dev, si la atmósfera se aplica— y lo que
// el CSS tiene que cumplir: la paleta completa en tokens.css y en el PDF, la
// forma acotada a cada tema, el contraste medido de sus textos y, para GSmart,
// que la marca esté en los mismos lugares que la de Arrecife y que sus letras
// no se pidan a la red.
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

after(() => rm(TMP, { recursive: true, force: true }));

// Sin los `\r`: el checkout de Windows convierte a CRLF (autocrlf) y los
// `indexOf` de abajo buscan saltos `\n` a secas.
const leer = async (ruta) => (await readFile(join(FRONTEND, ruta), "utf8")).replace(/\r\n/g, "\n");

// ── Lógica pura ──────────────────────────────────────────────────────────────

test("el tema guardado vale si existe; los de marca también, con o sin modo dev", () => {
  for (const t of ["bioluminiscencia", "cantarela", "arrecife", "gsmart"]) assert.equal(temaValido(t), t);
  for (const t of ["neon", "Arrecife", "GSmart", "", null, undefined, 3, {}]) {
    assert.equal(temaValido(t), TEMA_DEFECTO, JSON.stringify(t));
  }
  assert.equal(temaValido("neon", "cantarela"), "cantarela");
  assert.equal(TEMA_DEFECTO, "bioluminiscencia");
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
