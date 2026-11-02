/**
 * Los snippets CSS del usuario van **al final** del `<head>`, siempre
 * (`FUN-M-58`).
 *
 * Un snippet gana a las hojas de la app con la misma especificidad porque su
 * `<style>` (`#mic-custom-css`, y `#mic-css-preview` mientras se edita uno) se
 * agrega después de ellas. Pero hay hojas que llegan **más tarde**, con el trozo
 * de JS que las importa: la de Excalidraw al abrir el primer dibujo, la de
 * KaTeX con la ayuda (desde que no van en el layout raíz), las de cualquier
 * componente que se carga a pedido. El cargador las agrega al final del
 * `<head>`, detrás del snippet, y entonces le ganaban a una regla del usuario
 * que antes ganaba. Con esto, cada vez que entra una hoja detrás de los
 * snippets, los snippets vuelven a ponerse últimos.
 */

/** Los `<style>` de los snippets, en el orden en que tienen que quedar. */
export const IDS_SNIPPETS = ["mic-custom-css", "mic-css-preview"] as const;

type Nodo = { id: string; tagName: string; getAttribute(nombre: string): string | null };
type Cabeza<N extends Nodo> = { readonly children: ArrayLike<N>; appendChild(n: N): unknown };

function esHoja(n: Nodo): boolean {
  const etiqueta = n.tagName.toUpperCase();
  if (etiqueta === "STYLE") return true;
  return etiqueta === "LINK" && (n.getAttribute("rel") ?? "").toLowerCase().split(/\s+/).includes("stylesheet");
}

/**
 * Si hay alguna hoja ajena después del primer `<style>` de snippets, los
 * vuelve a poner al final (en el orden de `IDS_SNIPPETS`). Devuelve si movió.
 */
export function snippetsAlFinal<N extends Nodo>(head: Cabeza<N>): boolean {
  const hijos = Array.from(head.children);
  const ids: readonly string[] = IDS_SNIPPETS;
  const propios = IDS_SNIPPETS.map((id) => hijos.find((h) => h.id === id)).filter((h): h is N => h !== undefined);
  if (propios.length === 0) return false;
  const desde = Math.min(...propios.map((p) => hijos.indexOf(p)));
  const hayDetras = hijos.some((h, i) => i > desde && !ids.includes(h.id) && esHoja(h));
  if (!hayDetras) return false;
  for (const p of propios) head.appendChild(p);
  return true;
}

let vigia: MutationObserver | null = null;

/** Mantiene los snippets al final mientras viva la ventana. Idempotente. */
export function mantenerSnippetsAlFinal(): void {
  if (typeof document === "undefined" || typeof MutationObserver === "undefined") return;
  snippetsAlFinal<Element>(document.head);
  if (vigia !== null) return;
  // Mover un `<style>` propio dispara el observador otra vez, pero entonces ya
  // no hay nada detrás y no hace nada.
  vigia = new MutationObserver(() => snippetsAlFinal<Element>(document.head));
  vigia.observe(document.head, { childList: true });
}
