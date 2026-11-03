// Smoke del informe de salud como nota (`FUN-L-32`, parte E) en Chromium.
//
// Arma el Markdown de `lib/informeSalud.ts` con revisiones sintéticas (una
// completa, una de solo notas y una vacía), valida cada bloque ` ```mermaid `
// con el parser de Mermaid (`mermaid.parse`) y los dibuja con el
// `lib/mermaid.ts` real y los CSS del tema, en claro y en oscuro: cada bloque
// tiene que dar un SVG, y la leyenda de la torta tiene que llevar los colores de
// `ORDEN_TORTA` del tema activo. Con `--capturas <carpeta>` guarda una captura.
//
// No necesita `next build` ni la app: sirve los módulos transpilados al vuelo.
//
//   node scripts/smoke-informe-salud.mjs [--capturas <carpeta>]
import { createReadStream, existsSync, mkdirSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { join, normalize, resolve } from "node:path";
import { chromium } from "playwright";
import ts from "typescript";

const FRONTEND = resolve(import.meta.dirname, "..");
const DIST_MERMAID = join(FRONTEND, "node_modules", "mermaid", "dist");
const PUERTO = 3198;
const iCapturas = process.argv.indexOf("--capturas");
const CAPTURAS = iCapturas > 0 ? resolve(process.argv[iCapturas + 1]) : null;
if (CAPTURAS) mkdirSync(CAPTURAS, { recursive: true });

async function transpilar(nombre) {
  const fuente = await readFile(join(FRONTEND, "lib", `${nombre}.ts`), "utf8");
  return ts
    .transpileModule(fuente, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } })
    .outputText.replace(/["']@\/lib\/(\w+)["']/g, '"./$1.js"')
    .replace(/import\(["']mermaid["']\)/g, 'import("/mm/mermaid.esm.min.mjs")');
}

// ── Las revisiones, en Node ─────────────────────────────────────────────────

const aUrl = (codigo) => `data:text/javascript,${encodeURIComponent(codigo)}`;
const ESTADISTICAS = aUrl(await transpilar("estadisticas"));
const PALETA = aUrl(await transpilar("paletaGraficas"));
const E = await import(ESTADISTICAS);
const I = await import(
  aUrl((await transpilar("informeSalud")).split('"./estadisticas.js"').join(`"${ESTADISTICAS}"`).split('"./paletaGraficas.js"').join(`"${PALETA}"`))
);

const MB = 1024 * 1024;
const AHORA = new Date(2026, 10, 2, 0, 41);
const informeVacio = () => ({
  alcance: { tipo: "vault" },
  notas: 0,
  rotos: [],
  embedsRotos: [],
  duplicados: [],
  huerfanas: [],
  sinSalientes: [],
  propiedades: [],
  avisosEsquemas: [],
});

function revision(rutas, otros, filas, informe) {
  const notas = rutas.map((id) => ({
    id,
    titulo: id.slice(id.lastIndexOf("/") + 1).replace(/\.md$/, ""),
    carpetaId: id.includes("/") ? id.slice(0, id.lastIndexOf("/")) : null,
    tipo: "markdown",
  }));
  return {
    informe,
    estadisticas: E.calcularEstadisticas({
      archivos: [...rutas.map((ruta, i) => ({ ruta, bytes: 1500 + i * 700 })), ...otros],
      notas,
      filas,
      excluida: () => false,
      creacion: notas.map((n, i) => ({ id: n.id, creadoEn: new Date(2026, 10 - (i % 12), 1 + (i % 27)).toISOString() })),
      etiquetas: { distintas: 2, notasConEtiqueta: 5, masUsadas: [{ etiqueta: "tesis", notas: 4 }, { etiqueta: "lectura", notas: 2 }] },
      ahora: AHORA,
    }),
    revisadoEn: AHORA.toISOString(),
    duracionMs: 90,
  };
}

const rutas = Array.from({ length: 60 }, (_, i) => `${["Capítulos", "Lecturas", "Notas de campo", 'Raro "x" %%'][i % 4]}/Nota ${i}.md`);
const filas = rutas.flatMap((r, i) => (i % 5 === 0 ? [] : [{ desde: r, texto: "x", tipo: "enlace", destino: rutas[(i * 7) % rutas.length], n: 1 }]));
const completo = revision(
  rutas,
  [
    { ruta: "Adjuntos/a.png", bytes: 120 * MB },
    { ruta: "Adjuntos/b.pdf", bytes: 80 * MB },
    { ruta: "Diagramas/d.drawio", bytes: 2 * MB },
    { ruta: "x.base", bytes: 900 },
  ],
  filas,
  {
    ...informeVacio(),
    rotos: [{ desde: rutas[1], texto: "Entrevista 14", tipo: "enlace", n: 1, lineas: [3] }],
    huerfanas: [{ ruta: rutas[0], titulo: "Nota 0" }],
  },
);
const CASOS = {
  completo: I.markdownInformeSalud(completo),
  "solo notas": I.markdownInformeSalud(revision(["a.md", "b.md"], [], [], informeVacio())),
  vacío: I.markdownInformeSalud(revision([], [], [], informeVacio())),
};
const BLOQUES = Object.entries(CASOS).flatMap(([caso, md]) =>
  [...md.matchAll(/```mermaid\n([\s\S]*?)\n```/g)].map((m) => ({ caso, fuente: m[1] })),
);

// ── La página ───────────────────────────────────────────────────────────────

const escapar = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const PAGINA = `<!doctype html><html data-theme="bioluminiscencia" data-atmosfera="abisal">
<head><meta charset="utf-8">
<link rel="stylesheet" href="/css/tokens.css"><link rel="stylesheet" href="/css/atmosferas.css">
<style>
  body { margin: 0; background: var(--mic-bg-canvas); }
  .mic-preview { background: var(--mic-bg-canvas); color: var(--mic-text-primary);
    font-family: system-ui, sans-serif; padding: 16px; width: 720px; }
</style></head>
<body><div class="mic-preview" id="nota">
${BLOQUES.map((b) => `<pre><code class="language-mermaid">${escapar(b.fuente)}</code></pre>`).join("\n")}
</div>
<script type="module">
  import mermaid from "/mm/mermaid.esm.min.mjs";
  import { renderMermaidIn } from "/lib/mermaid.js";
  import { leerPaletaGraficas } from "/lib/paletaGraficas.js";
  window.mermaid = mermaid;
  window.renderMermaidIn = renderMermaidIn;
  window.leerPaletaGraficas = leerPaletaGraficas;
  window.listo = true;
</script></body></html>`;

const servidor = createServer(async (req, res) => {
  const url = decodeURIComponent(new URL(req.url, "http://x").pathname);
  try {
    if (url === "/") return res.writeHead(200, { "content-type": "text/html" }).end(PAGINA);
    if (url.startsWith("/lib/")) {
      return res.writeHead(200, { "content-type": "text/javascript" }).end(await transpilar(url.slice(5).replace(/\.js$/, "")));
    }
    if (url.startsWith("/css/")) {
      return res.writeHead(200, { "content-type": "text/css" }).end(await readFile(join(FRONTEND, "styles", url.slice(5))));
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
  const pagina = await navegador.newPage({ viewport: { width: 760, height: 900 } });
  pagina.on("pageerror", (e) => console.error("error en la página:", e.message));
  await pagina.goto(`http://localhost:${PUERTO}/`);
  await pagina.waitForFunction(() => window.listo);

  // 1. El parser de Mermaid acepta cada bloque.
  for (const b of BLOQUES) {
    const r = await pagina.evaluate(async (f) => {
      try {
        const ok = await window.mermaid.parse(f);
        return ok ? "ok" : "rechazado";
      } catch (e) {
        return String(e.message ?? e);
      }
    }, b.fuente);
    if (r !== "ok") fallos++;
    console.log(`${r === "ok" ? "ok  " : "FALLO"} parse   ${b.caso.padEnd(11)} ${b.fuente.split("\n")[0]}${r === "ok" ? "" : `\n      ${r}`}`);
  }

  // 2. Dibujados con el lib/mermaid.ts real, en claro y en oscuro.
  for (const oscuro of [false, true]) {
    await pagina.evaluate(async (oscuro) => {
      if (oscuro) document.documentElement.setAttribute("data-dark", "true");
      else document.documentElement.removeAttribute("data-dark");
      await window.renderMermaidIn(document.getElementById("nota"));
    }, oscuro);
    await pagina.waitForTimeout(600);
    const m = await pagina.evaluate(() => {
      const ctx = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
      const hex = (css) => {
        ctx.clearRect(0, 0, 1, 1);
        ctx.fillStyle = css;
        ctx.fillRect(0, 0, 1, 1);
        return "#" + Array.from(ctx.getImageData(0, 0, 1, 1).data.slice(0, 3)).map((n) => n.toString(16).padStart(2, "0")).join("");
      };
      const svgs = [...document.querySelectorAll(".mic-mermaid svg")];
      const errores = document.querySelectorAll(".mic-mermaid-error, [class*='error']").length;
      const p = window.leerPaletaGraficas(document.getElementById("nota"));
      const tortas = svgs.filter((s) => s.querySelector(".pieCircle"));
      const leyendas = tortas.map((t) => [...t.querySelectorAll(".legend rect")].map((r) => hex(getComputedStyle(r).fill)));
      return { svgs: svgs.length, errores, tortasOk: leyendas.every((l) => JSON.stringify(l) === JSON.stringify(p.torta)), leyendas };
    });
    const ok = m.svgs === BLOQUES.length && m.errores === 0 && m.tortasOk;
    if (!ok) fallos++;
    console.log(
      `${ok ? "ok  " : "FALLO"} dibujo  ${oscuro ? "oscuro" : "claro "}      ${m.svgs}/${BLOQUES.length} SVG, ${m.errores} errores, torta ${m.tortasOk ? "con los colores del tema" : `MAL ${JSON.stringify(m.leyendas)}`}`,
    );
    if (CAPTURAS) await pagina.locator("#nota").screenshot({ path: join(CAPTURAS, `informe-${oscuro ? "oscuro" : "claro"}.png`) });
  }
} finally {
  await navegador.close();
  servidor.close();
}
if (fallos) {
  console.error(`\n${fallos} comprobación(es) fallaron.`);
  process.exit(1);
}
console.log("\nTodos los bloques del informe se validan y se dibujan.");
