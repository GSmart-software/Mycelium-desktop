// Smoke de qué se monta de un dibujo con recuadros web (`DEF-167`).
//
// Empaqueta con el webpack que trae Next una página mínima que monta el
// `<Excalidraw>` real del paquete con un dibujo que tiene recuadros web de
// YouTube, Vimeo, X, Reddit, un gist de GitHub, Figma y un elemento `iframe` con
// HTML guardado, y la abre en Chromium headless **sin red** (toda petición
// externa se aborta y se anota). Corre dos veces:
//
// - **control**: Excalidraw sin opciones. Tiene que montar el de X (si no, el
//   banco no estaría probando nada).
// - **solo renderEmbeddable**: la validación abierta a todo; la segunda barrera
//   sola tiene que frenar a los demás.
// - **Mycelium**: con `validateEmbeddable` / `renderEmbeddable` y la limpieza de
//   `lib/excalidrawEmbebibles.ts`, como `PROPS_EMBEBIBLES` y `leerEscena`.
//   Solo pueden quedar los iframes de www.youtube.com y player.vimeo.com, sin
//   `srcdoc`, y ninguna petición a otro sitio.
//
// También comprueba que los dos componentes pasan `PROPS_EMBEBIBLES`.
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
  comprobar(/\{\.\.\.PROPS_EMBEBIBLES\}/.test(fuente), `${archivo} pasa {...PROPS_EMBEBIBLES}`);
}
const libExcalidraw = readFileSync(join(FRONTEND, "lib", "excalidraw.ts"), "utf8");
comprobar(
  /validateEmbeddable: esEmbebiblePermitido/.test(libExcalidraw) &&
    /esEmbebiblePermitido\(el\.link\) \? null/.test(libExcalidraw),
  "PROPS_EMBEBIBLES usa esEmbebiblePermitido en validateEmbeddable y renderEmbeddable",
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
import { esEmbebiblePermitido, sinContenidoGenerado } from "./embebibles.js";
const ELEMENTOS = ${JSON.stringify(elementos)};
const control = new URLSearchParams(location.search).has("control");
const soloRender = new URLSearchParams(location.search).has("solo-render");
const props = control
  ? { initialData: { elements: ELEMENTOS } }
  : soloRender
  ? {
      // Validación abierta a todo: tiene que frenarlos renderEmbeddable solo.
      initialData: { elements: ELEMENTOS },
      validateEmbeddable: true,
      renderEmbeddable: (el) => (esEmbebiblePermitido(el.link) ? null : createElement("div")),
    }
  : {
      initialData: { elements: sinContenidoGenerado(ELEMENTOS) },
      validateEmbeddable: esEmbebiblePermitido,
      renderEmbeddable: (el) => (esEmbebiblePermitido(el.link) ? null : createElement("div")),
    };
createRoot(document.getElementById("raiz")).render(createElement(Excalidraw, props));
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

/** Abre la página y devuelve los iframes montados y las peticiones externas. */
async function abrir(navegador, consulta) {
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
  await pagina.waitForTimeout(2500);
  const iframes = await pagina.evaluate(() =>
    Array.from(document.querySelectorAll("iframe")).map((f) => ({
      src: f.getAttribute("src") ?? "",
      srcdoc: f.getAttribute("srcdoc") ?? "",
    })),
  );
  await pagina.close();
  return { iframes, externas, errores };
}

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
