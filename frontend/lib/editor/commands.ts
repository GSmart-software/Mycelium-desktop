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

/**
 * Aplica al documento el texto `nuevo` con UNA transacción que cambia el rango
 * MÍNIMO que difiere (prefijo/sufijo comunes descartados). Lo usa el panel de
 * propiedades (`FUN-M-04`).
 *
 * Es deliberado que el panel NO escriba el archivo por su cuenta: si llamara a
 * `putContenido` mientras el editor tiene el documento montado, el siguiente
 * autoguardado del editor (debounce de 800 ms sobre SU estado) pisaría el
 * cambio, y el usuario no podría deshacerlo con Ctrl+Z. Despachando la
 * transacción, el flujo de guardado normal hace el resto, el undo es de una sola
 * acción y ni el scroll ni el cursor se mueven.
 */
export function aplicarTextoMinimo(view: EditorView, nuevo: string): void {
  const actual = view.state.doc.toString();
  if (actual === nuevo) return;

  let inicio = 0;
  const maximo = Math.min(actual.length, nuevo.length);
  while (inicio < maximo && actual[inicio] === nuevo[inicio]) inicio++;

  let finActual = actual.length;
  let finNuevo = nuevo.length;
  while (finActual > inicio && finNuevo > inicio && actual[finActual - 1] === nuevo[finNuevo - 1]) {
    finActual--;
    finNuevo--;
  }

  view.dispatch({
    changes: { from: inicio, to: finActual, insert: nuevo.slice(inicio, finNuevo) },
    // `userEvent` para que el editor marque la nota como editada (y fije la
    // pestaña de previsualización) igual que si se hubiera escrito a mano.
    userEvent: "input",
  });
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
