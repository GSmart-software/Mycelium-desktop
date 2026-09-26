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
