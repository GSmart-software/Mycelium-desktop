// Test de los temas (HU-12) y del tema Arrecife (`FUN-M-51`): la lógica pura de
// `lib/temas.ts` —qué tema guardado vale, qué muestras se ofrecen según el modo
// dev, si la atmósfera se aplica— y lo que el CSS tiene que cumplir: la paleta
// completa en tokens.css y en el PDF, la forma acotada a Arrecife y el contraste
// medido de sus textos.
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
const { TEMAS, TEMA_DEFECTO, temaValido, temasVisibles, admiteAtmosfera, atmosferaEnUso } = await import(
  pathToFileURL(join(TMP, "temas.mjs")).href
);

after(() => rm(TMP, { recursive: true, force: true }));

const leer = (ruta) => readFile(join(FRONTEND, ruta), "utf8");

// ── Lógica pura ──────────────────────────────────────────────────────────────

test("el tema guardado vale si existe; Arrecife también, con o sin modo dev", () => {
  for (const t of ["bioluminiscencia", "cantarela", "arrecife"]) assert.equal(temaValido(t), t);
  for (const t of ["neon", "Arrecife", "", null, undefined, 3, {}]) {
    assert.equal(temaValido(t), TEMA_DEFECTO, JSON.stringify(t));
  }
  assert.equal(temaValido("neon", "cantarela"), "cantarela");
  assert.equal(TEMA_DEFECTO, "bioluminiscencia");
});

test("sin el modo dev, la muestra de Arrecife no existe; con él, está al final", () => {
  assert.deepEqual(temasVisibles(false).map((t) => t.id), ["bioluminiscencia", "cantarela"]);
  assert.deepEqual(temasVisibles(true).map((t) => t.id), ["bioluminiscencia", "cantarela", "arrecife"]);
  // Solo Arrecife es soloDev, y no se muta el catálogo.
  assert.deepEqual(TEMAS.filter((t) => t.soloDev).map((t) => t.id), ["arrecife"]);
  assert.equal(TEMAS.length, 3);
});

test("la muestra de Arrecife lleva los colores de la marca", () => {
  const a = TEMAS.find((t) => t.id === "arrecife");
  assert.equal(a.canvas, "#14171E");
  assert.equal(a.accent, "#3AB8D8");
  assert.equal(a.glow, "#7444E4");
});

test("las atmósferas no se aplican a Arrecife; a los otros dos, sí", () => {
  assert.equal(admiteAtmosfera("bioluminiscencia"), true);
  assert.equal(admiteAtmosfera("cantarela"), true);
  assert.equal(admiteAtmosfera("arrecife"), false);
});

test("la atmósfera en uso: la del modo, la de defecto si la guardada no vale, ninguna con Arrecife", () => {
  const prefs = { atmosferaOscuro: "papel", atmosferaClaro: "abisal" };
  assert.equal(atmosferaEnUso("bioluminiscencia", true, prefs), "papel");
  assert.equal(atmosferaEnUso("cantarela", false, prefs), "abisal");
  assert.equal(atmosferaEnUso("cantarela", true, { atmosferaOscuro: "x", atmosferaClaro: 1 }), "niebla");
  assert.equal(atmosferaEnUso("cantarela", false, { atmosferaOscuro: "x", atmosferaClaro: 1 }), "bosque");
  assert.equal(atmosferaEnUso("arrecife", true, prefs), null);
  assert.equal(atmosferaEnUso("arrecife", false, prefs), null);
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

test("el PDF (lib/printStyles.ts) lleva los mismos raw de Arrecife que la app", async () => {
  const print = await leer("lib/printStyles.ts");
  assert.deepEqual(rawsDe(print, "[data-theme='arrecife']"), claro);
  assert.deepEqual(rawsDe(print, "[data-theme='arrecife'][data-dark='true']"), oscuro);
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

test("contraste de Arrecife: texto principal y secundario ≥4.5:1 sobre sus fondos, en los dos modos", () => {
  for (const [modo, p] of [["claro", claro], ["oscuro", oscuro]]) {
    // canvas = la nota, mist = paneles, base = el marco (rail, barras).
    for (const fondo of ["canvas", "mist", "base"]) {
      for (const texto of ["ink", "ink-muted"]) {
        const c = contraste(p[texto], p[fondo]);
        assert.ok(c >= 4.5, `${modo}: ${texto} ${p[texto]} sobre ${fondo} ${p[fondo]} = ${c.toFixed(2)}:1`);
      }
    }
    // Los acentos que se usan como texto (enlaces en oscuro van en crudo).
    for (const fondo of ["canvas", "mist"]) {
      const c = contraste(p.accent, p[fondo]);
      assert.ok(c >= 4.5, `${modo}: acento ${p.accent} sobre ${fondo} = ${c.toFixed(2)}:1`);
    }
  }
  // El glow va en crudo como texto solo en oscuro (etiquetas): ahí también.
  for (const fondo of ["canvas", "mist"]) {
    const c = contraste(oscuro.glow, oscuro[fondo]);
    assert.ok(c >= 4.5, `oscuro: glow ${oscuro.glow} sobre ${fondo} = ${c.toFixed(2)}:1`);
  }
});

test("la forma de Arrecife no alcanza a los otros temas", async () => {
  // styles/arrecife.css: cada regla va bajo :root[data-theme='arrecife'].
  const css = (await leer("styles/arrecife.css")).replace(/\/\*[\s\S]*?\*\//g, "");
  const selectores = [...css.matchAll(/([^{}]+)\{/g)]
    .map((m) => m[1].trim())
    .filter((s) => s && !s.startsWith("@media"));
  assert.ok(selectores.length > 0);
  for (const s of selectores) assert.ok(s.startsWith(":root[data-theme='arrecife']"), `regla sin acotar: ${s}`);

  // Los módulos: toda regla que nombre Arrecife empieza con el :global acotado.
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
  let reglas = 0;
  for (const ruta of modulos) {
    const texto = (await readFile(ruta, "utf8")).replace(/\/\*[\s\S]*?\*\//g, "");
    for (const m of texto.matchAll(/([^{}]+)\{/g)) {
      const sel = m[1].trim();
      if (!/arrecife/i.test(sel)) continue;
      reglas++;
      assert.ok(
        sel.startsWith(":global(:root[data-theme='arrecife'])"),
        `${relative(FRONTEND, ruta)}: ${sel}`,
      );
    }
  }
  assert.ok(reglas >= 10, `se esperaban las reglas de Arrecife en los módulos (hay ${reglas})`);

  // Las atmósferas no tienen reglas para Arrecife: no se le aplican.
  assert.doesNotMatch(await leer("styles/atmosferas.css"), /arrecife/i);
});
