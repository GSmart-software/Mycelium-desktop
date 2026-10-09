// Smoke del idioma de Excalidraw en Chromium (`DEF-147`).
//
// Empaqueta con el webpack que trae Next una página mínima que monta el
// `<Excalidraw>` real del paquete con el `IDIOMA_EXCALIDRAW` de `lib/excalidraw.ts`
// (el mismo que usan la pestaña del dibujo y el editor modal) y la abre en
// Chromium headless, **sin red**: toda petición que no sea al servidor local se
// aborta. Así prueba que la traducción viaja en un chunk del propio bundle (no de
// un CDN) y que la interfaz sale en español: el botón «Biblioteca» y la ayuda
// «Para mover el lienzo…» en vez de «Library» y «To move canvas…».
//
// También comprueba que los dos componentes le pasan `langCode` a `<Excalidraw>`.
//
//   node scripts/smoke-excalidraw-idioma.mjs
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { extname, join, normalize, resolve } from "node:path";
import { chromium } from "playwright";

const FRONTEND = resolve(import.meta.dirname, "..");
const require = createRequire(join(FRONTEND, "package.json"));
// El webpack 5 que Next trae compilado (no hay `webpack` suelto en node_modules).
const { webpack } = require("next/dist/compiled/webpack/bundle5")();
const PUERTO = 3198;

let fallas = 0;
function comprobar(ok, mensaje) {
  console.log(`${ok ? "ok  " : "FALLA"} ${mensaje}`);
  if (!ok) fallas++;
}

// 1. Los dos componentes pasan el idioma.
for (const archivo of ["ExcalidrawFileEditor.tsx", "ExcalidrawModal.tsx"]) {
  const fuente = readFileSync(join(FRONTEND, "components", "editor", archivo), "utf8");
  comprobar(
    /langCode=\{IDIOMA_EXCALIDRAW\}/.test(fuente),
    `${archivo} pasa langCode={IDIOMA_EXCALIDRAW}`,
  );
}
const idioma = /IDIOMA_EXCALIDRAW = "([^"]+)"/.exec(
  readFileSync(join(FRONTEND, "lib", "excalidraw.ts"), "utf8"),
)?.[1];
comprobar(Boolean(idioma), `lib/excalidraw.ts exporta IDIOMA_EXCALIDRAW (${idioma})`);

// 2. Bundle mínimo con el paquete real.
const tmp = mkdtempSync(join(tmpdir(), "smoke-excalidraw-"));
const salida = join(tmp, "dist");
writeFileSync(
  join(tmp, "entrada.js"),
  `import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { Excalidraw } from "@excalidraw/excalidraw";
createRoot(document.getElementById("raiz")).render(
  createElement(Excalidraw, { langCode: ${JSON.stringify(idioma)} }),
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
      // Excalidraw importa `roughjs/bin/rough` sin extensión desde un módulo ESM.
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
const conTraduccion = readdirSync(salida).filter(
  (n) => n !== "app.js" && /Para mover el lienzo/.test(readFileSync(join(salida, n), "utf8")),
);
comprobar(
  conTraduccion.length === 1,
  `la traducción ${idioma} va en un chunk propio del bundle (${conTraduccion.join(", ") || "ninguno"})`,
);

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

const navegador = await chromium.launch();
try {
  const pagina = await navegador.newPage({ viewport: { width: 1280, height: 800 } });
  const externas = [];
  await pagina.route("**/*", (ruta) => {
    const u = ruta.request().url();
    if (u.startsWith(`http://localhost:${PUERTO}/`)) return ruta.continue();
    externas.push(u);
    return ruta.abort();
  });
  await pagina.goto(`http://localhost:${PUERTO}/`);
  await pagina.waitForSelector(".excalidraw", { timeout: 20000 });
  // La traducción llega asíncrona: esperar a que cambie el texto.
  const biblioteca = await pagina
    .waitForFunction(
      () => {
        const t = document.querySelector(".excalidraw")?.innerText ?? "";
        return /Biblioteca/.test(t) ? t : null;
      },
      null,
      { timeout: 20000 },
    )
    .then((h) => h.jsonValue())
    .catch(() => null);
  const texto = biblioteca ?? (await pagina.innerText(".excalidraw"));
  comprobar(/Biblioteca/.test(texto), "el botón de la biblioteca dice «Biblioteca»");
  comprobar(!/\bLibrary\b/.test(texto), "no queda «Library» en la interfaz");
  comprobar(
    !/To move canvas/.test(texto),
    "la ayuda del lienzo vacío no está en inglés («To move canvas…»)",
  );
  const lang = await pagina.evaluate(() => document.querySelector(".excalidraw")?.closest("[lang]")?.getAttribute("lang") ?? document.documentElement.lang);
  console.log(`     idioma del documento: ${lang || "(sin atributo)"}`);
  console.log(`     peticiones externas abortadas: ${externas.length ? externas.join(", ") : "ninguna"}`);
} finally {
  await navegador.close();
  servidor.close();
  rmSync(tmp, { recursive: true, force: true });
}

if (fallas) {
  console.error(`\n${fallas} comprobación(es) fallaron`);
  process.exit(1);
}
console.log("\nExcalidraw sale en español, sin red");
