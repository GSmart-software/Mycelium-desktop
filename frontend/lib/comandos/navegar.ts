/**
 * Navegar desde un comando (`FUN-XL-04`): la URL es la fuente de navegación
 * del workspace (HU-20), así que abrir algo es poner su id en `?note=`. Lo
 * usan los comandos del catálogo y la paleta para las notas que lista.
 */
import { pedirEdicionDeTitulo } from "@/lib/editor/tituloPendiente";
import { useTabsStore } from "@/stores/tabsStore";

export const urlDeNota = (id: string) => `/workspace?note=${encodeURIComponent(id)}`;

/**
 * Tras abrir una nota desde la paleta, el foco va a la nota y no vuelve a lo que
 * estaba enfocado antes (el diálogo lo devuelve al cerrar): si era otra
 * pestaña, quedaba un anillo sobre algo que ya no está activo. Se espera a que
 * el pane activo monte el documento, unos cuadros como máximo.
 */
export function enfocarNota(notaId: string, intentos = 30) {
  requestAnimationFrame(() => {
    const { activePaneId, activeNotaId } = useTabsStore.getState();
    const cuerpo = document.querySelector(`[data-pane-id="${CSS.escape(activePaneId)}"]`);
    const destino =
      cuerpo?.querySelector<HTMLElement>(".cm-content") ??
      cuerpo?.querySelector<HTMLElement>(".mic-preview");
    if (activeNotaId() === notaId && destino) {
      if (!destino.isContentEditable && !destino.hasAttribute("tabindex")) destino.tabIndex = -1;
      destino.focus();
    } else if (intentos > 0) {
      enfocarNota(notaId, intentos - 1);
    }
  });
}

/** Abre una nota (o una pestaña especial) en el pane activo y le da el foco. */
export function abrirNota(
  navegar: (url: string) => void,
  id: string,
  { editarTitulo = false }: { editarTitulo?: boolean } = {},
) {
  // Nota recién creada «Sin título» (`DEF-135`): el foco lo pone el editor
  // en el título, y `enfocarNota` no debe llevárselo al cuerpo después.
  if (editarTitulo) pedirEdicionDeTitulo(id);
  useTabsStore.getState().openNote(id);
  navegar(urlDeNota(id));
  if (!editarTitulo) enfocarNota(id);
}

/**
 * Deja la URL en la nota activa tras cerrar, reabrir o navegar el historial.
 * `replace` y no `push` (DEF-040): con historial propio por pestaña, la pila
 * del WebView solo compite y confunde.
 */
export function sincronizarUrl(navegar: (url: string) => void) {
  const nid = useTabsStore.getState().activeNotaId();
  navegar(nid ? `/workspace?note=${nid}` : "/workspace");
}
