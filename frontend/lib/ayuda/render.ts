import { partirEjemplos } from "@/lib/ayuda/ejemplos";
import { renderMarkdown } from "@/lib/markdown";

/**
 * Una página de ayuda → HTML, con `renderMarkdown`: el MISMO motor de la vista
 * de lectura (callouts, tareas, énfasis propio, KaTeX, tablas…). Mermaid y el
 * botón de copiar los agrega quien muestra la página, igual que en la nota.
 *
 * Cada bloque ```ejemplo sale como una figura con dos partes: la fuente en un
 * `<pre>` (que recibe el «Copiar» de `addCodeCopyButtons`) y su render.
 */

const ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" };
const escapar = (s: string) => s.replace(/[&<>"]/g, (c) => ESCAPES[c]);

function htmlDeEjemplo(fuente: string): string {
  return (
    '<figure class="mic-ayuda-ejemplo">' +
    '<div class="mic-ayuda-ejemplo-rotulo">Escribís</div>' +
    `<pre class="mic-ayuda-ejemplo-fuente"><code>${escapar(fuente)}</code></pre>` +
    '<div class="mic-ayuda-ejemplo-rotulo">Se ve</div>' +
    `<div class="mic-ayuda-ejemplo-render">${renderMarkdown(fuente)}</div>` +
    "</figure>"
  );
}

export function htmlDePagina(cuerpo: string): string {
  return partirEjemplos(cuerpo)
    .map((t) => (t.tipo === "ejemplo" ? htmlDeEjemplo(t.fuente) : renderMarkdown(t.texto)))
    .join("");
}
