// Smoke de la vista previa de un lienzo embebido en una nota (`FUN-S-19`), en
// Chromium headless.
//
// Carga el módulo REAL `lib/canvasRender.ts` —con `lib/canvas.ts`,
// `lib/wikilinks.ts`, `lib/enlacesExternos.ts` y `lib/rutasNotas.ts` reales— y
// el CSS REAL de `styles/editor.css`. Se reemplazan por dobles solo los bordes
// que necesitan la app: la API (devuelve el `.canvas` de prueba), el store del
// vault y el pipeline de markdown (que tiene sus propios tests de saneo,
// `test-saneo-urls.mjs`; acá el doble escapa el texto para no meter HTML).
//
// Comprueba:
// - que se dibujan grupos, flechas y tarjetas, en ese orden de pintado;
// - que el lienzo se ajusta al ancho del bloque (sin agrandarse);
// - SEGURIDAD: una tarjeta de enlace con una URL hostil no ejecuta nada ni deja
//   un `href` peligroso (`DEF-159`), y un color hostil no llega al `style`;
// - que un embed a un lienzo que no existe deja su aviso.
//
//   node scripts/smoke-embed-lienzo.mjs
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { chromium } from "playwright";
import ts from "typescript";

const FRONTEND = resolve(import.meta.dirname, "..");
const TMP = join(FRONTEND, ".tmp-smoke-embed-lienzo");

let fallas = 0;
function comprobar(ok, mensaje) {
  console.log(`${ok ? "ok  " : "FALLA"} ${mensaje}`);
  if (!ok) fallas++;
}

const REALES = [
  "lib/canvasRender.ts",
  "lib/canvas.ts",
  "lib/wikilinks.ts",
  "lib/extensionesDeTipo.ts",
  "lib/enlacesExternos.ts",
  "lib/rutasNotas.ts",
];

const LIENZO = JSON.stringify({
  nodes: [
    { id: "g", type: "group", x: 0, y: 0, width: 1000, height: 400, label: "Ciclo <b>de vida</b>" },
    { id: "a", type: "text", x: 40, y: 60, width: 200, height: 100, text: "Espora" },
    { id: "b", type: "text", x: 700, y: 60, width: 200, height: 100, text: "<img src=x onerror=window.__pwned=1>" },
    { id: "l", type: "link", x: 40, y: 250, width: 260, height: 80, url: 'javascript:window.__pwned=2"><img src=x onerror=window.__pwned=3>' },
    { id: "w", type: "link", x: 400, y: 250, width: 260, height: 80, url: "https://ejemplo.com" },
    { id: "c", type: "text", x: 700, y: 250, width: 200, height: 80, text: "color", color: "red;background:url(x)" },
    { id: "f", type: "file", x: 400, y: 60, width: 200, height: 100, file: "Notas/Hongo.md" },
  ],
  edges: [
    { id: "e1", fromNode: "a", fromSide: "right", toNode: "f", toSide: "left" },
    { id: "e2", fromNode: "f", toNode: "b" },
  ],
});

await rm(TMP, { recursive: true, force: true });
await mkdir(TMP, { recursive: true });
try {
  const archivos = {};
  for (const rel of REALES) {
    const { outputText } = ts.transpileModule(await readFile(join(FRONTEND, rel), "utf8"), {
      compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    });
    archivos[rel.split("/").pop().replace(/\.ts$/, ".js")] = outputText
      .replace(/(["'])@\/lib\/(?:[A-Za-z0-9_-]+\/)*([A-Za-z0-9_-]+)\1/g, '"./$2.js"')
      .replace(/(["'])@\/stores\/([A-Za-z0-9_-]+)\1/g, '"./$2.js"');
  }
  // Dobles.
  archivos["api.js"] = `export async function api(ruta) {
    if (ruta.includes("Tablero.canvas")) return { contenido: ${JSON.stringify(LIENZO)} };
    if (ruta.includes("Hongo.md")) return { contenido: "Texto de la nota" };
    throw new Error("no existe");
  }`;
  archivos["vaultStore.js"] = `const notas = [
    { id: "Tablero.canvas", titulo: "Tablero", tipo: "canvas", carpetaId: null },
    { id: "Notas/Hongo.md", titulo: "Hongo", tipo: "markdown", carpetaId: "Notas" },
  ];
  const carpetas = [{ id: "Notas", nombre: "Notas", padreId: null }];
  export const useVaultStore = { getState: () => ({ notas, carpetas }) };`;
  archivos["wikilink.js"] = `export { resolveWikilink } from "./wikilinks.js";`;
  archivos["imagenesRender.js"] = `export const carpetaDeNota = () => null; export function rellenarImagenesEn() {}`;
  archivos["markdown.js"] = `const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  export const renderNota = (t) => "<p>" + esc(t) + "</p>";`;
  for (const [nombre, js] of Object.entries(archivos)) await writeFile(join(TMP, nombre), js);

  const css = await readFile(join(FRONTEND, "styles", "editor.css"), "utf8");
  const pagina = `<!doctype html><meta charset="utf-8">
<style>
  :root { --mic-border: #888; --mic-bg-surface: #fff; --mic-bg-base: #f4f4f4; --mic-text-muted: #555;
          --mic-text-primary: #222; --mic-accent: #6a5acd; --mic-glow: #3cc; --mic-radius-md: 6px; --mic-radius-sm: 4px; }
  body { margin: 0; }
  #nota { width: 400px; }
  ${css}
</style>
<div id="nota" class="mic-preview"><div id="b1"></div><div id="b2"></div></div>
<script type="module">
  const { dibujarCanvasEn } = await import("./canvasRender.js");
  const id1 = await dibujarCanvasEn(document.getElementById("b1"), "Tablero");
  const id2 = await dibujarCanvasEn(document.getElementById("b2"), "No existe");
  await new Promise((r) => setTimeout(r, 300));
  const b1 = document.getElementById("b1");
  const mundo = b1.querySelector(".mic-canvas-mundo");
  const hijos = Array.from(mundo.children).map((e) => e.getAttribute("class"));
  window.resultado = {
    id1, id2,
    hijos,
    transform: mundo.style.transform,
    anchoMarco: b1.querySelector(".mic-canvas-marco").getBoundingClientRect().width,
    aristas: b1.querySelectorAll(".mic-canvas-arista").length,
    hrefs: Array.from(b1.querySelectorAll("a")).map((a) => a.getAttribute("href")),
    imgs: b1.querySelectorAll("img").length,
    pwned: window.__pwned ?? null,
    estiloColor: b1.querySelectorAll(".mic-canvas-tarjeta")[4]?.getAttribute("style") ?? "",
    grupo: b1.querySelector(".mic-canvas-grupo-etiqueta")?.textContent,
    tituloNota: b1.querySelector(".mic-canvas-tarjeta-file .mic-canvas-tarjeta-titulo")?.textContent,
    cuerpoNota: b1.querySelector(".mic-canvas-tarjeta-file .mic-canvas-tarjeta-cuerpo")?.textContent,
    error2: document.getElementById("b2").textContent,
    clases2: document.getElementById("b2").className,
  };
</script>`;
  await writeFile(join(TMP, "index.html"), pagina);

  const navegador = await chromium.launch();
  try {
    const pag = await navegador.newPage();
    const errores = [];
    pag.on("pageerror", (e) => errores.push(String(e)));
    // Se sirven los archivos de la carpeta temporal desde un origen inventado:
    // los módulos ES no cargan desde `file://`.
    await pag.route("http://prueba.local/**", async (ruta) => {
      const nombre = new URL(ruta.request().url()).pathname.slice(1) || "index.html";
      try {
        const cuerpo = await readFile(join(TMP, nombre), "utf8");
        await ruta.fulfill({
          body: cuerpo,
          contentType: nombre.endsWith(".html") ? "text/html" : "text/javascript",
        });
      } catch {
        await ruta.fulfill({ status: 404, body: "" });
      }
    });
    await pag.goto("http://prueba.local/index.html");
    await pag.waitForFunction(() => window.resultado !== undefined, null, { timeout: 15000 });
    const r = await pag.evaluate(() => window.resultado);
    // `SMOKE_CAPTURA=<ruta.png>` guarda cómo se ve, para mirarlo a ojo.
    if (process.env.SMOKE_CAPTURA) await pag.screenshot({ path: process.env.SMOKE_CAPTURA, fullPage: true });
    comprobar(errores.length === 0, `sin errores en la página ${errores.join(" | ")}`);
    comprobar(r.id1 === "Tablero.canvas", "resuelve ![[Tablero]] al lienzo");
    comprobar(
      r.hijos[0] === "mic-canvas-grupo" && r.hijos[1] === "mic-canvas-aristas" &&
        r.hijos.slice(2).every((c) => c.startsWith("mic-canvas-tarjeta")),
      `orden de pintado grupos → flechas → tarjetas (${r.hijos.join(", ")})`,
    );
    comprobar(r.aristas === 2, `dibuja las dos flechas (${r.aristas})`);
    const escala = Number(/scale\(([\d.]+)\)/.exec(r.transform)?.[1]);
    comprobar(escala > 0 && escala < 1, `se achica para entrar en el ancho (escala ${escala})`);
    comprobar(r.anchoMarco <= 400.5, `el marco no pasa el ancho del bloque (${r.anchoMarco}px)`);
    comprobar(r.pwned === null, "ninguna tarjeta ejecutó código");
    comprobar(r.imgs === 0, "ningún <img> inyectado desde el texto o la URL");
    comprobar(
      r.hrefs.length === 1 && r.hrefs[0] === "https://ejemplo.com/",
      `solo la URL permitida es enlace (${JSON.stringify(r.hrefs)})`,
    );
    comprobar(!/background|url\(/.test(r.estiloColor), `un color hostil no llega al style (${r.estiloColor})`);
    comprobar(r.grupo === "Ciclo <b>de vida</b>", "la etiqueta del grupo va como texto");
    comprobar(r.tituloNota === "Hongo" && r.cuerpoNota === "Texto de la nota", "la tarjeta de nota muestra la nota real");
    comprobar(r.id2 === null && /No existe el lienzo/.test(r.error2) && /mic-canvas-error/.test(r.clases2), "un lienzo que no existe deja su aviso");
  } finally {
    await navegador.close();
  }
} finally {
  await rm(TMP, { recursive: true, force: true });
}

if (fallas > 0) {
  console.log(`\n${fallas} comprobación(es) fallaron.`);
  process.exit(1);
}
console.log("\nTodo en orden.");
