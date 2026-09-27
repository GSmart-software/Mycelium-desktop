// Test headless del corrector ortográfico (`FUN-L-12`).
//
// Cubre las piezas que se pueden probar sin la app:
//
//   - `lib/ortografia/palabras.ts`: extracción de palabras, exclusiones, caché,
//     el archivo del diccionario del vault y la regla de mayúsculas.
//   - `lib/ortografia/idioma.ts`: la región del sistema y el *fallback* de la
//     variante (es-AR → es-ES).
//   - `lib/ortografia/manifiesto.ts`: validación y URLs relativas del manifiesto,
//     y el estado de cada idioma.
//   - `lib/ortografia/motor.ts` con el `.wasm` REAL (`public/ortografia/motor.wasm`).
//   - `lib/ortografia/corrector.worker.ts`: el protocolo, «correcta en alguno»,
//     el diccionario del vault y las sugerencias intercaladas.
//   - `lib/editor/ortografiaExclusiones.ts` con un `EditorState` real de
//     CodeMirror: lo que no es prosa no se revisa (criterio 5).
//
// Los módulos puros se importan por `data:` URL, como en los demás tests. Los que
// importan paquetes de npm o entre sí se transpilan a una carpeta temporal
// DENTRO de `frontend/` para que node resuelva `node_modules` (como
// `test-embeds.mjs`).
//
// Si están los diccionarios reales (`npm run publicar-diccionarios -- --simulacro`
// los deja en `.diccionarios-fuente/`), se prueban además el voseo con es-AR y
// español + inglés a la vez (criterios 3 y 4); si no, esas pruebas se saltean.
//
//   node --test scripts/test-ortografia.mjs
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { after, test } from "node:test";
import ts from "typescript";

const AQUI = dirname(fileURLToPath(import.meta.url));
const FRONTEND = join(AQUI, "..");
const TMP = join(FRONTEND, ".tmp-test-ortografia");
const WASM = join(FRONTEND, "public", "ortografia", "motor.wasm");
const FUENTES = join(FRONTEND, ".diccionarios-fuente", "node_modules");

function transpilar(fuente) {
  return ts.transpileModule(fuente, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
}

async function importarPuro(rel) {
  const js = transpilar(await readFile(join(FRONTEND, rel), "utf8"));
  return import(`data:text/javascript,${encodeURIComponent(js)}`);
}

const P = await importarPuro("lib/ortografia/palabras.ts");
const I = await importarPuro("lib/ortografia/idioma.ts");
const M = await importarPuro("lib/ortografia/manifiesto.ts");
const { crearMotor } = await importarPuro("lib/ortografia/motor.ts");

// Los que se importan entre sí o importan paquetes: a la carpeta temporal.
await rm(TMP, { recursive: true, force: true });
await mkdir(TMP, { recursive: true });
for (const rel of [
  "lib/ortografia/palabras.ts",
  "lib/ortografia/motor.ts",
  "lib/ortografia/corrector.worker.ts",
  "lib/editor/ortografiaExclusiones.ts",
  "lib/editor/matematicas.ts",
]) {
  const js = transpilar(await readFile(join(FRONTEND, rel), "utf8"))
    .replace(/(["'])@\/lib\/(?:[A-Za-z0-9_-]+\/)*([A-Za-z0-9_.-]+)\1/g, '"./$2.mjs"')
    .replace(/(["'])\.\/([A-Za-z0-9_.-]+)\1/g, (m, _q, nombre) => (nombre.endsWith(".mjs") ? m : `"./${nombre}.mjs"`));
  await writeFile(join(TMP, `${rel.split("/").pop().replace(/\.ts$/, "")}.mjs`), js);
}
after(async () => {
  await rm(TMP, { recursive: true, force: true });
});

const bytesWasm = await readFile(WASM);

/** Un diccionario Hunspell mínimo: sufijo `S` para el plural. */
const AFF_ES = "SET UTF-8\nTRY aeiouscnrtl\nSFX S Y 1\nSFX S 0 s .\n";
const DIC_ES = "5\ncasa/S\nperro/S\nhola\ntambién\nnota/S\n";
const AFF_EN = "SET UTF-8\nTRY aeiouhstn\nSFX S Y 1\nSFX S 0 s .\n";
const DIC_EN = "3\nhouse/S\nhello\nnote/S\n";
const bytes = (s) => new TextEncoder().encode(s);

// ── Palabras ─────────────────────────────────────────────────────────────────

test("extrae palabras con su posición, con tildes y apóstrofos internos", () => {
  const ps = P.extraerPalabras("Hola, ¿cómo andás? l'amico don’t", 10);
  assert.deepEqual(
    ps.map((p) => p.texto),
    ["Hola", "cómo", "andás", "l'amico", "don’t"],
  );
  assert.deepEqual(ps[0], { texto: "Hola", desde: 10, hasta: 14 });
  assert.equal(ps[1].desde, 10 + "Hola, ¿".length);
});

test("descarta lo que no es prosa: dígitos, guion bajo, camelCase y letras sueltas", () => {
  const ps = P.extraerPalabras("abc123 mi_variable JavaScript iPhone x y casa 2026 v1");
  assert.deepEqual(ps.map((p) => p.texto), ["casa"]);
});

test("el apóstrofo tipográfico se normaliza al recto", () => {
  assert.equal(P.normalizarPalabra("l’amico"), "l'amico");
});

test("las palabras que tocan un intervalo excluido quedan afuera, aunque sea en parte", () => {
  const ps = P.extraerPalabras("uno dos tres cuatro cinco");
  // «dos» entero, la mitad de «cuatro», y un intervalo largo que tapa a uno corto.
  const quedan = P.fueraDeExcluidos(ps, [
    { desde: 15, hasta: 16 },
    { desde: 4, hasta: 7 },
  ]);
  assert.deepEqual(quedan.map((p) => p.texto), ["uno", "tres", "cinco"]);
  const tapado = P.fueraDeExcluidos(ps, [{ desde: 0, hasta: 12 }, { desde: 5, hasta: 6 }]);
  assert.deepEqual(tapado.map((p) => p.texto), ["cuatro", "cinco"]);
  assert.equal(P.fueraDeExcluidos(ps, []).length, 5);
});

test("el caché pide solo las únicas que no conoce", () => {
  const c = new P.CacheOrtografia();
  assert.deepEqual(c.pendientes(["a1", "b1", "a1", "c1"]), ["a1", "b1", "c1"]);
  c.guardar(["a1", "b1"], [true, false]);
  assert.deepEqual(c.pendientes(["a1", "b1", "c1", "c1"]), ["c1"]);
  assert.equal(c.consultar("b1"), false);
  assert.equal(c.consultar("zz"), undefined);
  c.aceptar("b1");
  assert.equal(c.consultar("b1"), true);
  c.vaciar();
  assert.equal(c.tamano, 0);
});

test("el caché olvida lo más viejo al pasar el tope", () => {
  const c = new P.CacheOrtografia(3);
  c.guardar(["a", "b", "c"], [true, true, true]);
  c.guardar(["d", "e"], [false, false]);
  assert.equal(c.tamano, 3);
  assert.equal(c.consultar("a"), undefined);
  assert.equal(c.consultar("e"), false);
});

test("el diccionario del vault: una por renglón, sin vacíos ni comentarios, ordenado y estable", () => {
  const texto = "zeta\r\n\n# un comentario\nMycelium\nárbol\nzeta\n  vault  \nl’amico\n";
  const palabras = P.leerDiccionarioVault(texto);
  assert.deepEqual(palabras, ["árbol", "l'amico", "Mycelium", "vault", "zeta"]);
  assert.equal(P.escribirDiccionarioVault(palabras), "árbol\nl'amico\nMycelium\nvault\nzeta\n");
  assert.deepEqual(P.leerDiccionarioVault(P.escribirDiccionarioVault(palabras)), palabras);
  assert.deepEqual(P.leerDiccionarioVault(null), []);
  assert.equal(P.escribirDiccionarioVault([]), "");
});

test("la regla de mayúsculas de las palabras aceptadas", () => {
  const c = new Set(["casa", "Mycelium"]);
  for (const ok of ["casa", "Casa", "CASA", "Mycelium", "MYCELIUM"]) assert.ok(P.aceptadaPor(c, ok), ok);
  for (const mal of ["cAsa", "mycelium", "MyCelium", "perro"]) assert.ok(!P.aceptadaPor(c, mal), mal);
});

// ── Idioma ───────────────────────────────────────────────────────────────────

test("lengua y región de un locale", () => {
  assert.deepEqual(I.partesDeLocale("es-AR"), { lengua: "es", region: "AR" });
  assert.deepEqual(I.partesDeLocale("es_ar"), { lengua: "es", region: "AR" });
  assert.deepEqual(I.partesDeLocale("es-419"), { lengua: "es", region: "419" });
  assert.deepEqual(I.partesDeLocale("zh-Hant-TW"), { lengua: "zh", region: "TW" });
  assert.deepEqual(I.partesDeLocale("es"), { lengua: "es", region: null });
  assert.deepEqual(I.partesDeLocale("es-AR-u-ca-gregory"), { lengua: "es", region: "AR" });
  assert.equal(I.partesDeLocale("???"), null);
});

test("la región del sistema es la del primer locale que la tenga", () => {
  assert.equal(I.regionDelSistema(["es-AR", "en-US"]), "AR");
  assert.equal(I.regionDelSistema(["es", "en-US"]), "US");
  assert.equal(I.regionDelSistema(["en-AR"]), "AR", "Windows en inglés, en Argentina");
  assert.equal(I.regionDelSistema(["es"]), null);
  assert.equal(I.lenguaDelSistema(["???", "it-IT"]), "it");
});

test("la variante: la de la región, si no la por defecto (es-ES)", () => {
  const es = {
    porDefecto: "es-ES",
    variantes: [
      { id: "es-ES", region: "ES" },
      { id: "es-AR", region: "AR" },
      { id: "es-MX", region: "MX" },
    ],
  };
  assert.equal(I.elegirVariante(es, "AR").id, "es-AR");
  assert.equal(I.elegirVariante(es, "ar").id, "es-AR");
  assert.equal(I.elegirVariante(es, "FR").id, "es-ES", "región sin variante");
  assert.equal(I.elegirVariante(es, null).id, "es-ES", "sin región");
  assert.equal(I.elegirVariante({ ...es, porDefecto: "es-XX" }, null).id, "es-ES", "por defecto mal nombrado: la primera");
  assert.equal(I.elegirVariante({ porDefecto: "en-US", variantes: [{ id: "en-US", region: "US" }] }, "AR").id, "en-US");
  assert.equal(I.elegirVariante({ porDefecto: "x", variantes: [] }, "AR"), null);
});

// ── Manifiesto ───────────────────────────────────────────────────────────────

const H = (c) => c.repeat(64);
function manifiestoDePrueba() {
  return {
    version: 1,
    idiomas: [
      {
        id: "es",
        nombre: "Español",
        porDefecto: "es-ES",
        licencia: "GPL-3.0-or-later OR LGPL-3.0-or-later OR MPL-1.1",
        urlLicencia: "es-ES/1.0.0/LICENSE.txt",
        urlFuente: "https://github.com/sbosio/rla-es",
        autor: "RLA-ES",
        variantes: [
          { region: "ES", id: "es-ES", version: "1.0.0", aff: "es-ES/1.0.0/es-ES.aff.gz", dic: "es-ES/1.0.0/es-ES.dic.gz", sha256Aff: H("a"), sha256Dic: H("b"), bytes: 233000 },
          { region: "AR", id: "es-AR", version: "1.1.0", aff: "es-AR/1.1.0/es-AR.aff.gz", dic: "es-AR/1.1.0/es-AR.dic.gz", sha256Aff: H("C"), sha256Dic: H("d"), bytes: 226000 },
        ],
      },
    ],
  };
}

test("el manifiesto se valida y sus URLs relativas se resuelven contra la suya", () => {
  const m = M.parsearManifiesto(JSON.stringify(manifiestoDePrueba()), "https://r2.dev/diccionarios/manifiesto.json");
  const ar = m.idiomas[0].variantes[1];
  assert.equal(ar.aff, "https://r2.dev/diccionarios/es-AR/1.1.0/es-AR.aff.gz");
  assert.equal(ar.licencia, "https://r2.dev/diccionarios/es-AR/1.1.0/LICENSE.txt");
  assert.equal(ar.sha256Aff, H("c"), "el hash se normaliza a minúsculas");
  assert.equal(m.idiomas[0].urlLicencia, "https://r2.dev/diccionarios/es-ES/1.0.0/LICENSE.txt");
  // Desde una carpeta local (desarrollo).
  const local = M.parsearManifiesto(JSON.stringify(manifiestoDePrueba()), "file:///C:/dev/.diccionarios/manifiesto.json");
  assert.equal(local.idiomas[0].variantes[0].dic, "file:///C:/dev/.diccionarios/es-ES/1.0.0/es-ES.dic.gz");
});

test("un manifiesto mal formado se rechaza con un motivo", () => {
  const url = "https://r2.dev/m.json";
  const con = (f) => {
    const m = manifiestoDePrueba();
    f(m);
    return JSON.stringify(m);
  };
  assert.throws(() => M.parsearManifiesto("{no es json", url), /JSON/);
  assert.throws(() => M.parsearManifiesto(con((m) => (m.version = 2)), url), /versión/);
  assert.throws(() => M.parsearManifiesto(con((m) => delete m.idiomas), url), /idiomas/);
  assert.throws(() => M.parsearManifiesto(con((m) => (m.idiomas[0].variantes[0].sha256Dic = "xyz")), url), /sha256/);
  assert.throws(() => M.parsearManifiesto(con((m) => (m.idiomas[0].variantes[0].id = "../x")), url), /variante/);
  assert.throws(() => M.parsearManifiesto(con((m) => (m.idiomas[0].variantes[0].id = "en-US")), url), /variante/);
  assert.throws(() => M.parsearManifiesto(con((m) => (m.idiomas[0].variantes[0].version = "1.0")), url), /X\.Y\.Z/);
  assert.throws(() => M.parsearManifiesto(con((m) => (m.idiomas[0].variantes[0].bytes = "mucho")), url), /tamaño/);
  assert.throws(() => M.parsearManifiesto(con((m) => delete m.idiomas[0].autor), url), /autor/);
  // Un campo de más no molesta (versiones futuras); un idioma sin variantes se descarta.
  const extra = M.parsearManifiesto(con((m) => {
    m.nuevo = true;
    m.idiomas.push({ ...m.idiomas[0], id: "en", variantes: [] });
  }), url);
  assert.equal(extra.idiomas.length, 1);
});

test("el estado de un idioma: no descargado, descargado, actualizable", () => {
  const m = M.parsearManifiesto(JSON.stringify(manifiestoDePrueba()), "https://r2.dev/m.json");
  const es = m.idiomas[0];
  const ar = es.variantes[1];
  assert.deepEqual(M.estadoIdioma(es, [], ar), { variante: ar, instalado: null, actualizable: false });
  assert.equal(M.estadoIdioma(es, [{ id: "es-AR", version: "1.1.0" }], ar).actualizable, false);
  assert.equal(M.estadoIdioma(es, [{ id: "es-AR", version: "1.0.0" }], ar).actualizable, true, "versión nueva");
  assert.equal(M.estadoIdioma(es, [{ id: "es-ES", version: "1.0.0" }], ar).actualizable, true, "otra región");
  assert.equal(M.estadoIdioma(es, [{ id: "en-US", version: "1.0.0" }], ar).instalado, null);
});

test("qué cargar: una variante por lengua activa y descargada, sin manifiesto", () => {
  const descargados = [
    { id: "en-US", version: "1.0.0" },
    { id: "es-ES", version: "1.0.0" },
    { id: "es-AR", version: "1.0.0" },
  ];
  assert.deepEqual(M.diccionariosACargar(["es"], descargados, ["es-AR"]).map((d) => d.id), ["es-AR"]);
  assert.deepEqual(M.diccionariosACargar(["es", "en", "it"], descargados).map((d) => d.id), ["es-ES", "en-US"]);
  assert.deepEqual(M.diccionariosACargar([], descargados), []);
});

test("versiones y tamaños", () => {
  assert.ok(M.compararVersiones("1.0.0", "1.0.1") < 0);
  assert.ok(M.compararVersiones("1.10.0", "1.9.9") > 0);
  assert.equal(M.compararVersiones("2.0.0", "2.0.0"), 0);
  assert.equal(M.formatearBytes(512), "512 B");
  assert.equal(M.formatearBytes(226000), "221 KB");
  assert.equal(M.formatearBytes(1.5 * 1024 * 1024), "1,5 MB");
});

// ── Motor WASM ───────────────────────────────────────────────────────────────

test("el motor real revisa, sugiere y agrega", async () => {
  const motor = await crearMotor(bytesWasm);
  const es = motor.cargar(bytes(AFF_ES), bytes(DIC_ES));
  assert.ok(es.revisar("casas"), "con sufijo");
  assert.ok(es.revisar("también"), "con tilde");
  assert.ok(!es.revisar("tambien"));
  assert.ok(es.sugerir("tambien").includes("también"));
  assert.ok(!es.revisar("Mycelium"));
  assert.ok(es.agregar("Mycelium"));
  assert.ok(es.revisar("Mycelium"));
  assert.ok(!es.agregar("con/barra"), "una barra separaría las banderas");
  // Una palabra larguísima no desborda el búfer.
  assert.ok(!es.revisar("a".repeat(5000)));
  es.liberar();
  assert.throws(() => motor.cargar(bytes(""), bytes("no es un dic")), /no se pudo leer/i);
});

// ── Worker ───────────────────────────────────────────────────────────────────

/** Arranca el worker en este proceso, con `self` y `fetch` de mentira. */
async function worker() {
  const respuestas = [];
  const esperas = [];
  globalThis.self = {
    postMessage(m) {
      respuestas.push(m);
      esperas.splice(0).forEach((r) => r());
    },
  };
  globalThis.fetch = async () => ({ ok: true, arrayBuffer: async () => bytesWasm.buffer.slice(0) });
  await import(`${pathToFileURL(join(TMP, "corrector.worker.mjs")).href}?${Math.random()}`);
  const enviar = (m) => self.onmessage({ data: m });
  const siguiente = async (tipo) => {
    for (;;) {
      const i = respuestas.findIndex((r) => r.tipo === tipo);
      if (i >= 0) return respuestas.splice(i, 1)[0];
      await new Promise((r) => esperas.push(r));
    }
  };
  return { enviar, siguiente };
}

test("el worker: correcta en alguno, el diccionario del vault y sugerencias intercaladas", async () => {
  const w = await worker();
  w.enviar({ tipo: "iniciar", urlMotor: "motor.wasm" });
  // Sin diccionarios, nada se marca.
  w.enviar({ tipo: "revisar", n: 1, palabras: ["xyzzy"] });
  assert.deepEqual((await w.siguiente("revisado")).correctas, [true]);

  w.enviar({
    tipo: "diccionarios",
    lista: [
      { id: "es-XX", aff: bytes(AFF_ES).buffer, dic: bytes(DIC_ES).buffer },
      { id: "en-XX", aff: bytes(AFF_EN).buffer, dic: bytes(DIC_EN).buffer },
      { id: "it-XX", aff: bytes(""), dic: bytes("") },
    ],
  });
  const cargados = await w.siguiente("cargados");
  assert.deepEqual(cargados.ids, ["es-XX", "en-XX"]);
  assert.equal(cargados.errores[0].id, "it-XX", "uno roto no impide cargar los demás");

  w.enviar({ tipo: "revisar", n: 2, palabras: ["casas", "houses", "Hola", "cassa", "Mycelium"] });
  assert.deepEqual((await w.siguiente("revisado")).correctas, [true, true, true, false, false]);

  // Diccionario del vault (e ignoradas): con la regla de mayúsculas.
  w.enviar({ tipo: "personales", palabras: ["Mycelium", "vault"] });
  w.enviar({ tipo: "revisar", n: 3, palabras: ["Mycelium", "MYCELIUM", "Vault", "mycelium"] });
  assert.deepEqual((await w.siguiente("revisado")).correctas, [true, true, true, false]);
  // Lo agregado también se sugiere.
  w.enviar({ tipo: "sugerir", n: 4, palabra: "Mycelum" });
  assert.ok((await w.siguiente("sugerido")).sugerencias.includes("Mycelium"));

  // Quitar una palabra del vault la vuelve a marcar (recarga los diccionarios).
  w.enviar({ tipo: "personales", palabras: ["vault"] });
  w.enviar({ tipo: "revisar", n: 5, palabras: ["Mycelium", "vault", "casa"] });
  assert.deepEqual((await w.siguiente("revisado")).correctas, [false, true, true]);

  // Sugerencias de los dos idiomas, intercaladas, como mucho cinco.
  w.enviar({ tipo: "sugerir", n: 6, palabra: "nota" });
  w.enviar({ tipo: "sugerir", n: 7, palabra: "hollo" });
  const s6 = await w.siguiente("sugerido");
  const s7 = await w.siguiente("sugerido");
  assert.equal(s6.n, 6, "las respuestas llegan en orden");
  assert.ok(s7.sugerencias.length <= 5);
  assert.ok(s7.sugerencias.includes("hola") && s7.sugerencias.includes("hello"), s7.sugerencias.join(","));
});

// ── Exclusiones con CodeMirror ───────────────────────────────────────────────

test("lo que no es prosa no se revisa (criterio 5)", async () => {
  const { EditorState } = await import("@codemirror/state");
  const { ensureSyntaxTree } = await import("@codemirror/language");
  const { markdown } = await import("@codemirror/lang-markdown");
  const { GFM } = await import("@lezer/markdown");
  const { rangosExcluidos } = await import(pathToFileURL(join(TMP, "ortografiaExclusiones.mjs")).href);

  const doc = [
    "---",
    "etikueta: valorz",
    "---",
    "Prosa buena con errorr.",
    "Código `codigoz` y un [[Enlacez raro]] y ![[Imagenz]].",
    "Etiqueta #etiketa y fórmula $\\alfaz + betaz$.",
    "Una URL https://ejemploz.com/rutaz y <https://otroz.com> y [texto](https://linkz.com).",
    "Correo alguienz@dominioz.com al pie.",
    "> [!warningz] Titulo del callout",
    "```js",
    "const variablez = funcionz();",
    "```",
    "$$",
    "\\sumaz_{i} x",
    "$$",
    "<span>htmlz</span> finalerror",
  ].join("\n");
  const state = EditorState.create({ doc, extensions: [markdown({ extensions: GFM })] });
  ensureSyntaxTree(state, state.doc.length, 5000);
  const excluidos = rangosExcluidos(state, [{ from: 0, to: state.doc.length }]);
  const quedan = P.fueraDeExcluidos(P.extraerPalabras(doc, 0), excluidos).map((p) => p.texto);

  for (const fuera of [
    "etikueta", "valorz", "codigoz", "Enlacez", "Imagenz", "etiketa", "alfaz", "betaz",
    "ejemploz", "rutaz", "otroz", "linkz", "alguienz", "dominioz", "warningz",
    "variablez", "funcionz", "sumaz", "span", "bloquez",
  ]) {
    assert.ok(!quedan.includes(fuera), `«${fuera}» no debería revisarse`);
  }
  // El texto ENTRE etiquetas en línea sí es prosa; lo excluido son las etiquetas.
  for (const dentro of ["Prosa", "errorr", "Código", "Titulo", "callout", "texto", "finalerror", "Correo", "htmlz"]) {
    assert.ok(quedan.includes(dentro), `«${dentro}» es prosa y se revisa`);
  }
});

// ── Diccionarios reales (si están) ───────────────────────────────────────────

const hayReales = existsSync(join(FUENTES, "dictionary-es-ar", "index.dic"));

test("con es-AR, el voseo no se marca; con es-ES sí (criterio 3)", { skip: !hayReales && "sin .diccionarios-fuente" }, async () => {
  const motor = await crearMotor(bytesWasm);
  const leer = async (p) => motor.cargar(
    await readFile(join(FUENTES, p, "index.aff")),
    await readFile(join(FUENTES, p, "index.dic")),
  );
  const ar = await leer("dictionary-es-ar");
  const es = await leer("dictionary-es");
  for (const v of ["tenés", "vení", "decime"]) assert.ok(ar.revisar(v), `es-AR: ${v}`);
  assert.ok(!es.revisar("tenés"), "es-ES marca el voseo");
  assert.ok(!ar.revisar("tambien") && ar.sugerir("tambien").includes("también"));
});

test("con español e inglés, una palabra inglesa bien escrita no se marca (criterio 4)", { skip: !hayReales && "sin .diccionarios-fuente" }, async () => {
  const motor = await crearMotor(bytesWasm);
  const es = motor.cargar(await readFile(join(FUENTES, "dictionary-es", "index.aff")), await readFile(join(FUENTES, "dictionary-es", "index.dic")));
  const en = motor.cargar(await readFile(join(FUENTES, "dictionary-en", "index.aff")), await readFile(join(FUENTES, "dictionary-en", "index.dic")));
  const correcta = (w) => es.revisar(w) || en.revisar(w);
  assert.ok(!es.revisar("background") && correcta("background"));
  assert.ok(correcta("árbol") && correcta("houses"));
  assert.ok(!correcta("arbolz"));
});
