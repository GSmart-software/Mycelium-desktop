// Smoke del marcador «Diagrama …» que reemplazaba a un dibujo embebido (`DEF-133`).
//
// La vista de lectura pinta el HTML de la nota con `dangerouslySetInnerHTML` y
// después un efecto **decora** ese DOM: cambia el placeholder
// `<a class="mic-excalidraw">Diagrama X</a>` por el dibujo (y lo mismo con
// draw.io, Mermaid, imágenes y botones de copiar). React 19 compara la prop por
// identidad del objeto: con `{{ __html: html }}` cada render trae uno nuevo y
// React reasigna `innerHTML` aunque el HTML no haya cambiado, así que cualquier
// re-render ajeno devolvía el placeholder —y el efecto, con sus dependencias
// iguales, no volvía a correr—. Al volver a la nota, el usuario veía el marcador
// hasta que el archivo cambiaba.
//
// Empaqueta con el webpack que trae Next una página con el React real, un
// componente que imita el patrón de `NoteEditor` (HTML + efecto que decora) y el
// hook REAL `useHtmlDecorable` de `lib/useHtmlDecorable.ts`, y la abre en
// Chromium headless. Comprueba:
//   1. en la fuente, que las tres vistas de lectura (`NoteEditor`,
//      `SidebarNoteView`, `LinkedPreviewPane`) usan el hook y no un `{{ __html }}`
//      armado en el render;
//   2. con el hook: un re-render ajeno NO devuelve el placeholder, y un cambio en
//      las dependencias de la decoración (lo que pasa al editar el dibujo) sí
//      repone el HTML y el efecto lo vuelve a decorar;
//   3. control: con `{{ __html }}` en línea, el re-render ajeno deja el marcador
//      «Diagrama …» (el defecto).
//
//   node scripts/smoke-html-decorable.mjs
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium } from "playwright";
import ts from "typescript";

const FRONTEND = resolve(import.meta.dirname, "..");
const require = createRequire(join(FRONTEND, "package.json"));
const { webpack } = require("next/dist/compiled/webpack/bundle5")();
const PUERTO = 3198;

let fallas = 0;
function comprobar(ok, mensaje) {
  console.log(`${ok ? "ok  " : "FALLA"} ${mensaje}`);
  if (!ok) fallas++;
}

// 1. Las vistas de lectura usan el hook.
for (const archivo of [
  "components/editor/NoteEditor.tsx",
  "components/explorer/SidebarNoteView.tsx",
  "components/panes/LinkedPreviewPane.tsx",
]) {
  const texto = readFileSync(join(FRONTEND, archivo), "utf8");
  comprobar(
    /useHtmlDecorable\(/.test(texto) && !/dangerouslySetInnerHTML=\{\{/.test(texto),
    `${archivo}: el HTML que se decora sale de useHtmlDecorable, no de un {{ __html }} en el render`,
  );
}

// 2 y 3. Bundle con React real y el hook real.
const tmp = mkdtempSync(join(tmpdir(), "smoke-html-decorable-"));
const salida = join(tmp, "dist");
const hookJs = ts.transpileModule(
  readFileSync(join(FRONTEND, "lib", "useHtmlDecorable.ts"), "utf8"),
  { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 } },
).outputText;
writeFileSync(join(tmp, "useHtmlDecorable.js"), hookJs);
writeFileSync(
  join(tmp, "entrada.js"),
  `import { createElement, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { useHtmlDecorable } from "./useHtmlDecorable.js";

const HTML = '<p>Tres hermanas</p><p><a href="#excalidraw" class="mic-excalidraw" data-diag="Croquis de la huerta">Diagrama Croquis de la huerta</a></p>';
const estable = !location.search.includes("en-linea");

// Lo que hace renderExcalidrawIn: espera (cargar la escena, exportar el SVG) y
// reemplaza el placeholder por el dibujo.
async function decorar(contenedor) {
  for (const a of Array.from(contenedor.querySelectorAll("a.mic-excalidraw[data-diag]"))) {
    await new Promise((r) => setTimeout(r, 20));
    const bloque = document.createElement("div");
    bloque.className = "mic-excalidraw-block";
    bloque.innerHTML = "<svg></svg>";
    a.replaceWith(bloque);
  }
  window.__decoraciones = (window.__decoraciones ?? 0) + 1;
}

function Vista() {
  const [html] = useState(HTML);
  const [ajeno, setAjeno] = useState(0);
  const [tick, setTick] = useState(0);
  const ref = useRef(null);
  useEffect(() => {
    void decorar(ref.current);
  }, [html, tick]);
  const estableInner = useHtmlDecorable(html, [tick]);
  const inner = estable ? estableInner : { __html: html };
  window.__ajeno = () => flushSync(() => setAjeno((n) => n + 1));
  window.__tick = () => flushSync(() => setTick((n) => n + 1));
  return createElement(
    "div",
    { ref },
    createElement("span", { id: "ajeno" }, String(ajeno)),
    createElement("div", { className: "mic-preview-body", dangerouslySetInnerHTML: inner }),
  );
}
createRoot(document.getElementById("raiz")).render(createElement(Vista));
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

const PAGINA = `<!doctype html><html><head><meta charset="utf-8"></head>
<body><div id="raiz"></div><script src="/app.js"></script></body></html>`;
const servidor = createServer((req, res) => {
  const url = new URL(req.url, "http://x").pathname;
  if (url === "/") return res.writeHead(200, { "content-type": "text/html" }).end(PAGINA);
  if (url === "/app.js") {
    return res
      .writeHead(200, { "content-type": "text/javascript" })
      .end(readFileSync(join(salida, "app.js")));
  }
  res.writeHead(404).end();
});
await new Promise((ok) => servidor.listen(PUERTO, ok));

/** Estado visible: ¿está el dibujo? ¿está el marcador? */
const foto = (pagina) =>
  pagina.evaluate(() => ({
    dibujos: document.querySelectorAll(".mic-excalidraw-block").length,
    marcador: document.querySelector(".mic-preview-body").textContent.includes("Diagrama Croquis"),
    decoraciones: window.__decoraciones ?? 0,
  }));
const esperarDibujo = (pagina) =>
  pagina.waitForFunction(() => document.querySelectorAll(".mic-excalidraw-block").length === 1, null, {
    timeout: 5000,
  });

const navegador = await chromium.launch();
try {
  // 2. Con el hook.
  const pagina = await navegador.newPage();
  await pagina.goto(`http://localhost:${PUERTO}/`);
  await esperarDibujo(pagina);
  let f = await foto(pagina);
  comprobar(f.dibujos === 1 && !f.marcador, "con el hook: el embed se dibuja la primera vez");

  for (let i = 0; i < 3; i++) await pagina.evaluate(() => window.__ajeno());
  await pagina.waitForTimeout(200);
  f = await foto(pagina);
  comprobar(
    f.dibujos === 1 && !f.marcador && f.decoraciones === 1,
    `con el hook: tres re-renders ajenos no devuelven el marcador (dibujos ${f.dibujos}, marcador ${f.marcador}, decoraciones ${f.decoraciones})`,
  );

  await pagina.evaluate(() => window.__tick());
  await esperarDibujo(pagina).catch(() => {});
  await pagina.waitForTimeout(200);
  f = await foto(pagina);
  comprobar(
    f.dibujos === 1 && !f.marcador && f.decoraciones === 2,
    `con el hook: cambiar una dependencia de la decoración repone el HTML y se vuelve a dibujar (decoraciones ${f.decoraciones})`,
  );
  await pagina.close();

  // 3. Control: el patrón viejo.
  const control = await navegador.newPage();
  await control.goto(`http://localhost:${PUERTO}/?en-linea`);
  await esperarDibujo(control);
  await control.evaluate(() => window.__ajeno());
  await control.waitForTimeout(200);
  f = await foto(control);
  comprobar(
    f.dibujos === 0 && f.marcador,
    `control: con {{ __html }} en línea, un re-render ajeno deja el marcador «Diagrama …» (el defecto)`,
  );
  await control.close();
} finally {
  await navegador.close();
  servidor.close();
  rmSync(tmp, { recursive: true, force: true });
}

console.log(fallas ? `\n${fallas} falla(s)` : "\nTodo ok");
process.exit(fallas ? 1 : 0);
