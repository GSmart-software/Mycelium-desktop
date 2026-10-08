import { useMemo, type DependencyList } from "react";

/**
 * El `dangerouslySetInnerHTML` de una vista de lectura que después se **decora**
 * en el DOM (`DEF-133`): los embeds de Excalidraw y draw.io, los diagramas
 * Mermaid, las imágenes, los botones de copiar. Todo eso lo pone un efecto
 * *después* de que React pinta, reemplazando los placeholders del HTML.
 *
 * React 19 compara la prop por **identidad del objeto**, no por el texto: con
 * `dangerouslySetInnerHTML={{ __html: html }}` cada render trae un objeto nuevo y
 * React vuelve a asignar `innerHTML` —aunque el HTML sea el mismo—, lo que borra
 * lo decorado y deja los placeholders crudos («Diagrama Croquis de la huerta»).
 * El efecto que decora no vuelve a correr, porque sus dependencias no cambiaron:
 * cualquier re-render ajeno (una preferencia, la barra de estado, volver a la
 * pestaña) dejaba el marcador hasta que la nota cambiara.
 *
 * Este hook devuelve el **mismo** objeto mientras no cambien el HTML ni
 * `decoracion`. `decoracion` tiene que ser la lista de dependencias del efecto que
 * decora (sin el HTML): así el HTML crudo se repone exactamente cuando ese efecto
 * va a volver a correr —p. ej. tras editar el dibujo, que necesita los
 * placeholders de vuelta para redibujarlo— y nunca en otro momento.
 */
export function useHtmlDecorable(html: string, decoracion: DependencyList): { __html: string } {
  // La lista tiene largo fijo en cada llamador; el lint no puede verlo.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => ({ __html: html }), [html, ...decoracion]);
}
