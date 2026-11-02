// Test headless de `FUN-M-58` parte 5b: cuánta webapp de draw.io queda viva.
//
// Corre los `lib/drawioInstancias.ts` y `lib/drawioRender.ts` reales
// (transpilados en el momento) contra un DOM de mentira: los `iframe` son
// objetos que cuentan si siguen colgados del documento, y el «draw.io» de
// adentro contesta `init`, `load` y `export` por `postMessage` como el de verdad.
//
// Comprueba:
// - con tres diagramas abiertos y cambiando de pestaña, queda vivo el visible y
//   UN oculto (antes, tres en total: ~480 MB);
// - un oculto con cambios sin guardar no se suelta, y sale cuando se guarda;
// - el iframe renderizador de los embeds se suelta tras el tiempo ocioso y se
//   recrea en el próximo pedido, sin tocar un pedido en vuelo;
// - la caché devuelve el mismo SVG para el mismo XML sin despertar al iframe.
//
//   node --test scripts/test-drawio-memoria.mjs
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import ts from "typescript";

const aUrl = (codigo) => `data:text/javascript,${encodeURIComponent(codigo)}`;

async function fuente(ruta, mapa = {}, reemplazos = []) {
  let texto = await readFile(fileURLToPath(new URL(ruta, import.meta.url)), "utf8");
  for (const [de, a] of reemplazos) {
    assert.ok(texto.includes(de), `el reemplazo «${de}» ya no existe en ${ruta}`);
    texto = texto.split(de).join(a);
  }
  let { outputText } = ts.transpileModule(texto, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  });
  for (const [especificador, url] of Object.entries(mapa)) {
    outputText = outputText.split(`"${especificador}"`).join(`"${url}"`);
  }
  return aUrl(outputText);
}

const espera = (ms) => new Promise((r) => setTimeout(r, ms));

// ── DOM mínimo ───────────────────────────────────────────────────────────────
globalThis.window = new EventTarget();
globalThis.requestAnimationFrame = (f) => setTimeout(f, 0);
globalThis.cancelAnimationFrame = (id) => clearTimeout(id);
/** Anclas que el `ResizeObserver` de mentira está mirando. */
const observadas = new Set();
globalThis.ResizeObserver = class {
  observe(a) { observadas.add(a); }
  unobserve(a) { observadas.delete(a); }
  disconnect() { observadas.clear(); }
};

/** Todos los iframes colgados del documento ahora. */
const enDocumento = new Set();
/** Mensajes que el host le mandó a cada iframe. */
const recibidos = new Map();

function mandarAlHost(marco, datos) {
  const ev = new Event("message");
  ev.data = JSON.stringify(datos);
  ev.source = marco.contentWindow;
  window.dispatchEvent(ev);
}

function crearIframe() {
  const marco = {
    style: { cssText: "", display: "" },
    title: "",
    attrs: {},
    setAttribute(k, v) { this.attrs[k] = v; },
    remove() { enDocumento.delete(marco); },
    _src: "",
    get src() { return this._src; },
    set src(v) {
      this._src = v;
      // Como la webapp: tarda un poco en arrancar y avisa `init`.
      setTimeout(() => { if (enDocumento.has(marco)) mandarAlHost(marco, { event: "init" }); }, 5);
    },
  };
  marco.contentWindow = {
    postMessage(texto) {
      const accion = JSON.parse(texto);
      recibidos.set(marco, [...(recibidos.get(marco) ?? []), accion]);
      // El renderizador: `load` → avisa `load`; `export` → devuelve el SVG.
      if (accion.action === "load" && marco._src.includes("chrome=0")) {
        marco._xml = accion.xml;
        setTimeout(() => mandarAlHost(marco, { event: "load" }), 5);
      }
      if (accion.action === "export") {
        setTimeout(
          () => mandarAlHost(marco, { event: "export", data: `data:svg,${marco._xml.length}:${marco._xml}` }),
          marco._lento ?? 5,
        );
      }
    },
  };
  return marco;
}

globalThis.document = {
  createElement(tipo) {
    assert.equal(tipo, "iframe");
    return crearIframe();
  },
  body: { appendChild(n) { enDocumento.add(n); } },
};

const ancla = () => ({ getBoundingClientRect: () => ({ left: 0, top: 0, width: 400, height: 300 }) });

// ── Dobles ───────────────────────────────────────────────────────────────────
const DIAG = (n) => `<mxfile host="test"><diagram name="${n}"></diagram></mxfile>`;
const G = (globalThis.__drawio = { puts: [], lecturas: 0 });
const STUB = {
  api: aUrl(`export async function api(ruta, opts = {}) {
    const id = decodeURIComponent(ruta.split("/")[2]);
    if (opts.method === "PUT") { globalThis.__drawio.puts.push({ id, xml: opts.body.contenido }); return {}; }
    globalThis.__drawio.lecturas++;
    return { contenido: '<mxfile host="test"><diagram name="' + id + '"></diagram></mxfile>' };
  }`),
  ilegibles: aUrl(`export const analizarXml = () => null;
    export const diagnosticarDrawio = (t) => ({ estado: t.trim() ? "ok" : "vacio" });
    export const motivoDeExcepcion = (e) => String(e);`),
  eventos: aUrl(`export const EVENTO_RECARGA = "mycelium:recarga";`),
  recarga: aUrl(`export const avisoTocaA = () => false; export const hayQueRecargar = () => false;`),
  pendiente: aUrl(`export const registrarGuardadoPendiente = () => {}; export const olvidarGuardadoPendiente = () => {};`),
  auth: aUrl(`export const useAuthStore = { getState: () => ({ accessToken: null }) };`),
  sync: aUrl(`export const useSyncStore = { getState: () => ({ setSyncState() {} }) };`),
  tabs: aUrl(`export const allLeaves = () => []; export const useTabsStore = { getState: () => ({ root: null }), subscribe: () => () => {} };`),
  wikilink: aUrl(`export const resolveWikilink = () => undefined;`),
  vault: aUrl(`export const useVaultStore = { getState: () => ({ notas: [], carpetas: [] }) };`),
};
const DRAWIO = await fuente("../lib/drawio.ts");

const inst = await import(
  await fuente("../lib/drawioInstancias.ts", {
    "@/lib/api": STUB.api,
    "@/lib/archivosIlegibles": STUB.ilegibles,
    "@/lib/drawio": DRAWIO,
    "@/lib/eventos": STUB.eventos,
    "@/lib/recargaExterna": STUB.recarga,
    "@/lib/guardadoPendiente": STUB.pendiente,
    "@/stores/authStore": STUB.auth,
    "@/stores/syncStore": STUB.sync,
    "@/stores/tabsStore": STUB.tabs,
  })
);

const OCIOSO_TEST_MS = 60;
const render = await import(
  await fuente(
    "../lib/drawioRender.ts",
    {
      "@/lib/api": STUB.api,
      "@/lib/archivosIlegibles": STUB.ilegibles,
      "@/lib/drawio": DRAWIO,
      "@/lib/editor/wikilink": STUB.wikilink,
      "@/stores/vaultStore": STUB.vault,
    },
    // Un minuto real no cabe en un test: se acorta el tiempo ocioso.
    [["const OCIOSO_MS = 60_000;", `const OCIOSO_MS = ${OCIOSO_TEST_MS};`]],
  )
);

const editoresEnDocumento = () => [...enDocumento].filter((m) => !m._src.includes("chrome=0"));
const renderizadoresEnDocumento = () => [...enDocumento].filter((m) => m._src.includes("chrome=0"));

/** El editor (iframe) de una clave, para mandarle eventos como si fuera draw.io. */
function marcoDe(notaId) {
  return editoresEnDocumento().find((m) =>
    (recibidos.get(m) ?? []).some((a) => a.action === "load" && a.xml === DIAG(notaId)),
  );
}

// ── Editores ─────────────────────────────────────────────────────────────────

test("tres diagramas y cambios de pestaña: queda el visible y UN oculto", async () => {
  const hueco = ancla();
  // Abrir A, B y C en el mismo pane, uno tras otro (como cambiar de pestaña).
  inst.adjuntar("tab-A", "A.drawio", hueco, "claro");
  await espera(20);
  inst.desadjuntar("tab-A");
  inst.adjuntar("tab-B", "B.drawio", hueco, "claro");
  await espera(20);
  inst.desadjuntar("tab-B");
  inst.adjuntar("tab-C", "C.drawio", hueco, "claro");
  await espera(20);

  assert.equal(inst.vivos(), 2, "C visible + B oculto; A se soltó");
  assert.equal(editoresEnDocumento().length, 2, "y su iframe salió del documento");
  assert.ok(marcoDe("B.drawio"), "el oculto que queda es el último que se miró");
  assert.equal(marcoDe("A.drawio"), undefined);

  // Volver a B no recarga nada: el oculto sigue vivo.
  const lecturasAntes = G.lecturas;
  inst.desadjuntar("tab-C");
  inst.adjuntar("tab-B", "B.drawio", hueco, "claro");
  await espera(20);
  assert.equal(G.lecturas, lecturasAntes, "volver al oculto no relee ni recrea");
  assert.equal(inst.vivos(), 2, "B visible + C oculto");

  // Pasar de un diagrama a una nota (sin adjuntar otro) también poda.
  inst.desadjuntar("tab-B");
  await espera(20);
  assert.equal(inst.vivos(), 1, "con ningún diagrama visible, queda un solo oculto");
  assert.equal(observadas.size, 0, "sin visibles no se observa ningún ancla");

  inst.adjuntar("tab-C", "C.drawio", hueco, "claro");
  await espera(20);
  assert.equal(observadas.size, 1, "el visible se observa por tamaño (A-H10)");
  inst.desadjuntar("tab-C");
  await espera(20);
});

test("remontar el visible (desadjuntar y adjuntar en el mismo turno) no suelta al otro oculto", async () => {
  const hueco = ancla();
  inst.adjuntar("tab-R1", "R1.drawio", hueco, "claro");
  await espera(20);
  inst.desadjuntar("tab-R1");
  inst.adjuntar("tab-R2", "R2.drawio", hueco, "claro");
  await espera(20);
  const antes = inst.vivos();
  // Lo que hace React al mover la pestaña de pane o con el doble efecto.
  inst.desadjuntar("tab-R2");
  inst.adjuntar("tab-R2", "R2.drawio", ancla(), "claro");
  await espera(20);
  assert.equal(inst.vivos(), antes, "R1 (oculto) sigue vivo");
  assert.ok(marcoDe("R1.drawio"));
  inst.desadjuntar("tab-R2");
  await espera(20);
});

test("un oculto con cambios sin guardar no se suelta; sale cuando se guarda", async () => {
  const hueco = ancla();
  inst.adjuntar("tab-S1", "S1.drawio", hueco, "claro");
  await espera(20);
  // El usuario edita S1 y cambia de pestaña antes de que salga el guardado.
  mandarAlHost(marcoDe("S1.drawio"), { event: "autosave", xml: DIAG("S1-editado") });
  inst.desadjuntar("tab-S1");
  inst.adjuntar("tab-S2", "S2.drawio", hueco, "claro");
  await espera(20);
  inst.desadjuntar("tab-S2");
  inst.adjuntar("tab-S3", "S3.drawio", hueco, "claro");
  await espera(20);

  // Ocultos: S1 (sucio) y S2. Sobra uno, y no puede ser S1.
  assert.ok(marcoDe("S1.drawio"), "el sucio sigue vivo aunque sea el más viejo");
  assert.equal(marcoDe("S2.drawio"), undefined, "salió el limpio");
  assert.equal(
    G.puts.filter((p) => p.id === "S1.drawio").length,
    0,
    "todavía no se guardó: la poda no forzó nada",
  );

  // Sale el guardado (800 ms de calma): lo editado llega al disco.
  await espera(900);
  assert.deepEqual(
    G.puts.filter((p) => p.id === "S1.drawio").map((p) => p.xml),
    [DIAG("S1-editado")],
    "lo editado llegó al disco",
  );
  // Ahora es el único oculto: está dentro del tope y se queda.
  assert.ok(marcoDe("S1.drawio"));
  // Al ocultar S3 sobra uno, y como S1 ya está limpio y es el más viejo, sale él.
  inst.desadjuntar("tab-S3");
  await espera(20);
  assert.equal(marcoDe("S1.drawio"), undefined, "limpio, ya se puede soltar");
  assert.ok(marcoDe("S3.drawio"));
});

test("si todos los ocultos están sucios se quedan, aunque se pase del tope", async () => {
  const hueco = ancla();
  for (const n of ["T1", "T2", "T3"]) {
    inst.adjuntar(`tab-${n}`, `${n}.drawio`, hueco, "claro");
    await espera(20);
    mandarAlHost(marcoDe(`${n}.drawio`), { event: "autosave", xml: DIAG(`${n}-editado`) });
    inst.desadjuntar(`tab-${n}`);
  }
  await espera(20);
  for (const n of ["T1", "T2", "T3"]) assert.ok(marcoDe(`${n}.drawio`), `${n} sigue vivo`);
  await espera(900);
  for (const n of ["T1", "T2", "T3"]) {
    assert.equal(G.puts.filter((p) => p.id === `${n}.drawio`).length, 1, `${n} se guardó`);
  }
  assert.equal(inst.vivos(), 1, "guardados todos, vuelve al tope");
});

// ── Renderizador de embeds ───────────────────────────────────────────────────

test("la caché devuelve el mismo SVG para el mismo XML sin despertar al iframe", async () => {
  const xml = DIAG("embed-1");
  const a = await render.diagramaASvg(xml);
  assert.match(a, /^data:svg,/);
  const marco = renderizadoresEnDocumento()[0];
  const pedidosAntes = (recibidos.get(marco) ?? []).length;
  const b = await render.diagramaASvg(xml);
  assert.equal(b, a);
  assert.equal((recibidos.get(marco) ?? []).length, pedidosAntes, "no se le pidió nada al iframe");
  assert.equal(render.estadoRenderizador().enCache, 1);
});

test("dos pedidos simultáneos del mismo XML comparten el render", async () => {
  const xml = DIAG("embed-doble");
  const [a, b] = await Promise.all([render.diagramaASvg(xml), render.diagramaASvg(xml)]);
  assert.equal(a, b);
  const marco = renderizadoresEnDocumento()[0];
  const exportes = (recibidos.get(marco) ?? []).filter((x) => x.action === "load" && x.xml === xml);
  assert.equal(exportes.length, 1);
});

test("el renderizador se suelta tras el tiempo ocioso y se recrea en el próximo pedido", async () => {
  await espera(OCIOSO_TEST_MS + 40);
  assert.equal(render.estadoRenderizador().vivo, false, "se soltó");
  assert.equal(renderizadoresEnDocumento().length, 0, "y salió del documento");

  // Lo que ya estaba en caché se sigue sirviendo sin recrearlo.
  await render.diagramaASvg(DIAG("embed-1"));
  assert.equal(render.estadoRenderizador().vivo, false, "un acierto de caché no lo recrea");

  const svg = await render.diagramaASvg(DIAG("embed-2"));
  assert.match(svg, /embed-2/);
  assert.equal(render.estadoRenderizador().vivo, true, "un pedido nuevo lo recrea");
  assert.equal(renderizadoresEnDocumento().length, 1);
});

test("un pedido en vuelo no se corta aunque se cumpla el tiempo ocioso", async () => {
  await espera(OCIOSO_TEST_MS + 40);
  assert.equal(render.estadoRenderizador().vivo, false);
  // Primer pedido: rápido; arma el temporizador ocioso al terminar.
  await render.diagramaASvg(DIAG("rapido"));
  // Segundo pedido, lento: tarda más que el tiempo ocioso en exportar.
  const marco = renderizadoresEnDocumento()[0];
  marco._lento = OCIOSO_TEST_MS * 2;
  const lento = render.diagramaASvg(DIAG("lento"));
  await espera(OCIOSO_TEST_MS + 20);
  assert.equal(render.estadoRenderizador().vivo, true, "con un pedido en vuelo no se suelta");
  const svg = await lento;
  assert.match(svg, /lento/);
  marco._lento = undefined;
  await espera(OCIOSO_TEST_MS + 40);
  assert.equal(render.estadoRenderizador().vivo, false, "terminado, sí se suelta");
});

test("la caché de SVG está acotada", async () => {
  for (let i = 0; i < 40; i++) await render.diagramaASvg(DIAG(`muchos-${i}`));
  assert.ok(render.estadoRenderizador().enCache <= 32, "no pasa de 32 entradas");
  await espera(OCIOSO_TEST_MS + 40); // que no quede un temporizador vivo
});
