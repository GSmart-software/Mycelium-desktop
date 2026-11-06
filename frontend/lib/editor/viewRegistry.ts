import type { EditorView } from "@codemirror/view";

/** Registro de EditorViews por pane: lo usan la SearchBar del pane activo
 *  y el scroll sync del preview vinculado (HU-27). */
const views = new Map<string, EditorView>();
/** La nota de cada vista: las macros insertan texto solo cuando ya es la nota activa. */
const notas = new WeakMap<EditorView, string>();

export function registerView(paneId: string, view: EditorView, notaId?: string) {
  views.set(paneId, view);
  if (notaId) notas.set(view, notaId);
}

/** La nota que muestra una vista, si se registró con ella. */
export function notaDeVista(view: EditorView): string | undefined {
  return notas.get(view);
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
