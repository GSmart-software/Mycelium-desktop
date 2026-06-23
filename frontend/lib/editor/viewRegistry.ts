import type { EditorView } from "@codemirror/view";

/** Registro de EditorViews por pane: lo usan la SearchBar del pane activo
 *  y el scroll sync del preview vinculado (HU-27). */
const views = new Map<string, EditorView>();

export function registerView(paneId: string, view: EditorView) {
  views.set(paneId, view);
}

export function unregisterView(paneId: string, view: EditorView) {
  if (views.get(paneId) === view) views.delete(paneId);
}

export function getView(paneId: string): EditorView | null {
  return views.get(paneId) ?? null;
}

export function getAllViews(): EditorView[] {
  return [...views.values()];
}

/**
 * Inserta texto en el editor CodeMirror que esté bajo las coordenadas de
 * pantalla dadas, en la posición exacta del cursor de soltado (drag & drop de
 * un archivo del explorador a un markdown abierto). Devuelve true si insertó.
 */
export function insertRefAtPoint(clientX: number, clientY: number, text: string): boolean {
  const el = document.elementFromPoint(clientX, clientY) as HTMLElement | null;
  const cm = el?.closest(".cm-editor");
  if (!cm) return false;
  let view: EditorView | undefined;
  for (const v of views.values()) {
    if (v.dom === cm || v.dom.contains(cm)) {
      view = v;
      break;
    }
  }
  if (!view) return false;
  const pos = view.posAtCoords({ x: clientX, y: clientY }) ?? view.state.selection.main.head;
  view.dispatch({
    changes: { from: pos, insert: text },
    selection: { anchor: pos + text.length },
  });
  view.focus();
  return true;
}
