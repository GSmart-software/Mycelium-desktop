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
    '<div class="mic-ayuda-ejemplo-rotulo">Escribes</div>' +
    `<pre class="mic-ayuda-ejemplo-fuente"><code>${escapar(fuente)}</code></pre>` +
    '<div class="mic-ayuda-ejemplo-rotulo">Se ve</div>' +
    `<div class="mic-ayuda-ejemplo-render">${renderMarkdown(fuente)}</div>` +
    "</figure>"
  );
}

/**
 * Los atajos de la ayuda que el usuario puede cambiar (`FUN-XL-04`, Parte 3) se
 * escriben como `{{atajo:id-del-comando|Texto de fábrica}}`. Al mostrar la
 * página, `resolver` da el atajo de hoy de ese comando —con lo que el usuario
 * cambió y la tecla como se ve en su teclado—; si el comando no está (la
 * ayuda abierta desde el selector de vaults) o no hay resolver, vale el texto
 * de fábrica. `null` del resolver = el comando no tiene atajo.
 */
export const RE_ATAJO = /\{\{atajo:([a-z0-9.-]+)\|([^}]*)\}\}/g;

/** Lo que el Markdown interpretaría en un texto de atajo («\», «|», «*»…). */
const escaparMd = (s: string) => s.replace(/[\\`*_|[\]<>]/g, (c) => `\\${c}`);

export type ResolverAtajo = (id: string) => string[] | null | undefined;

export function sustituirAtajos(cuerpo: string, resolver?: ResolverAtajo): string {
  return cuerpo.replace(RE_ATAJO, (_, id: string, fabrica: string) => {
    const hoy = resolver?.(id);
    if (hoy === null || (hoy && hoy.length === 0)) return "*sin atajo*";
    const textos = hoy ?? [fabrica];
    return textos.map((t) => `**${escaparMd(t)}**`).join(" o ");
  });
}

export function htmlDePagina(cuerpo: string, resolver?: ResolverAtajo): string {
  return partirEjemplos(sustituirAtajos(cuerpo, resolver))
    .map((t) => (t.tipo === "ejemplo" ? htmlDeEjemplo(t.fuente) : renderMarkdown(t.texto)))
    .join("");
}
