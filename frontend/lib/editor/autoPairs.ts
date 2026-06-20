import { EditorSelection, type Extension, Prec } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";

/**
 * Autocierre de pares con envoltura de la selección (estilo Obsidian/VSCode).
 *
 * - Al escribir un símbolo de apertura con el cursor (sin selección) se inserta
 *   también el de cierre y el cursor queda en el medio: `(` → `(|)`.
 * - Con texto seleccionado NO se reemplaza: se envuelve la selección con el
 *   símbolo de apertura al inicio y el de cierre al final: `texto` → `(texto)`.
 * - Para los pares de mismo carácter (`"`, `'`, `` ` ``, `*`, `_`) y los cierres
 *   de bracket (`)`, `]`, `}`) se permite "escribir encima" del cierre ya
 *   insertado, así escribir `*texto*` o `**negrita**` produce el resultado
 *   esperado sin caracteres de más.
 * - Backspace sobre un par vacío (`(|)`) borra ambos símbolos.
 *
 * `isEnabled` se consulta en cada pulsación, de modo que la opción de las
 * preferencias (autocerrar pares) activa/desactiva el comportamiento en vivo
 * sin recrear el editor.
 */
const PAIRS: Record<string, string> = {
  "(": ")",
  "[": "]",
  "{": "}",
  '"': '"',
  "'": "'",
  "`": "`",
  "*": "*",
  "_": "_",
};
const CLOSERS = new Set([")", "]", "}"]);
const SAME = new Set(['"', "'", "`", "*", "_"]);

export function autoPairs(isEnabled: () => boolean): Extension {
  const handler = EditorView.inputHandler.of((view, _from, _to, text) => {
    if (!isEnabled() || text.length !== 1) return false;
    const ch = text;
    const state = view.state;
    const ranges = state.selection.ranges;
    const charAfter = (pos: number) =>
      pos < state.doc.length ? state.doc.sliceString(pos, pos + 1) : "";

    // Escribir encima del cierre de un bracket: )]} sobre un carácter idéntico.
    if (CLOSERS.has(ch)) {
      if (ranges.every((r) => r.empty && charAfter(r.head) === ch)) {
        view.dispatch(
          state.changeByRange((r) => ({ range: EditorSelection.cursor(r.head + 1) })),
          { userEvent: "move" },
        );
        return true;
      }
      return false;
    }

    // Pares de mismo carácter: escribir encima del cierre autoinsertado.
    if (SAME.has(ch) && ranges.every((r) => r.empty && charAfter(r.head) === ch)) {
      view.dispatch(
        state.changeByRange((r) => ({ range: EditorSelection.cursor(r.head + 1) })),
        { userEvent: "move" },
      );
      return true;
    }

    // Apertura: envolver la selección o autocerrar con el cursor en el medio.
    const close = PAIRS[ch];
    if (!close) return false;
    view.dispatch(
      state.changeByRange((r) =>
        r.empty
          ? {
              changes: { from: r.from, insert: ch + close },
              range: EditorSelection.cursor(r.from + ch.length),
            }
          : {
              changes: [
                { from: r.from, insert: ch },
                { from: r.to, insert: close },
              ],
              range: EditorSelection.range(r.from + ch.length, r.to + ch.length),
            },
      ),
      { userEvent: "input.type", scrollIntoView: true },
    );
    return true;
  });

  // Backspace borra el par vacío completo (`(|)` → ``). Prec.highest para
  // ganarle al Backspace por defecto del keymap base.
  const backspace = Prec.highest(
    keymap.of([
      {
        key: "Backspace",
        run: (view) => {
          if (!isEnabled()) return false;
          const state = view.state;
          const ranges = state.selection.ranges;
          const canDeletePair = ranges.every((r) => {
            if (!r.empty || r.from === 0 || r.from >= state.doc.length) return false;
            const before = state.doc.sliceString(r.from - 1, r.from);
            const after = state.doc.sliceString(r.from, r.from + 1);
            return PAIRS[before] === after;
          });
          if (!canDeletePair) return false;
          view.dispatch(
            state.changeByRange((r) => ({
              changes: { from: r.from - 1, to: r.from + 1 },
              range: EditorSelection.cursor(r.from - 1),
            })),
            { userEvent: "delete.backward" },
          );
          return true;
        },
      },
    ]),
  );

  return [handler, backspace];
}
