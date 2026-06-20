import { StateEffect, StateField } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, WidgetType } from "@codemirror/view";

/**
 * Título = nombre del archivo renderizado DENTRO del documento, como un bloque
 * al inicio (se desplaza con el contenido, no es fijo). No forma parte del texto
 * markdown: es un widget decorativo. El color es un degradado glow→accent y la
 * tipografía es la del editor (la vista de lectura usa la suya propia).
 */
export const setDocTitle = StateEffect.define<{ title: string; show: boolean }>();

class TitleWidget extends WidgetType {
  constructor(readonly title: string) {
    super();
  }
  eq(other: TitleWidget) {
    return other.title === this.title;
  }
  toDOM() {
    const el = document.createElement("div");
    el.className = "mic-doc-title mic-doc-title-editor";
    el.textContent = this.title;
    el.setAttribute("aria-hidden", "true");
    return el;
  }
  ignoreEvent() {
    return true;
  }
}

function buildDeco(title: string, show: boolean): DecorationSet {
  if (!show || !title) return Decoration.none;
  return Decoration.set([
    Decoration.widget({ widget: new TitleWidget(title), side: -1, block: true }).range(0),
  ]);
}

export const docTitleField = StateField.define<DecorationSet>({
  create() {
    return Decoration.none;
  },
  update(deco, tr) {
    for (const e of tr.effects) {
      if (e.is(setDocTitle)) return buildDeco(e.value.title, e.value.show);
    }
    return deco.map(tr.changes); // el bloque vive en la posición 0 (se conserva)
  },
  provide: (f) => EditorView.decorations.from(f),
});
