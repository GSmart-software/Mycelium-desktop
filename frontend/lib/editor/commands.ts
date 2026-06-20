import { indentLess, indentMore } from "@codemirror/commands";
import { EditorSelection } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";

/**
 * Comandos de formato de la toolbar (HU-02 CA4/CA5):
 * con selección envuelve; sin selección inserta la sintaxis con el
 * cursor en el medio.
 */
export function wrapSelection(view: EditorView, marker: string, closing?: string) {
  const close = closing ?? marker;
  const { from, to } = view.state.selection.main;

  if (from === to) {
    view.dispatch({
      changes: { from, insert: `${marker}${close}` },
      selection: EditorSelection.cursor(from + marker.length),
    });
    return;
  }

  const selected = view.state.sliceDoc(from, to);
  view.dispatch({
    changes: { from, to, insert: `${marker}${selected}${close}` },
    selection: EditorSelection.range(from + marker.length, to + marker.length),
  });
}

/**
 * Inserta o reemplaza el prefijo # de la línea actual (HU-02 CA13):
 * H1 sobre "## Título" → "# Título".
 */
export function setHeading(view: EditorView, level: number) {
  const line = view.state.doc.lineAt(view.state.selection.main.head);
  const prefix = "#".repeat(level) + " ";
  const current = /^(#{1,6})\s+/.exec(line.text);

  if (current) {
    view.dispatch({
      changes: { from: line.from, to: line.from + current[0].length, insert: prefix },
    });
  } else {
    view.dispatch({ changes: { from: line.from, insert: prefix } });
  }
}

/** Prepende (o quita) un prefijo de línea: "- ", "1. ", "> ". */
export function toggleLinePrefix(view: EditorView, prefix: string) {
  const line = view.state.doc.lineAt(view.state.selection.main.head);
  if (line.text.startsWith(prefix)) {
    view.dispatch({
      changes: { from: line.from, to: line.from + prefix.length, insert: "" },
    });
  } else {
    view.dispatch({ changes: { from: line.from, insert: prefix } });
  }
}

/** Inserta un link markdown desde el popover (HU-02). */
export function insertLink(view: EditorView, text: string, url: string) {
  const { from, to } = view.state.selection.main;
  const label = text || "enlace";
  const markdown = `[${label}](${url})`;
  view.dispatch({
    changes: { from, to, insert: markdown },
    selection: EditorSelection.cursor(from + markdown.length),
  });
}

/** Aumenta la sangría de la(s) línea(s) seleccionada(s) — botón y Tab. */
export function indentLine(view: EditorView) {
  indentMore(view);
}

/** Disminuye la sangría de la(s) línea(s) seleccionada(s) — botón y Shift+Tab. */
export function outdentLine(view: EditorView) {
  indentLess(view);
}

/** Inserta `---` en una línea nueva (HU-02). */
export function insertHorizontalRule(view: EditorView) {
  const line = view.state.doc.lineAt(view.state.selection.main.head);
  const insert = line.length === 0 ? "---\n" : "\n---\n";
  view.dispatch({
    changes: { from: line.to, insert },
    selection: EditorSelection.cursor(line.to + insert.length),
  });
}
