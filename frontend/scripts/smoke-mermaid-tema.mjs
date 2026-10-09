// Smoke de los colores de Mermaid en Chromium (`DEF-142`).
//
// Dibuja el diagrama del defecto con el `lib/mermaid.ts` real y los CSS reales
// (`styles/tokens.css` + `styles/atmosferas.css`) en los 16 combos de tema ×
// modo × atmósfera, cambiando los atributos de `<html>` como lo hace la app: así
// prueba también que el diagrama se REDIBUJA al cambiar el tema, sin volver a
// llamar a `renderMermaidIn`. Mide en el SVG dibujado el contraste del texto
// sobre la caja (≥4.5:1), y de la flecha y el borde sobre el fondo (≥3:1). Con
// `--capturas <carpeta>` guarda una captura por combo.
//
// No necesita `next build` ni la app: sirve los módulos transpilados al vuelo.
//
//   node scripts/smoke-mermaid-tema.mjs [--capturas <carpeta>]
import { createReadStream, existsSync, mkdirSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { join, normalize, resolve } from "node:path";
import { chromium } from "playwright";
import ts from "typescript";

const FRONTEND = resolve(import.meta.dirname, "..");
const DIST_MERMAID = join(FRONTEND, "node_modules", "mermaid", "dist");
const PUERTO = 3197;
const iCapturas = process.argv.indexOf("--capturas");
const CAPTURAS = iCapturas > 0 ? resolve(process.argv[iCapturas + 1]) : null;
if (CAPTURAS) mkdirSync(CAPTURAS, { recursive: true });

async function modulo(nombre) {
  const fuente = await readFile(join(FRONTEND, "lib", `${nombre}.ts`), "utf8");
  return ts
    .transpileModule(fuente, {
      compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    })
    .outputText.replace(/["']@\/lib\/mermaidTema["']/g, '"./mermaidTema.js"')
    .replace(/import\(["']mermaid["']\)/g, 'import("/mm/mermaid.esm.min.mjs")');
}

const PAGINA = `<!doctype html><html data-theme="bioluminiscencia" data-atmosfera="abisal">
<head><meta charset="utf-8">
<link rel="stylesheet" href="/css/tokens.css"><link rel="stylesheet" href="/css/atmosferas.css">
<style>
  body { margin: 0; background: var(--mic-bg-canvas); }
  .mic-preview { background: var(--mic-bg-canvas); color: var(--mic-text-primary);
    font-family: system-ui, sans-serif; padding: 16px; width: 640px; }
</style></head>
<body><div class="mic-preview" id="nota">
<pre><code class="language-mermaid">graph LR
  A[Siembra] --> B[Cosecha]
  B -->|guardar| C[(Semillas)]
  subgraph Huerta
    C --> A
  end</code></pre>
<pre><code class="language-mermaid">sequenceDiagram
  autonumber
  Jardinera->>Huerta: riega
  Note right of Huerta: crece
  Huerta-->>Jardinera: cosecha</code></pre>
</div>
<script type="module">
  import { renderMermaidIn } from "/lib/mermaid.js";
  window.renderMermaidIn = renderMermaidIn;
  window.listo = true;
</script></body></html>`;

const servidor = createServer(async (req, res) => {
  const url = decodeURIComponent(new URL(req.url, "http://x").pathname);
  try {
    if (url === "/") return res.writeHead(200, { "content-type": "text/html" }).end(PAGINA);
    if (url.startsWith("/lib/")) {
      const js = await modulo(url.slice(5).replace(/\.js$/, ""));
      return res.writeHead(200, { "content-type": "text/javascript" }).end(js);
    }
    if (url.startsWith("/css/")) {
      return res
        .writeHead(200, { "content-type": "text/css" })
        .end(await readFile(join(FRONTEND, "styles", url.slice(5))));
    }
    if (url.startsWith("/mm/")) {
      const ruta = normalize(join(DIST_MERMAID, url.slice(4)));
      if (ruta.startsWith(DIST_MERMAID) && existsSync(ruta)) {
        res.writeHead(200, { "content-type": "text/javascript" });
        return createReadStream(ruta).pipe(res);
      }
    }
    res.writeHead(404).end();
  } catch (e) {
    res.writeHead(500).end(String(e));
  }
});
await new Promise((r) => servidor.listen(PUERTO, r));

const navegador = await chromium.launch();
let fallos = 0;
try {
  const pagina = await navegador.newPage({ viewport: { width: 680, height: 900 } });
  pagina.on("pageerror", (e) => console.error("error en la página:", e.message));
  await pagina.goto(`http://localhost:${PUERTO}/`);
  await pagina.waitForFunction(() => window.listo);
  await pagina.evaluate(() => window.renderMermaidIn(document.getElementById("nota")));

  for (const tema of ["bioluminiscencia", "cantarela"]) {
    for (const oscuro of [false, true]) {
      // Aurora (`FUN-M-54`) no está: no redefine ningún token (lo prueba
      // test-temas.mjs), así que los diagramas salen como en Abisal, y el SVG
      // no cambiaría al pasar de una a la otra (la espera de abajo vencería).
      for (const atmosfera of ["abisal", "niebla", "bosque", "papel"]) {
        const combo = `${tema} ${oscuro ? "oscuro" : "claro"} ${atmosfera}`;
        const antes = await pagina.evaluate(() => document.querySelector(".mic-mermaid svg")?.outerHTML);
        await pagina.evaluate(
          ({ tema, oscuro, atmosfera }) => {
            const html = document.documentElement;
            html.setAttribute("data-theme", tema);
            if (oscuro) html.setAttribute("data-dark", "true");
            else html.removeAttribute("data-dark");
            html.setAttribute("data-atmosfera", atmosfera);
          },
          { tema, oscuro, atmosfera },
        );
        // El redibujo es asíncrono (agrupa la ráfaga de atributos): esperar a
        // que el SVG cambie, salvo el primer combo, que ya es el inicial.
        await pagina
          .waitForFunction((a) => document.querySelector(".mic-mermaid svg")?.outerHTML !== a, antes, {
            timeout: 3000,
          })
          .catch(() => {});
        await pagina.waitForTimeout(150);

        const m = await pagina.evaluate(() => {
          const ctx = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
          const rgb = (css) => {
            ctx.clearRect(0, 0, 1, 1);
            ctx.fillStyle = css;
            ctx.fillRect(0, 0, 1, 1);
            return Array.from(ctx.getImageData(0, 0, 1, 1).data.slice(0, 3));
          };
          const lum = (c) =>
            c
              .map((n) => n / 255)
              .map((s) => (s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4))
              .reduce((t, s, i) => t + s * [0.2126, 0.7152, 0.0722][i], 0);
          const contraste = (a, b) => {
            const [x, y] = [lum(rgb(a)), lum(rgb(b))].sort((p, q) => q - p);
            return (x + 0.05) / (y + 0.05);
          };
          const svg = document.querySelector(".mic-mermaid svg");
          const fondo = getComputedStyle(document.getElementById("nota")).backgroundColor;
          const caja = svg.querySelector(".node rect, .node path, .node polygon");
          const flecha = svg.querySelector(".flowchart-link, path.edge-pattern-solid");
          const punta = svg.querySelector("marker path");
          const texto = svg.querySelector(".nodeLabel, .node text");
          const cs = (el) => getComputedStyle(el);
          return {
            fondo,
            caja: cs(caja).fill,
            texto: cs(texto).color || cs(texto).fill,
            textoCaja: contraste(cs(texto).color || cs(texto).fill, cs(caja).fill),
            bordeFondo: contraste(cs(caja).stroke, fondo),
            flechaFondo: contraste(cs(flecha).stroke, fondo),
            puntaFondo: contraste(cs(punta).fill, fondo),
          };
        });
        const ok =
          m.textoCaja >= 4.5 && m.bordeFondo >= 3 && m.flechaFondo >= 3 && m.puntaFondo >= 3;
        if (!ok) fallos++;
        console.log(
          `${ok ? "ok  " : "FALLO"} ${combo.padEnd(34)} texto/caja ${m.textoCaja.toFixed(2)}  borde ${m.bordeFondo.toFixed(2)}  flecha ${m.flechaFondo.toFixed(2)}  punta ${m.puntaFondo.toFixed(2)}`,
        );
        if (CAPTURAS) {
          await pagina.locator("#nota").screenshot({ path: join(CAPTURAS, `${combo.replace(/ /g, "-")}.png`) });
        }
      }
    }
  }

  // El PDF con «Fondo blanco»: tema fijo de impresión, no sigue a la ventana.
  const imprimir = await pagina.evaluate(async () => {
    const c = document.createElement("div");
    c.className = "mic-preview";
    c.innerHTML = '<pre><code class="language-mermaid">graph LR\n A --> B</code></pre>';
    document.body.appendChild(c);
    await window.renderMermaidIn(c, "imprimir");
    const fill = getComputedStyle(c.querySelector(".node rect")).fill;
    c.remove();
    return fill;
  });
  const imprimirOk = /rgb\((2[0-5]\d), \1, \1\)/.test(imprimir);
  if (!imprimirOk) fallos++;
  console.log(`${imprimirOk ? "ok  " : "FALLO"} imprimir (ventana en oscuro) caja ${imprimir}`);
} finally {
  await navegador.close();
  servidor.close();
}
if (fallos) {
  console.error(`\n${fallos} combo(s) sin contraste suficiente.`);
  process.exit(1);
}
console.log("\nTodos los combos pasan.");
