// Test headless de `lib/homonimos.ts` (`DEF-134`): que renombrar, crear o mover
// una nota con el título de otra no cambie a dónde lleva ningún `[[enlace]]`
// que ya existía. Se transpilan los módulos puros en el momento, igual que
// `scripts/test-wikilinks.mjs`.
//
//   node --test scripts/test-homonimos.mjs
//   node scripts/test-homonimos.mjs
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import ts from "typescript";

const aUrl = (codigo) => `data:text/javascript,${encodeURIComponent(codigo)}`;

/** Transpila un `.ts` del repo y reemplaza sus imports según `mapa`. */
async function fuente(ruta, mapa = {}) {
  const texto = await readFile(fileURLToPath(new URL(ruta, import.meta.url)), "utf8");
  let { outputText } = ts.transpileModule(texto, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 },
  });
  for (const [especificador, url] of Object.entries(mapa)) {
    outputText = outputText.split(`"${especificador}"`).join(`"${url}"`);
  }
  return aUrl(outputText);
}

const EXTENSIONES = await fuente("../lib/extensionesDeTipo.ts");
const WIKILINKS = await fuente("../lib/wikilinks.ts", { "@/lib/extensionesDeTipo": EXTENSIONES });
const ENLACES = await fuente("../lib/enlaces.ts");
const H = await import(await fuente("../lib/homonimos.ts", { "@/lib/wikilinks": WIKILINKS, "@/lib/enlaces": ENLACES }));

const md = (id) => {
  const nombre = id.slice(id.lastIndexOf("/") + 1);
  const p = nombre.lastIndexOf(".");
  const tipo = { ".md": "markdown", ".canvas": "canvas", ".excalidraw": "excalidraw" }[nombre.slice(p)] ?? "markdown";
  return { id, titulo: nombre.slice(0, p), tipo };
};
const carpeta = (id) => (id.includes("/") ? id.slice(0, id.lastIndexOf("/")) : "");
const ext = (id) => id.slice(id.lastIndexOf("."));

/** Un archivo que pasa de `id` a `idNuevo` (renombrar o mover), como lo arma la app. */
function traslado(id, idNuevo) {
  const viejo = md(id);
  const nuevo = md(idNuevo);
  return {
    id,
    idNuevo,
    titulo: nuevo.titulo,
    cambio: {
      tituloViejo: viejo.titulo,
      tituloNuevo: nuevo.titulo,
      carpetaVieja: carpeta(id),
      carpetaNueva: carpeta(idNuevo),
      extension: ext(id),
    },
  };
}

/**
 * Lo que hace la app de punta a punta, sin E/S: involucradas antes, el vault de
 * después y la reparación del texto de una nota que enlaza.
 */
function operar(antes, { traslados = [], nuevas = [] }, texto) {
  const despues = [...H.trasTraslados(antes, traslados), ...nuevas];
  const titulos = [...traslados.map((t) => t.titulo), ...nuevas.map((n) => n.titulo)];
  const inv = H.involucradas(antes, traslados.map((t) => t.id), titulos);
  const plan = H.planHomonimos(antes, despues, inv, traslados);
  return { ...H.repararTexto(texto, plan), despues };
}

const VAULT = ["Cultivos/Tomate.md", "Riego de verano.md", "Diario.md"].map(md);

test("renombrar a un título que existe en otra carpeta: los enlaces a la otra pasan a llevar su ruta", () => {
  const texto =
    "[[Tomate]] y [[Tomate|el tomate]], ![[Tomate#Cuidados]] y [[ tomate ]].\n" + "Riego: [[Riego de verano|regar]].";
  const r = operar(VAULT, { traslados: [traslado("Riego de verano.md", "Tomate.md")] }, texto);
  assert.equal(
    r.texto,
    "[[Cultivos/Tomate]] y [[Cultivos/Tomate|el tomate]], ![[Cultivos/Tomate#Cuidados]] y [[ Cultivos/Tomate ]].\n" +
      "Riego: [[Tomate|regar]].",
  );
  assert.equal(r.cambios, 5);
  assert.equal(r.conRuta, 4);
  // Y todo sigue llevando a donde llevaba.
  const despues = H.resolutorDe(r.despues);
  assert.equal(despues("Cultivos/Tomate"), "Cultivos/Tomate.md");
  assert.equal(despues("Tomate"), "Tomate.md");
});

test("el alias con barra escapada (tabla) y los bloques de código se respetan", () => {
  const esc = String.fromCharCode(92) + "|";
  const texto = `| a | [[Tomate${esc}tomate]] |\n\`\`\`\n[[Tomate]]\n\`\`\``;
  const r = operar(VAULT, { traslados: [traslado("Riego de verano.md", "Tomate.md")] }, texto);
  assert.equal(r.texto, `| a | [[Cultivos/Tomate${esc}tomate]] |\n\`\`\`\n[[Tomate]]\n\`\`\``);
});

test("segundo renombre: con las referencias ya con ruta, solo se toca lo que apunta a la renombrada", () => {
  const primero = operar(
    VAULT,
    { traslados: [traslado("Riego de verano.md", "Tomate.md")] },
    "[[Tomate]] [[Tomate|el tomate]] [[Riego de verano|regar]]",
  );
  assert.equal(primero.texto, "[[Cultivos/Tomate]] [[Cultivos/Tomate|el tomate]] [[Tomate|regar]]");
  const segundo = operar(primero.despues, { traslados: [traslado("Tomate.md", "Riego.md")] }, primero.texto);
  assert.equal(segundo.texto, "[[Cultivos/Tomate]] [[Cultivos/Tomate|el tomate]] [[Riego|regar]]");
  assert.equal(segundo.conRuta, 0);
});

test("el bug original: sin la reparación, el segundo renombre se llevaba los enlaces del cultivo", () => {
  // Así quedaba el vault con el defecto: los `[[Tomate]]` sin ruta tras el
  // primer renombre resolvían a la nota de riego (la de la raíz).
  const despues = H.trasTraslados(VAULT, [traslado("Riego de verano.md", "Tomate.md")]);
  assert.equal(H.resolutorDe(despues)("Tomate"), "Tomate.md");
  // Con la ruta, el cultivo ya no depende de quién está más cerca de la raíz.
  assert.equal(H.resolutorDe(despues)("Cultivos/Tomate"), "Cultivos/Tomate.md");
});

test("renombrar en una carpeta a un título que gana otra homónima: la renombrada lleva su ruta", () => {
  const antes = ["Tomate.md", "Notas/Riego.md", "Diario.md"].map(md);
  const r = operar(antes, { traslados: [traslado("Notas/Riego.md", "Notas/Tomate.md")] }, "[[Riego]] [[Tomate]]");
  // `[[Tomate]]` sigue en la de la raíz; `[[Riego]]` pasa a la ruta de la renombrada.
  assert.equal(r.texto, "[[Notas/Tomate]] [[Tomate]]");
  assert.equal(r.conRuta, 1);
});

test("crear una homónima más cerca de la raíz: los enlaces a la otra pasan a llevar su ruta", () => {
  const r = operar(VAULT, { nuevas: [md("Tomate.md")] }, "Ver [[Tomate]] y ![[Tomate]] y [[Diario]].");
  assert.equal(r.texto, "Ver [[Cultivos/Tomate]] y ![[Cultivos/Tomate]] y [[Diario]].");
  assert.equal(r.conRuta, 2);
});

test("crear una homónima más profunda: nada cambia de destino, pero la coincidencia se informa", () => {
  const r = operar(VAULT, { nuevas: [md("Huerta/Viejo/Tomate.md")] }, "[[Tomate]]");
  assert.equal(r.texto, "[[Tomate]]");
  assert.equal(r.cambios, 0);
  const cs = H.coincidencias(r.despues, ["Huerta/Viejo/Tomate.md"]);
  assert.deepEqual(cs, [{ titulo: "Tomate", carpetas: ["Cultivos"] }]);
  assert.equal(
    H.textoAviso(cs, 0),
    "Hay otra nota llamada «Tomate» (en Cultivos). Ningún enlace cambió de destino.",
  );
});

test("mover una homónima hacia la raíz cambia el ganador: los enlaces a la otra llevan la ruta", () => {
  const antes = ["Cultivos/Tomate.md", "Archivo/Viejo/Tomate.md", "Diario.md"].map(md);
  const r = operar(
    antes,
    { traslados: [traslado("Archivo/Viejo/Tomate.md", "Tomate.md")] },
    "[[Tomate]] / [[Viejo/Tomate|la vieja]]",
  );
  // El primero iba a Cultivos (menos profunda); el segundo, con pista, a la movida.
  assert.equal(r.texto, "[[Cultivos/Tomate]] / [[Tomate|la vieja]]");
  const despues = H.resolutorDe(r.despues);
  assert.equal(despues("Cultivos/Tomate"), "Cultivos/Tomate.md");
  assert.equal(despues("Tomate"), "Tomate.md");
});

test("mover lejos de la raíz: cada enlace sigue en la nota a la que iba", () => {
  const antes = ["Tomate.md", "Cultivos/Tomate.md", "Diario.md"].map(md);
  const r = operar(antes, { traslados: [traslado("Tomate.md", "Archivo/Tomate.md")] }, "[[Tomate]] [[Cultivos/Tomate]]");
  // A igual profundidad desempata la ruta: "Archivo/…" < "Cultivos/…". Sea
  // quien sea el ganador, cada enlace tiene que seguir en su nota.
  const despues = H.resolutorDe(r.despues);
  const [primero, segundo] = [...r.texto.matchAll(/\[\[([^\]]+)\]\]/g)].map((m) => despues(m[1]));
  assert.equal(primero, "Archivo/Tomate.md");
  assert.equal(segundo, "Cultivos/Tomate.md");

  // Si la otra queda ganando, la movida es la que necesita la ruta.
  const z = operar(antes, { traslados: [traslado("Tomate.md", "Zeta/Tomate.md")] }, "[[Tomate]] [[Cultivos/Tomate]]");
  assert.equal(z.texto, "[[Zeta/Tomate]] [[Cultivos/Tomate]]");
  assert.equal(z.conRuta, 1);
});

test("mover sin homónimas no cambia nada de lo que hacía la reparación de siempre", () => {
  const antes = ["Proyectos/Plan.md", "Diario.md"].map(md);
  const r = operar(antes, { traslados: [traslado("Proyectos/Plan.md", "Archivo/Plan.md")] }, "[[Plan]] [[Proyectos/Plan]]");
  assert.equal(r.texto, "[[Plan]] [[Archivo/Plan]]");
  assert.equal(r.conRuta, 0);
});

test("la nota de la raíz no markdown: la forma lleva la extensión si una markdown homónima le ganaría", () => {
  const despues = ["Tomate.canvas", "Cultivos/Tomate.md"].map(md);
  assert.equal(H.formaUnivoca("Tomate.canvas", despues), "Tomate.canvas");
  assert.equal(H.formaUnivoca("Cultivos/Tomate.md", despues), "Cultivos/Tomate");
  const conMd = ["Tomate.md", "Cultivos/Tomate.md"].map(md);
  assert.equal(H.formaUnivoca("Tomate.md", conMd), "Tomate");
});

test("un dibujo con el título de una nota no es coincidencia", () => {
  const despues = ["Tomate.excalidraw", "Cultivos/Tomate.md"].map(md);
  assert.deepEqual(H.coincidencias(despues, ["Tomate.excalidraw"]), []);
  // Y `[[Tomate]]` sigue yendo a la nota.
  const r = operar(["Cultivos/Tomate.md"].map(md), { nuevas: [md("Tomate.excalidraw")] }, "[[Tomate]]");
  assert.equal(r.texto, "[[Tomate]]");
});

test("el aviso: una coincidencia, varias carpetas, varias notas", () => {
  assert.equal(
    H.textoAviso([{ titulo: "Tomate", carpetas: ["Cultivos"] }], 3),
    "Hay otra nota llamada «Tomate» (en Cultivos). Para que ningún enlace cambie de destino, se escribieron con su ruta en 3 notas.",
  );
  assert.equal(
    H.textoAviso([{ titulo: "Tomate", carpetas: ["", "Huerta/Viejo"] }], 1),
    "Hay otras 2 notas llamadas «Tomate» (en la raíz, Huerta/Viejo). Para que ningún enlace cambie de destino, se escribieron con su ruta en 1 nota.",
  );
  assert.equal(
    H.textoAviso(
      [
        { titulo: "A", carpetas: ["X"] },
        { titulo: "B", carpetas: ["Y"] },
      ],
      0,
    ),
    "2 notas coinciden en título con otras del vault («A», «B»). Ningún enlace cambió de destino.",
  );
  assert.equal(H.textoAviso([], 4), null);
});

test("involucradas: lo que se traslada y las que ya se llamaban como queda", () => {
  const inv = H.involucradas(VAULT, ["Riego de verano.md"], ["tomate"]);
  assert.deepEqual(new Set(inv), new Set(["Riego de verano.md", "Cultivos/Tomate.md"]));
});
