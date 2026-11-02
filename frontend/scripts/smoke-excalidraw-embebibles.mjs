// Smoke de qué se monta de un dibujo con recuadros web (`DEF-167`).
//
// Empaqueta con el webpack que trae Next una página mínima que monta el
// `<Excalidraw>` real del paquete con un dibujo que tiene recuadros web de
// YouTube, Vimeo, X, Reddit, un gist de GitHub, Figma y un elemento `iframe` con
// HTML guardado, y la abre en Chromium headless **sin red** (toda petición
// externa se aborta y se anota). Escenarios:
//
// - **control**: Excalidraw sin opciones. Tiene que montar el de X y el HTML
//   guardado (si no, el banco no estaría probando nada).
// - **solo renderEmbeddable**: la validación abierta a todo; la segunda barrera
//   sola tiene que frenar a los demás.
// - **solo vigilarIframes**: sin opciones ni limpieza; el vigilante del
//   contenedor solo tiene que dejar en blanco todo lo que no sea YouTube o Vimeo.
// - **Mycelium**: la misma configuración que `propsEmbebibles`,
//   `refVigilarIframes` y `leerEscena`. Solo pueden quedar los iframes de
//   www.youtube.com y player.vimeo.com, y ninguna petición a otro sitio.
// - **pegar, soltar un `.excalidraw` y soltar un `.excalidrawlib`** sobre un
//   dibujo vacío con la configuración de Mycelium: el HTML guardado no se muestra
//   ni pide nada; lo pegado y la biblioteca quedan sin él.
//
// También comprueba que los dos componentes usan `propsEmbebibles` y
// `refVigilarIframes`.
//
//   node scripts/smoke-excalidraw-embebibles.mjs
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { extname, join, normalize, resolve } from "node:path";
import { chromium } from "playwright";
import ts from "typescript";

const FRONTEND = resolve(import.meta.dirname, "..");
const require = createRequire(join(FRONTEND, "package.json"));
const { webpack } = require("next/dist/compiled/webpack/bundle5")();
const PUERTO = 3197;

let fallas = 0;
function comprobar(ok, mensaje) {
  console.log(`${ok ? "ok  " : "FALLA"} ${mensaje}`);
  if (!ok) fallas++;
}

// 1. Los componentes pasan las opciones; la lectura limpia la escena.
for (const archivo of ["ExcalidrawFileEditor.tsx", "ExcalidrawModal.tsx"]) {
  const fuente = readFileSync(join(FRONTEND, "components", "editor", archivo), "utf8");
  comprobar(
    /\{\.\.\.propsEmbebibles\(\(\) => apiRef\.current\)\}/.test(fuente),
    `${archivo} pasa {...propsEmbebibles(...)}`,
  );
  comprobar(/ref=\{refVigilarIframes\}/.test(fuente), `${archivo} vigila los iframes de su contenedor`);
}
const libExcalidraw = readFileSync(join(FRONTEND, "lib", "excalidraw.ts"), "utf8");
comprobar(
  /validateEmbeddable: esEmbebiblePermitido/.test(libExcalidraw) &&
    /esEmbebiblePermitido\(el\.link\) \? null/.test(libExcalidraw),
  "propsEmbebibles usa esEmbebiblePermitido en validateEmbeddable y renderEmbeddable",
);
comprobar(
  /onPaste: pegadoSinContenidoGenerado/.test(libExcalidraw) &&
    /bibliotecaSinContenidoGenerado\(items\)/.test(libExcalidraw),
  "propsEmbebibles limpia lo pegado (onPaste) y la biblioteca (onLibraryChange)",
);
comprobar(
  /sinContenidoGenerado\(restoreElements\(/.test(libExcalidraw),
  "leerEscena quita el HTML guardado de los elementos iframe",
);
comprobar(/renderEmbeddables: false/.test(libExcalidraw), "el SVG de la vista previa no monta recuadros web");

// 2. Bundle mínimo con el paquete real.
const tmp = mkdtempSync(join(tmpdir(), "smoke-embebibles-"));
const salida = join(tmp, "dist");
const { outputText } = ts.transpileModule(
  readFileSync(join(FRONTEND, "lib", "excalidrawEmbebibles.ts"), "utf8"),
  { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } },
);
writeFileSync(join(tmp, "embebibles.js"), outputText);

const ANCHO = 360;
const ALTO = 220;
const RECUADROS = [
  ["youtube", "https://www.youtube.com/watch?v=dQw4w9WgXcQ"],
  ["vimeo", "https://vimeo.com/76979871"],
  ["x", "https://x.com/usuario/status/1234567890"],
  ["reddit", "https://www.reddit.com/r/sub/comments/abc123/titulo/"],
  ["gist", "https://gist.github.com/usuario/abc123"],
  ["figma", "https://www.figma.com/file/abc/Diseno"],
];
const elementos = RECUADROS.map(([id, link], i) => ({
  id,
  type: "embeddable",
  x: 20 + (i % 3) * (ANCHO + 20),
  y: 20 + Math.floor(i / 3) * (ALTO + 20),
  width: ANCHO,
  height: ALTO,
  link,
}));
elementos.push({
  id: "generado",
  type: "iframe",
  x: 20,
  y: 20 + 2 * (ALTO + 20),
  width: ANCHO,
  height: ALTO,
  customData: {
    generationData: {
      status: "done",
      html: '<p id="generado">html guardado</p><script src="https://ejemplo.invalid/s.js"></script>',
    },
  },
});

writeFileSync(
  join(tmp, "entrada.js"),
  `import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { Excalidraw } from "@excalidraw/excalidraw";
import {
  bibliotecaSinContenidoGenerado,
  esEmbebiblePermitido,
  pegadoSinContenidoGenerado,
  sinContenidoGenerado,
  vigilarIframes,
} from "./embebibles.js";
const ELEMENTOS = ${JSON.stringify(elementos)};
const q = new URLSearchParams(location.search);
const inicial = q.has("vacia") ? [] : ELEMENTOS;
window.__bibliotecas = [];
const renderEmbeddable = (el) => (esEmbebiblePermitido(el.link) ? null : createElement("div"));
const api = { excalidrawAPI: (a) => (window.__api = a) };
const mycelium = {
  ...api,
  initialData: { elements: sinContenidoGenerado(inicial) },
  validateEmbeddable: esEmbebiblePermitido,
  renderEmbeddable,
  onPaste: pegadoSinContenidoGenerado,
  onLibraryChange: (items) => {
    window.__bibliotecas.push(items);
    const limpios = bibliotecaSinContenidoGenerado(items);
    if (limpios) void window.__api?.updateLibrary({ libraryItems: limpios, merge: false });
  },
};
const props = q.has("control")
  ? { ...api, initialData: { elements: inicial } }
  : q.has("solo-render")
  ? { ...api, initialData: { elements: inicial }, validateEmbeddable: true, renderEmbeddable }
  : q.has("solo-guardia")
  ? { ...api, initialData: { elements: inicial } }
  : mycelium;
const guardia = !q.has("control") && !q.has("solo-render") && !q.has("sin-guardia");
createRoot(document.getElementById("raiz")).render(
  createElement(
    "div",
    { ref: guardia ? (n) => (n ? vigilarIframes(n) : undefined) : undefined, style: { height: "100%" } },
    createElement(Excalidraw, props),
  ),
);
`,
);
const estadisticas = await new Promise((ok, mal) =>
  webpack(
    {
      mode: "production",
      context: tmp,
      entry: join(tmp, "entrada.js"),
      output: { path: salida, filename: "app.js", publicPath: "/" },
      resolve: { modules: ["node_modules", join(FRONTEND, "node_modules")] },
      module: { rules: [{ test: /\.m?js$/, resolve: { fullySpecified: false } }] },
      performance: { hints: false },
      optimization: { minimize: false },
      devtool: false,
    },
    (err, st) => (err ? mal(err) : ok(st)),
  ),
);
if (estadisticas.hasErrors()) {
  console.error(estadisticas.toString({ all: false, errors: true }));
  process.exit(1);
}

const PAGINA = `<!doctype html><html><head><meta charset="utf-8">
<link rel="stylesheet" href="/excalidraw.css">
<style>html,body,#raiz{margin:0;height:100%}</style></head>
<body><div id="raiz"></div><script src="/app.js"></script></body></html>`;
const TIPOS = { ".js": "text/javascript", ".css": "text/css" };
const servidor = createServer((req, res) => {
  const url = decodeURIComponent(new URL(req.url, "http://x").pathname);
  if (url === "/") return res.writeHead(200, { "content-type": "text/html" }).end(PAGINA);
  if (url === "/excalidraw.css") {
    return res
      .writeHead(200, { "content-type": "text/css" })
      .end(readFileSync(join(FRONTEND, "node_modules/@excalidraw/excalidraw/dist/prod/index.css")));
  }
  const ruta = normalize(join(salida, url));
  try {
    if (!ruta.startsWith(salida)) throw new Error("fuera");
    const cuerpo = readFileSync(ruta);
    res.writeHead(200, { "content-type": TIPOS[extname(ruta)] ?? "application/octet-stream" });
    res.end(cuerpo);
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((ok) => servidor.listen(PUERTO, ok));

/** Abre la página, corre `accion` y devuelve los iframes y las peticiones externas. */
async function abrir(navegador, consulta, accion) {
  const pagina = await navegador.newPage({ viewport: { width: 1280, height: 900 } });
  const externas = [];
  const errores = [];
  pagina.on("pageerror", (e) => errores.push(String(e)));
  await pagina.route("**/*", (ruta) => {
    const u = ruta.request().url();
    if (u.startsWith(`http://localhost:${PUERTO}/`)) return ruta.continue();
    externas.push(u);
    return ruta.abort();
  });
  await pagina.goto(`http://localhost:${PUERTO}/${consulta}`);
  await pagina.waitForSelector(".excalidraw", { timeout: 20000 });
  await pagina.waitForTimeout(1500);
  if (accion) {
    await accion(pagina);
    await pagina.waitForTimeout(2000);
  }
  const iframes = await pagina.evaluate(() =>
    Array.from(document.querySelectorAll("iframe")).map((f) => ({
      src: f.getAttribute("src") ?? "",
      srcdoc: f.getAttribute("srcdoc") ?? "",
    })),
  );
  const escena = await pagina.evaluate(() =>
    JSON.stringify(window.__api?.getSceneElementsIncludingDeleted?.() ?? []),
  );
  const bibliotecas = await pagina.evaluate(() => JSON.stringify(window.__bibliotecas ?? []));
  await pagina.close();
  return { iframes, externas, errores, escena, bibliotecas };
}

const DE_VIDEO = /^https:\/\/(www\.youtube\.com\/embed|player\.vimeo\.com\/video)\//;
const navegador = await chromium.launch();
try {
  // Control: sin las opciones, Excalidraw monta los de X y Reddit con su script.
  const c = await abrir(navegador, "?control");
  const docControl = c.iframes.map((f) => f.srcdoc).join("\n");
  comprobar(
    /platform\.twitter\.com/.test(docControl) && /embed\.reddit\.com/.test(docControl),
    `control: sin opciones, Excalidraw monta X y Reddit (${c.iframes.length} iframes)`,
  );
  comprobar(/html guardado/.test(docControl), "control: sin limpieza, el iframe muestra el HTML guardado");

  // Segunda barrera: aunque la validación dejara pasar todo, renderEmbeddable
  // no deja montar más que YouTube y Vimeo.
  const r = await abrir(navegador, "?solo-render");
  const docsRender = r.iframes.map((f) => f.srcdoc).join("\n");
  comprobar(
    !/twitter|reddit|gist\.github|figma/i.test(docsRender) &&
      r.iframes.every((f) => !f.src || /^https:\/\/(www\.youtube\.com\/embed|player\.vimeo\.com\/video)\//.test(f.src)),
    "con la validación abierta, renderEmbeddable solo deja YouTube y Vimeo",
  );

  // Tercera barrera sola: sin opciones ni limpieza, el vigilante deja en blanco
  // lo que no sea YouTube o Vimeo. Un `srcdoc` no llega a cargar (no se pide
  // ningún script de adentro); un `src` ajeno se corta, pero la primera petición
  // ya salió (el de Figma): por eso la barrera principal es `validateEmbeddable`.
  const g = await abrir(navegador, "?solo-guardia");
  const desdeSrcdoc = g.externas.filter((u) =>
    /twitter|reddit|gist\.github|ejemplo\.invalid/.test(u),
  );
  const sinVaciar = g.iframes.filter(
    (f) => f.srcdoc !== "" || !(!f.src || f.src === "about:blank" || DE_VIDEO.test(f.src)),
  );
  comprobar(
    sinVaciar.length === 0 && desdeSrcdoc.length === 0,
    `solo con vigilarIframes: ningún srcdoc carga y todo iframe ajeno queda en blanco (${[
      ...desdeSrcdoc,
      ...sinVaciar.map((f) => f.src || f.srcdoc.slice(0, 80)),
    ].join(", ") || "nada fuera de lugar"})`,
  );

  // Mycelium.
  const m = await abrir(navegador, "");
  console.log(`     iframes: ${m.iframes.map((f) => f.src || "(srcdoc)").join(", ") || "ninguno"}`);
  console.log(`     peticiones externas abortadas: ${m.externas.join(", ") || "ninguna"}`);
  comprobar(m.errores.length === 0, `sin errores de página (${m.errores.join(" | ") || "ninguno"})`);
  comprobar(
    m.iframes.some((f) => f.src.startsWith("https://www.youtube.com/embed/dQw4w9WgXcQ")),
    "el de YouTube se monta (www.youtube.com/embed)",
  );
  comprobar(
    m.iframes.some((f) => f.src.startsWith("https://player.vimeo.com/video/76979871")),
    "el de Vimeo se monta (player.vimeo.com/video)",
  );
  const ajenos = m.iframes.filter(
    (f) =>
      f.src &&
      !f.src.startsWith("https://www.youtube.com/embed/") &&
      !f.src.startsWith("https://player.vimeo.com/video/"),
  );
  comprobar(ajenos.length === 0, `ningún iframe a otro sitio (${ajenos.map((f) => f.src).join(", ") || "ninguno"})`);
  const conScript = m.iframes.filter((f) => /<script/i.test(f.srcdoc));
  comprobar(conScript.length === 0, "ningún iframe con <script> en su srcdoc");
  const docs = m.iframes.map((f) => f.srcdoc).join("\n");
  comprobar(!/twitter|reddit|gist\.github|figma/i.test(docs), "nada de X, Reddit, gist ni Figma en los srcdoc");
  comprobar(!/html guardado/.test(docs), "el HTML guardado del iframe no se muestra");
  const externasAjenas = m.externas.filter(
    (u) => !u.startsWith("https://www.youtube.com/") && !u.startsWith("https://player.vimeo.com/"),
  );
  comprobar(
    externasAjenas.length === 0,
    `ninguna petición a otro sitio (${externasAjenas.join(", ") || "ninguna"})`,
  );

  // Pegar, soltar un dibujo y soltar una biblioteca sobre un dibujo vacío.
  const generado = elementos.find((e) => e.id === "generado");
  const portapapeles = JSON.stringify({ type: "excalidraw/clipboard", elements: [generado], files: {} });
  const pegar = async (pagina) => {
    await pagina.mouse.click(640, 450);
    await pagina.evaluate((texto) => {
      const dt = new DataTransfer();
      dt.setData("text/plain", texto);
      document.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true }));
    }, portapapeles);
  };
  const soltar = (nombre, contenido) => async (pagina) => {
    await pagina.mouse.move(640, 450);
    await pagina.evaluate(
      ([n, c]) => {
        const dt = new DataTransfer();
        dt.items.add(new File([c], n, { type: "application/json" }));
        const destino = document.elementFromPoint(640, 450);
        destino.dispatchEvent(
          new DragEvent("drop", { dataTransfer: dt, bubbles: true, cancelable: true, clientX: 640, clientY: 450 }),
        );
      },
      [nombre, contenido],
    );
    // Al cargar un archivo soltado, Excalidraw (en headless) deja la cámara sin
    // posición y no monta los recuadros hasta que se mueve: se encuadra el
    // contenido, como haría el usuario al mover el lienzo.
    await pagina.waitForTimeout(800);
    await pagina.evaluate(() => window.__api.scrollToContent(undefined, { animate: false }));
  };
  const sinHtml = (r) =>
    !r.iframes.some((f) => /html guardado/.test(f.srcdoc)) &&
    !r.externas.some((u) => u.includes("ejemplo.invalid"));

  const pegadoControl = await abrir(navegador, "?vacia&control", pegar);
  comprobar(
    /html guardado/.test(pegadoControl.iframes.map((f) => f.srcdoc).join("")),
    "control: sin opciones, lo pegado muestra el HTML guardado",
  );
  const pegadoSinGuardia = await abrir(navegador, "?vacia&sin-guardia", pegar);
  comprobar(
    /"type":"iframe"/.test(pegadoSinGuardia.escena) &&
      !/generationData/.test(pegadoSinGuardia.escena) &&
      sinHtml(pegadoSinGuardia),
    "pegar: onPaste solo ya deja el elemento sin el HTML guardado",
  );
  const pegado = await abrir(navegador, "?vacia", pegar);
  comprobar(
    /"type":"iframe"/.test(pegado.escena) && !/generationData/.test(pegado.escena) && sinHtml(pegado),
    "pegar: el elemento entra sin el HTML guardado y no se pide nada",
  );

  const dibujo = JSON.stringify({ type: "excalidraw", version: 2, source: "smoke", elements: elementos, appState: {}, files: {} });
  const soltadoControl = await abrir(navegador, "?vacia&control", soltar("otro.excalidraw", dibujo));
  comprobar(
    /html guardado/.test(soltadoControl.iframes.map((f) => f.srcdoc).join("")),
    "control: sin opciones, soltar un .excalidraw muestra el HTML guardado",
  );
  const soltado = await abrir(navegador, "?vacia", soltar("otro.excalidraw", dibujo));
  comprobar(
    /"type":"iframe"/.test(soltado.escena) &&
      sinHtml(soltado) &&
      !soltado.iframes.some((f) => f.srcdoc) &&
      soltado.iframes.some((f) => f.src.startsWith("https://www.youtube.com/embed/")) &&
      !soltado.externas.some((u) => !DE_VIDEO.test(u)),
    `soltar un .excalidraw: solo YouTube y Vimeo, sin HTML guardado (${soltado.externas.join(", ") || "sin peticiones"})`,
  );

  const libreria = JSON.stringify({
    type: "excalidrawlib",
    version: 2,
    source: "smoke",
    libraryItems: [{ id: "item", status: "unpublished", created: 1, elements: [generado] }],
  });
  const biblioteca = await abrir(navegador, "?vacia", soltar("biblioteca.excalidrawlib", libreria));
  const llamadas = JSON.parse(biblioteca.bibliotecas);
  const ultima = llamadas.at(-1) ?? [];
  comprobar(
    llamadas.some((items) => /generationData/.test(JSON.stringify(items))) &&
      ultima.length === 1 &&
      !/generationData/.test(JSON.stringify(ultima)) &&
      sinHtml(biblioteca),
    `soltar un .excalidrawlib: la biblioteca queda sin el HTML guardado (${llamadas.length} cambios)`,
  );
  comprobar(
    [pegado, soltado, biblioteca].every((r) => r.errores.length === 0),
    `pegar y soltar: sin errores de página (${[pegado, soltado, biblioteca].flatMap((r) => r.errores).join(" | ") || "ninguno"})`,
  );
} finally {
  await navegador.close();
  servidor.close();
  rmSync(tmp, { recursive: true, force: true });
}

if (fallas) {
  console.error(`\n${fallas} comprobación(es) fallaron`);
  process.exit(1);
}
console.log("\nSolo se montan los videos de YouTube y Vimeo");
