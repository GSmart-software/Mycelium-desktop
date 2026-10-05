import { tags } from "@lezer/highlight";
import {
  Autolink,
  Strikethrough,
  Table,
  type BlockContext,
  type LeafBlock,
  type LeafBlockParser,
  type MarkdownConfig,
} from "@lezer/markdown";
import type { EditorView } from "@codemirror/view";
import { MARCADOR_TAREA_RE, esMarcadorDeTarea } from "@/lib/estadosTarea";

/**
 * Listas de tareas con **cualquier símbolo** dentro de los corchetes
 * (`FUN-S-01`). El `TaskList` de `@lezer/markdown` solo reconoce `[ ]`, `[x]` y
 * `[X]` —lo que dice GFM—, así que `- [-] algo` llegaba a la vista en vivo como
 * texto y no había nodo `TaskMarker` que decorar. Esta extensión es la misma,
 * con la condición de `lib/estadosTarea.ts`: produce los mismos nodos (`Task`,
 * `TaskMarker`), así que el resto del editor no distingue.
 */
class ParserDeTarea implements LeafBlockParser {
  nextLine() {
    return false;
  }
  finish(cx: BlockContext, leaf: LeafBlock) {
    cx.addLeafElement(
      leaf,
      cx.elt("Task", leaf.start, leaf.start + leaf.content.length, [
        cx.elt("TaskMarker", leaf.start, leaf.start + 3),
        ...cx.parser.parseInline(leaf.content.slice(3), leaf.start + 3),
      ]),
    );
    return true;
  }
}

export const ListaDeTareas: MarkdownConfig = {
  defineNodes: [
    { name: "Task", block: true, style: tags.list },
    { name: "TaskMarker", style: tags.atom },
  ],
  parseBlock: [
    {
      name: "TaskList",
      leaf(cx, leaf) {
        return MARCADOR_TAREA_RE.test(leaf.content) && cx.parentType().name == "ListItem"
          ? new ParserDeTarea()
          : null;
      },
      after: "SetextHeading",
    },
  ],
};

/**
 * El `GFM` de `@lezer/markdown` con nuestra lista de tareas en lugar de la suya.
 * Es lo que reciben todos los editores de markdown (`NoteEditor`, el detalle de
 * un recordatorio): con el `GFM` original, los estados nuevos se ven como texto.
 */
export const GFM_MYCELIUM: MarkdownConfig[] = [Table, ListaDeTareas, Strikethrough, Autolink];

/**
 * Escribe `nuevo` como símbolo del marcador que empieza en `pos` (su `[`). No
 * hace nada si ahí ya no hay un marcador —el documento cambió desde que se
 * dibujó la casilla—, ni si el símbolo es el mismo.
 */
export function cambiarSimboloTarea(view: EditorView, pos: number, nuevo: string): boolean {
  const tres = view.state.sliceDoc(pos, pos + 3);
  if (!esMarcadorDeTarea(tres) || tres[1] === nuevo) return false;
  view.dispatch({ changes: { from: pos + 1, to: pos + 2, insert: nuevo }, userEvent: "input" });
  return true;
}
