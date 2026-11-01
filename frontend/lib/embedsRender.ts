/**
 * Los embeds de una nota ya renderizada, del lado del DOM (`FUN-S-18`).
 *
 * `lib/markdown.ts` no conoce el vault: un `![[x.excalidraw]]` o un
 * `![[x.drawio]]` le alcanzan para saber qué dibujar, pero un `![[Mi diagrama]]`
 * sale como el enlace de siempre, marcado con `data-embed`. Acá se resuelve por
 * título (`embebidoDe`, `lib/embeds.ts`) y, si el destino se sabe dibujar, el
 * enlace se cambia por el marcador del tipo que encontró. Después lo dibuja el
 * renderizador de cada tipo, como a los que traían la extensión.
 *
 * Todos los que muestran una nota en lectura —el editor, el visor de la barra
 * lateral, el preview vinculado y la exportación a PDF— llaman a
 * `renderEmbedsIn`: así un tipo nuevo de embed se agrega en un solo lugar.
 */

import { embebidoDe, type TipoEmbebible } from "@/lib/embeds";
import { renderDrawioIn } from "@/lib/drawioRender";
import { renderExcalidrawIn } from "@/lib/excalidraw";
import { useVaultStore } from "@/stores/vaultStore";

/** La clase del marcador que espera el renderizador de cada tipo. */
const CLASE_MARCADOR: Record<TipoEmbebible, string> = {
  excalidraw: "mic-excalidraw",
  drawio: "mic-drawio",
};

/**
 * Cambia cada `a.mic-wikilink[data-embed]` cuyo destino se sabe dibujar por el
 * marcador de su tipo. Lo que no resuelve, o resuelve a una nota, queda como
 * estaba: un enlace con su `!` delante.
 */
export function resolverEmbedsEn(root: HTMLElement): void {
  const enlaces = root.querySelectorAll<HTMLAnchorElement>("a.mic-wikilink[data-embed]");
  if (enlaces.length === 0) return;
  const { notas, carpetas } = useVaultStore.getState();
  for (const a of Array.from(enlaces)) {
    const href = a.getAttribute("href") ?? "";
    if (!href.startsWith("#wikilink:")) continue;
    const embebido = embebidoDe(decodeURIComponent(href.slice("#wikilink:".length)), notas, carpetas);
    if (!embebido) continue;
    const marcador = document.createElement("a");
    marcador.className = CLASE_MARCADOR[embebido.tipo];
    marcador.setAttribute("data-diag", embebido.ref);
    if (embebido.ancla) marcador.setAttribute("data-ancla", embebido.ancla);
    marcador.textContent = embebido.ref;
    // El `!` del embed quedó en el texto de antes (ver `remarkMicelio`).
    const previo = a.previousSibling;
    if (previo?.nodeType === Node.TEXT_NODE && previo.textContent?.endsWith("!")) {
      previo.textContent = previo.textContent.slice(0, -1);
    }
    a.replaceWith(marcador);
  }
}

/**
 * Dibuja todos los embeds de un contenedor: primero resuelve los que no traían
 * extensión, después cada tipo. Nunca lanza: cada renderizador deja su aviso
 * en el lugar del embed que no pudo dibujar.
 */
export async function renderEmbedsIn(container: HTMLElement): Promise<void> {
  resolverEmbedsEn(container);
  await Promise.all([renderExcalidrawIn(container), renderDrawioIn(container)]);
}

/** `embebidoDe` contra el vault abierto: lo usa la vista en vivo, línea por línea. */
export function embebidoEnVault(inner: string) {
  const { notas, carpetas } = useVaultStore.getState();
  return embebidoDe(inner, notas, carpetas);
}
