// Smoke de las fuentes de Excalidraw sin red (`DEF-153`).
//
// Empaqueta con el webpack que trae Next una página mínima que hace lo mismo que
// `cargarExcalidraw()` de `lib/excalidraw.ts` —definir `window.EXCALIDRAW_ASSET_PATH`
// con `RUTA_RECURSOS_EXCALIDRAW` antes de importar el paquete—, monta el
// `<Excalidraw>` real con un texto en cada familia de letra y exporta la escena a
// SVG con `exportToSvg` (lo que usan la vista de lectura de un embed y la
// exportación, que incrustan las fuentes). La abre en Chromium headless **sin
// red**: toda petición que no sea al servidor local se aborta y se anota. El
// servidor sirve `public/excalidraw-assets/` como lo sirve la app.
//
// Comprueba:
//   1. que todo import del paquete pase por `cargarExcalidraw()`;
//   2. que `public/excalidraw-assets/fonts/` tenga las fuentes del paquete;
//   3. que el editor y la exportación pidan las fuentes al origen local, todas
//      respondan 200, ninguna petición vaya a esm.sh (ni a otro tercero) y el SVG
//      exportado incruste las fuentes;
//   4. control: sin la variable, Excalidraw las pide a esm.sh (el defecto).
//
// Requiere `npm run preparar-excalidraw` antes (lo corren `dev` y `build`).
//
//   node scripts/smoke-excalidraw-fuentes.mjs
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { extname, join, normalize, relative, resolve } from "node:path";
import { chromium } from "playwright";

const FRONTEND = resolve(import.meta.dirname, "..");
const require = createRequire(join(FRONTEND, "package.json"));
const { webpack } = require("next/dist/compiled/webpack/bundle5")();
const PUERTO = 3197;
const PUBLICO = join(FRONTEND, "public");

let fallas = 0;
function comprobar(ok, mensaje) {
  console.log(`${ok ? "ok  " : "FALLA"} ${mensaje}`);
  if (!ok) fallas++;
}

// 1. Todo import del paquete pasa por `cargarExcalidraw()`.
function fuentesTs(dir) {
  const salida = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (["node_modules", ".next", "out", "public", "scripts", "src-tauri"].includes(e.name)) continue;
    const ruta = join(dir, e.name);
    if (e.isDirectory()) salida.push(...fuentesTs(ruta));
    else if (/\.tsx?$/.test(e.name)) salida.push(ruta);
  }
  return salida;
}
const libExcalidraw = join(FRONTEND, "lib", "excalidraw.ts");
const fuenteLib = readFileSync(libExcalidraw, "utf8");
const importsDirectos = fuentesTs(FRONTEND).flatMap((archivo) => {
  const texto = readFileSync(archivo, "utf8");
  // `typeof import(…)` es solo de tipos: no carga nada.
  const n = (texto.match(/(?<!typeof )import\(\s*["']@excalidraw\/excalidraw["']\s*\)/g) ?? []).length +
    (texto.match(/^import(?! type)[^;]*from\s+["']@excalidraw\/excalidraw["']/gm) ?? []).length;
  // El único import permitido es el de `cargarExcalidraw()`.
  const permitidos = archivo === libExcalidraw ? 1 : 0;
  return n > permitidos ? [relative(FRONTEND, archivo)] : [];
});
comprobar(
  importsDirectos.length === 0,
  `todo import de @excalidraw/excalidraw pasa por cargarExcalidraw() (${importsDirectos.join(", ") || "sin excepciones"})`,
);
const ruta = /RUTA_RECURSOS_EXCALIDRAW = "([^"]+)"/.exec(fuenteLib)?.[1];
comprobar(Boolean(ruta), `lib/excalidraw.ts exporta RUTA_RECURSOS_EXCALIDRAW (${ruta})`);
comprobar(
  /window\.EXCALIDRAW_ASSET_PATH = RUTA_RECURSOS_EXCALIDRAW/.test(fuenteLib),
  "cargarExcalidraw() define window.EXCALIDRAW_ASSET_PATH antes del import",
);

// 2. Las fuentes están copiadas.
const origenFuentes = join(FRONTEND, "node_modules/@excalidraw/excalidraw/dist/prod/fonts");
const copiaFuentes = join(PUBLICO, ruta ?? "/excalidraw-assets/", "fonts");
function contar(dir) {
  if (!existsSync(dir)) return 0;
  return readdirSync(dir, { withFileTypes: true }).reduce(
    (n, e) => n + (e.isDirectory() ? contar(join(dir, e.name)) : 1),
    0,
  );
}
const enPaquete = contar(origenFuentes);
const copiadas = contar(copiaFuentes);
comprobar(
  enPaquete > 0 && copiadas === enPaquete,
  `public${ruta}fonts/ tiene las ${enPaquete} fuentes del paquete (${copiadas})`,
);
if (copiadas === 0) {
  console.error("\nCorré antes:  npm run preparar-excalidraw");
  process.exit(1);
}

// 3. Bundle mínimo con el paquete real.
const tmp = mkdtempSync(join(tmpdir(), "smoke-excalidraw-fuentes-"));
const salida = join(tmp, "dist");
writeFileSync(
  join(tmp, "entrada.js"),
  `import { createElement } from "react";
import { createRoot } from "react-dom/client";
// Igual que cargarExcalidraw(): la ruta se define ANTES de cargar el paquete
// (salvo en la corrida de control, ?sin-ruta).
if (!location.search.includes("sin-ruta")) window.EXCALIDRAW_ASSET_PATH = ${JSON.stringify(ruta)};
import("@excalidraw/excalidraw").then(async (ex) => {
  const familias = Object.entries(ex.FONT_FAMILY);
  const elementos = ex.convertToExcalidrawElements(
    familias.map(([nombre, id], i) => ({
      type: "text", x: 20, y: 20 + i * 50, text: nombre + " Ñandú áé 汉字", fontFamily: id, fontSize: 24,
    })),
  );
  window.__familias = familias.map(([n]) => n);
  createRoot(document.getElementById("raiz")).render(
    createElement(ex.Excalidraw, { initialData: { elements: elementos } }),
  );
  const svg = await ex.exportToSvg({ elements: elementos, appState: { exportBackground: false }, files: null });
  window.__svg = new XMLSerializer().serializeToString(svg);
});
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
<style>html,body,#raiz{margin:0;height:100%}</style></head>
<body><div id="raiz"></div><script src="/app.js"></script></body></html>`;
const TIPOS = { ".js": "text/javascript", ".woff2": "font/woff2" };
const servidor = createServer((req, res) => {
  const url = decodeURIComponent(new URL(req.url, "http://x").pathname);
  if (url === "/") return res.writeHead(200, { "content-type": "text/html" }).end(PAGINA);
  // Lo de `public/` se sirve como lo sirve la app; el resto, del bundle.
  const base = url.startsWith(ruta) ? PUBLICO : salida;
  const archivo = normalize(join(base, url));
  try {
    if (!archivo.startsWith(base)) throw new Error("fuera");
    const cuerpo = readFileSync(archivo);
    res.writeHead(200, { "content-type": TIPOS[extname(archivo)] ?? "application/octet-stream" });
    res.end(cuerpo);
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((ok) => servidor.listen(PUERTO, ok));

/** Abre la página sin red y devuelve qué pidió y qué exportó. */
async function abrir(navegador, consulta) {
  const pagina = await navegador.newPage({ viewport: { width: 1280, height: 800 } });
  const externas = [];
  const fuentesLocales = [];
  await pagina.route("**/*", (r) => {
    const u = r.request().url();
    if (u.startsWith(`http://localhost:${PUERTO}/`)) return r.continue();
    externas.push(u);
    return r.abort();
  });
  pagina.on("response", (resp) => {
    const u = resp.url();
    if (u.startsWith(`http://localhost:${PUERTO}${ruta}`)) {
      fuentesLocales.push({ url: u, estado: resp.status() });
    }
  });
  await pagina.goto(`http://localhost:${PUERTO}/${consulta}`);
  await pagina.waitForSelector(".excalidraw", { timeout: 20000 });
  await pagina.waitForFunction(() => typeof window.__svg === "string", null, { timeout: 30000 });
  await pagina.waitForLoadState("networkidle");
  const svg = await pagina.evaluate(() => window.__svg);
  const familias = await pagina.evaluate(() => window.__familias);
  const cargadas = await pagina.evaluate(() =>
    [...document.fonts].filter((f) => f.status === "loaded").map((f) => f.family.replaceAll('"', "")),
  );
  await pagina.close();
  return { externas, fuentesLocales, svg, familias, cargadas };
}

const navegador = await chromium.launch();
try {
  const con = await abrir(navegador, "");
  const familiasLocales = new Set(
    con.fuentesLocales.map((f) => /\/fonts\/([^/]+)\//.exec(f.url)?.[1]).filter(Boolean),
  );
  console.log(`     fuentes pedidas al origen local: ${con.fuentesLocales.length} (${[...familiasLocales].join(", ")})`);
  console.log(`     familias cargadas en document.fonts: ${[...new Set(con.cargadas)].join(", ")}`);
  comprobar(con.fuentesLocales.length > 0, "Excalidraw pide las fuentes al origen local");
  comprobar(
    con.fuentesLocales.every((f) => f.estado === 200),
    `todas responden 200 (${con.fuentesLocales.filter((f) => f.estado !== 200).map((f) => `${f.estado} ${f.url}`).join(", ") || "sí"})`,
  );
  for (const familia of ["Excalifont", "Virgil", "Cascadia", "Nunito", "Lilita", "ComicShanns", "Liberation", "Xiaolai"]) {
    comprobar(familiasLocales.has(familia), `la familia ${familia} se baja del origen local`);
  }
  comprobar(
    !con.externas.some((u) => u.includes("esm.sh")),
    `ninguna petición a esm.sh (${con.externas.filter((u) => u.includes("esm.sh")).length})`,
  );
  comprobar(con.externas.length === 0, `ninguna petición a terceros (${con.externas.join(", ") || "ninguna"})`);
  const incrustadas = (con.svg.match(/@font-face/g) ?? []).length;
  comprobar(
    incrustadas > 0 && /src: url\(data:font\/woff2;base64,/.test(con.svg),
    `el SVG exportado incrusta las fuentes en base64 (${incrustadas} @font-face)`,
  );
  comprobar(!/esm\.sh/.test(con.svg), "el SVG exportado no referencia esm.sh");

  // 4. Control: sin la variable, el defecto se reproduce.
  const sin = await abrir(navegador, "?sin-ruta");
  const aEsm = sin.externas.filter((u) => u.includes("esm.sh"));
  comprobar(
    aEsm.length > 0,
    `control: sin EXCALIDRAW_ASSET_PATH las pide a esm.sh (${aEsm.length} peticiones abortadas, p. ej. ${aEsm[0] ?? "-"})`,
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
console.log("\nLas fuentes de Excalidraw salen de la app, sin red");
