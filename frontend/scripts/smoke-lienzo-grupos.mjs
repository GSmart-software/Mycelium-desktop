// Smoke del orden de pintado del lienzo en Chromium (`DEF-151`).
//
// Una flecha entre dos tarjetas que están dentro de un grupo quedaba tapada por el
// grupo. Este smoke arma, con el CSS REAL de `CanvasView.module.css` y las
// funciones REALES de `lib/canvas.ts` (`parsearCanvas`, `ordenDePintado`,
// `trazoArista`), el mismo árbol que pinta `CanvasView`: `.mundo` > grupos >
// `<svg>` de flechas > tarjetas. Y pregunta con `elementFromPoint` qué hay encima
// en cada punto:
//
// - en el medio de la flecha → la flecha (no el grupo);
// - en el centro de cada tarjeta → la tarjeta (se sigue pudiendo tocar);
// - en un hueco del grupo → el grupo (se sigue pudiendo seleccionar y arrastrar).
//
// Como el SVG no recibe el puntero (`pointer-events: none`), para la prueba se le
// activa `pointer-events: stroke` a las flechas: así `elementFromPoint` las ve si,
// y solo si, están pintadas encima.
//
// El JSX no se monta (necesitaría la app entera): se comprueba en la fuente que
// `CanvasView.tsx` pinta en ese orden. Y se arma también el orden VIEJO (todo en
// el orden del archivo, después del SVG) para probar que el smoke detecta el
// defecto.
//
//   node scripts/smoke-lienzo-grupos.mjs
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { chromium } from "playwright";
import ts from "typescript";

const FRONTEND = resolve(import.meta.dirname, "..");

let fallas = 0;
function comprobar(ok, mensaje) {
  console.log(`${ok ? "ok  " : "FALLA"} ${mensaje}`);
  if (!ok) fallas++;
}

// 1. La fuente pinta grupos → flechas → tarjetas.
const vista = readFileSync(join(FRONTEND, "components", "canvas", "CanvasView.tsx"), "utf8");
const iGrupos = vista.indexOf("{pintado.grupos.map(vistaDe)}");
const iSvg = vista.indexOf("<svg className={styles.aristas}");
const iTarjetas = vista.indexOf("{pintado.tarjetas.map(vistaDe)}");
comprobar(
  iGrupos > 0 && iSvg > iGrupos && iTarjetas > iSvg,
  "CanvasView.tsx pinta los grupos, después el SVG de flechas y después las tarjetas",
);
comprobar(!/canvas\.nodos\.map\(\(n\) => \(\s*<NodoVista/.test(vista), "ya no pinta los nodos en un solo bloque");

// 2. Página con el CSS real y el núcleo real.
const { outputText: nucleo } = ts.transpileModule(
  readFileSync(join(FRONTEND, "lib", "canvas.ts"), "utf8"),
  { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 } },
);
// Las clases del módulo se usan tal cual (sin hash); `:global(x)` → `x`.
const css = readFileSync(join(FRONTEND, "components", "canvas", "CanvasView.module.css"), "utf8")
  .replace(/:global\(([^)]+)\)/g, "$1");

// Grupo listado ÚLTIMO, el peor caso: con el orden viejo tapaba flecha y tarjetas.
const LIENZO = JSON.stringify({
  nodes: [
    { id: "a", type: "text", x: 40, y: 60, width: 160, height: 80, text: "Espora" },
    { id: "b", type: "text", x: 400, y: 60, width: 160, height: 80, text: "Micelio" },
    { id: "g", type: "group", x: 0, y: 0, width: 600, height: 300, label: "Ciclo" },
  ],
  edges: [{ id: "e", fromNode: "a", fromSide: "right", toNode: "b", toSide: "left" }],
});

const html = `<!doctype html><meta charset="utf-8">
<style>
  :root { --mic-border: #888; --mic-bg-surface: #fff; --mic-text-muted: #555; --mic-accent: #6a5acd; --mic-radius-md: 6px; }
  body { margin: 0; }
  .lienzo { position: relative; width: 700px; height: 400px; overflow: hidden; }
  ${css}
  .aristas path { pointer-events: stroke; }
</style>
<div class="lienzo" id="nuevo"><div class="mundo"></div></div>
<div class="lienzo" id="viejo"><div class="mundo"></div></div>
<script type="module">
  const { parsearCanvas, ordenDePintado, ladosAutomaticos, trazoArista } =
    await import("data:text/javascript," + encodeURIComponent(${JSON.stringify(nucleo)}));
  const canvas = parsearCanvas(${JSON.stringify(LIENZO)});
  const SVG = "http://www.w3.org/2000/svg";

  const nodoDom = (n) => {
    const el = document.createElement("div");
    el.dataset.nodo = n.id;
    el.className = "nodo" + (n.tipo === "group" ? " nodoGrupo" : "");
    Object.assign(el.style, { left: n.x + "px", top: n.y + "px", width: n.ancho + "px", height: n.alto + "px" });
    el.innerHTML = '<div class="asa"><span class="asaTitulo">' + (n.etiqueta ?? n.texto) + '</span></div><div class="cuerpo"></div>';
    return el;
  };
  const svgDom = () => {
    const svg = document.createElementNS(SVG, "svg");
    svg.setAttribute("class", "aristas");
    const porId = new Map(canvas.nodos.map((n) => [n.id, n]));
    for (const a of canvas.aristas) {
      const desde = porId.get(a.desdeNodo), hasta = porId.get(a.hastaNodo);
      const auto = ladosAutomaticos(desde, hasta);
      const p = document.createElementNS(SVG, "path");
      p.setAttribute("class", "arista");
      p.dataset.arista = a.id;
      p.setAttribute("d", trazoArista(desde, a.desdeLado ?? auto.desde, hasta, a.hastaLado ?? auto.hasta).d);
      svg.append(p);
    }
    return svg;
  };

  // Orden nuevo: el de CanvasView.
  const { grupos, tarjetas } = ordenDePintado(canvas.nodos);
  document.querySelector("#nuevo .mundo").append(...grupos.map(nodoDom), svgDom(), ...tarjetas.map(nodoDom));
  // Orden viejo: SVG y después todos los nodos en el orden del archivo.
  document.querySelector("#viejo .mundo").append(svgDom(), ...canvas.nodos.map(nodoDom));

  const queHay = (raiz, x, y) => {
    const r = document.querySelector(raiz).getBoundingClientRect();
    const el = document.elementFromPoint(r.left + x, r.top + y);
    if (el?.dataset?.arista) return "flecha";
    return el?.closest("[data-nodo]")?.dataset.nodo ?? "fondo";
  };
  const camino = document.querySelector("#nuevo path");
  const medio = camino.getPointAtLength(camino.getTotalLength() / 2);
  window.resultado = {
    medio: { x: medio.x, y: medio.y },
    nuevo: {
      flecha: queHay("#nuevo", medio.x, medio.y),
      tarjetaA: queHay("#nuevo", 120, 110),
      tarjetaB: queHay("#nuevo", 480, 110),
      huecoGrupo: queHay("#nuevo", 300, 250),
    },
    viejo: { flecha: queHay("#viejo", medio.x, medio.y) },
  };
</script>`;

const navegador = await chromium.launch();
try {
  const pagina = await navegador.newPage({ viewport: { width: 800, height: 900 } });
  pagina.on("pageerror", (e) => comprobar(false, `error en la página: ${e.message}`));
  await pagina.setContent(html);
  await pagina.waitForFunction(() => window.resultado !== undefined, null, { timeout: 10000 });
  const r = await pagina.evaluate(() => window.resultado);
  console.log(`     medio de la flecha en (${r.medio.x}, ${r.medio.y})`);

  comprobar(r.viejo.flecha === "g", `con el orden viejo el grupo tapa la flecha (se ve: ${r.viejo.flecha})`);
  comprobar(r.nuevo.flecha === "flecha", `con el orden nuevo la flecha queda encima del grupo (se ve: ${r.nuevo.flecha})`);
  comprobar(r.nuevo.tarjetaA === "a", `la tarjeta A dentro del grupo recibe el puntero (se ve: ${r.nuevo.tarjetaA})`);
  comprobar(r.nuevo.tarjetaB === "b", `la tarjeta B dentro del grupo recibe el puntero (se ve: ${r.nuevo.tarjetaB})`);
  comprobar(r.nuevo.huecoGrupo === "g", `un hueco del grupo selecciona el grupo (se ve: ${r.nuevo.huecoGrupo})`);
} finally {
  await navegador.close();
}

console.log(fallas === 0 ? "\nTodo bien." : `\n${fallas} comprobación(es) fallida(s).`);
process.exit(fallas === 0 ? 0 : 1);
