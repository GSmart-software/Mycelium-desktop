import {
  HighlightStyle,
  syntaxHighlighting,
  syntaxTree,
} from "@codemirror/language";
import { RangeSetBuilder, type Extension } from "@codemirror/state";
import {
  Decoration,
  EditorView,
  ViewPlugin,
  ViewUpdate,
  WidgetType,
  type DecorationSet,
} from "@codemirror/view";
import { tags } from "@lezer/highlight";

/** Estilos inline del live preview (HU-01 CA6/CA7). */
const micelioHighlight = HighlightStyle.define([
  { tag: tags.strong, fontWeight: "700" },
  { tag: tags.emphasis, fontStyle: "italic" },
  { tag: tags.strikethrough, textDecoration: "line-through" },
  {
    tag: tags.monospace,
    fontFamily: "var(--mic-font-mono)",
    background: "var(--mic-bg-code)",
    color: "var(--mic-raw-mist)",
    borderRadius: "var(--mic-radius-sm)",
    padding: "0.05em 0.2em",
  },
  { tag: tags.heading, fontWeight: "700" },
  { tag: tags.quote, color: "var(--mic-text-muted)", fontStyle: "italic" },
  { tag: tags.link, color: "var(--mic-accent)" },
]);

/** Extensiones del modo `live`: highlight + decoraciones por línea. */
export function liveExtensions(onWikilinkClick: (title: string) => void): Extension {
  return [syntaxHighlighting(micelioHighlight), livePreview(onWikilinkClick)];
}

const WIKILINK_RE = /\[\[([^[\]]+)\]\]/g;
const TAG_RE = /(^|[\s(])#([\p{L}\p{N}_/-]+)/gu;
/** Cabecera de callout: `> [!tipo]` con símbolo de plegado opcional (-/+). */
const CALLOUT_HEAD_RE = /^(\s*>\s*)\[!(\w+)\]([-+]?)/;

/** Etiquetas por tipo, usadas como título cuando el callout no tiene uno. */
const CALLOUT_LABELS: Record<string, string> = {
  note: "Nota",
  tip: "Consejo",
  important: "Importante",
  warning: "Advertencia",
  caution: "Precaución",
  info: "Información",
  success: "Éxito",
  error: "Error",
  danger: "Peligro",
  question: "Pregunta",
};

const hide = Decoration.replace({});

/** Etiqueta del tipo que reemplaza al marcador cuando no hay título. */
class LabelWidget extends WidgetType {
  constructor(readonly label: string) {
    super();
  }
  eq(other: LabelWidget) {
    return other.label === this.label;
  }
  toDOM() {
    const span = document.createElement("span");
    span.className = "mic-callout-label";
    span.textContent = this.label;
    return span;
  }
}

/** Chevron clickeable para plegar/desplegar el callout (alterna -/+ en el doc). */
class FoldWidget extends WidgetType {
  constructor(
    readonly headFrom: number,
    readonly collapsed: boolean,
  ) {
    super();
  }
  eq(other: FoldWidget) {
    return other.headFrom === this.headFrom && other.collapsed === this.collapsed;
  }
  toDOM() {
    const span = document.createElement("span");
    span.className = "mic-callout-fold";
    span.dataset.head = String(this.headFrom);
    span.textContent = this.collapsed ? "▸" : "▾";
    return span;
  }
  ignoreEvent() {
    return false;
  }
}

/** Alterna el símbolo de plegado (-/+) de la cabecera de un callout. */
function toggleCalloutFold(view: EditorView, headFrom: number) {
  const line = view.state.doc.lineAt(headFrom);
  const match = /^(\s*>\s*\[!\w+\])([-+])/.exec(line.text);
  if (!match) return;
  const pos = line.from + match[1].length;
  view.dispatch({
    changes: { from: pos, to: pos + 1, insert: match[2] === "-" ? "+" : "-" },
  });
}

/**
 * Live preview por línea (HU-01): los marcadores markdown (#, **, ~~, `,
 * [[ ]]) se ocultan en todas las líneas excepto las que contienen el
 * cursor/selección — idéntico al Live Preview de Obsidian. El estilo del
 * texto (negrita, tamaño de heading, etc.) lo aplica syntaxHighlighting.
 */
export function livePreview(onWikilinkClick: (title: string) => void) {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;

      constructor(view: EditorView) {
        this.decorations = buildDecorations(view);
      }

      update(update: ViewUpdate) {
        if (update.docChanged || update.selectionSet || update.viewportChanged) {
          this.decorations = buildDecorations(update.view);
        }
      }
    },
    {
      decorations: (instance) => instance.decorations,
      eventHandlers: {
        mousedown(event, view) {
          const fold = (event.target as HTMLElement).closest(".mic-callout-fold");
          if (fold) {
            event.preventDefault();
            toggleCalloutFold(view, Number(fold.getAttribute("data-head")));
            return true;
          }
          const link = (event.target as HTMLElement).closest(".mic-wikilink-cm");
          if (link) {
            event.preventDefault();
            onWikilinkClick(link.getAttribute("data-title") ?? "");
            return true;
          }
          return false;
        },
      },
    },
  );
}

type PendingDeco = { from: number; to: number; deco: Decoration };

function buildDecorations(view: EditorView): DecorationSet {
  const decos: PendingDeco[] = [];
  const doc = view.state.doc;

  // Líneas "activas": las tocadas por el cursor o la selección (CA1/CA2)
  const activeLines = new Set<number>();
  for (const range of view.state.selection.ranges) {
    const fromLine = doc.lineAt(range.from).number;
    const toLine = doc.lineAt(range.to).number;
    for (let line = fromLine; line <= toLine; line++) activeLines.add(line);
  }

  for (const { from, to } of view.visibleRanges) {
    syntaxTree(view.state).iterate({
      from,
      to,
      enter(node) {
        const headingMatch = /^ATXHeading([1-6])$/.exec(node.name);
        if (headingMatch) {
          const line = doc.lineAt(node.from);
          decos.push({
            from: line.from,
            to: line.from,
            deco: Decoration.line({ class: `mic-live-h${headingMatch[1]}` }),
          });
          return;
        }

        switch (node.name) {
          case "HeaderMark": {
            const line = doc.lineAt(node.from);
            if (!activeLines.has(line.number)) {
              // Ocultar también el espacio que sigue a los #
              let end = node.to;
              if (end < doc.length && doc.sliceString(end, end + 1) === " ") end++;
              decos.push({ from: node.from, to: end, deco: hide });
            }
            break;
          }
          case "EmphasisMark":
          case "StrikethroughMark":
          case "CodeMark":
          case "LinkMark":
          case "URL": {
            const line = doc.lineAt(node.from);
            if (!activeLines.has(line.number)) {
              decos.push({ from: node.from, to: node.to, deco: hide });
            }
            break;
          }
          case "ListMark": {
            // Marcador de lista (- * + o 1.) coloreado, no se oculta (HU-01)
            decos.push({
              from: node.from,
              to: node.to,
              deco: Decoration.mark({ class: "mic-list-mark" }),
            });
            break;
          }
        }
      },
    });

    // [[wikilinks]], #tags, citas y callouts se detectan por línea.
    let pos = from;
    let calloutType: string | null = null; // tipo del callout en curso
    let calloutCollapsed = false; // si el callout actual está plegado (-)
    while (pos <= to) {
      const line = doc.lineAt(pos);
      const isActive = activeLines.has(line.number);
      const text = line.text;

      // Callouts (> [!tipo] …) y citas (>) — estilo en vivo (HU-03)
      const calloutStart = CALLOUT_HEAD_RE.exec(text);
      const quoteMark = /^\s*>\s?/.exec(text);
      if (calloutStart) {
        calloutType = calloutStart[2].toLowerCase();
        const symbol = calloutStart[3];
        calloutCollapsed = symbol === "-";
        const foldable = symbol === "-" || symbol === "+";
        decos.push({
          from: line.from,
          to: line.from,
          deco: Decoration.line({
            class: `mic-live-callout mic-live-callout-${calloutType} mic-live-callout-head`,
          }),
        });
        if (foldable) {
          decos.push({
            from: line.from,
            to: line.from,
            deco: Decoration.widget({
              widget: new FoldWidget(line.from, calloutCollapsed),
              side: -1,
            }),
          });
        }
        // Fuera de la línea activa, ocultar el marcador (> [!tipo] -/+) y dejar
        // solo el título; si no hay título, mostrar la etiqueta del tipo.
        if (!isActive) {
          const afterMarker = text.slice(calloutStart[0].length);
          const titulo = afterMarker.replace(/^[ \t]+/, "");
          const titleStartCol = calloutStart[0].length + (afterMarker.length - titulo.length);
          if (titulo.length > 0) {
            decos.push({ from: line.from, to: line.from + titleStartCol, deco: hide });
          } else {
            decos.push({
              from: line.from,
              to: line.to,
              deco: Decoration.replace({
                widget: new LabelWidget(CALLOUT_LABELS[calloutType] ?? calloutType),
              }),
            });
          }
        }
      } else if (calloutType && quoteMark) {
        // Cuerpo del callout: oculto si está plegado (-)
        const cls =
          `mic-live-callout mic-live-callout-${calloutType}` +
          (calloutCollapsed ? " mic-callout-hidden" : "");
        decos.push({
          from: line.from,
          to: line.from,
          deco: Decoration.line({ class: cls }),
        });
        // Ocultar el marcador de cita `>` del cuerpo fuera de la línea activa
        if (!isActive && !calloutCollapsed) {
          decos.push({ from: line.from, to: line.from + quoteMark[0].length, deco: hide });
        }
      } else if (quoteMark) {
        calloutType = null;
        decos.push({
          from: line.from,
          to: line.from,
          deco: Decoration.line({ class: "mic-live-quote" }),
        });
        if (!isActive) {
          decos.push({ from: line.from, to: line.from + quoteMark[0].length, deco: hide });
        }
      } else if (text.trim() !== "") {
        calloutType = null;
      }

      for (const match of line.text.matchAll(WIKILINK_RE)) {
        const start = line.from + match.index;
        const innerFrom = start + 2;
        const innerTo = innerFrom + match[1].length;
        if (!isActive) {
          decos.push({ from: start, to: innerFrom, deco: hide });
        }
        decos.push({
          from: innerFrom,
          to: innerTo,
          deco: Decoration.mark({
            class: "mic-wikilink-cm",
            attributes: { "data-title": match[1] },
          }),
        });
        if (!isActive) {
          decos.push({ from: innerTo, to: start + match[0].length, deco: hide });
        }
      }

      for (const match of line.text.matchAll(TAG_RE)) {
        const start = line.from + match.index + match[1].length;
        decos.push({
          from: start,
          to: start + match[2].length + 1,
          deco: Decoration.mark({ class: "mic-tag-cm" }),
        });
      }

      if (line.to >= to) break;
      pos = line.to + 1;
    }
  }

  decos.sort(
    (a, b) =>
      a.from - b.from ||
      a.deco.startSide - b.deco.startSide ||
      a.to - b.to,
  );

  const builder = new RangeSetBuilder<Decoration>();
  let lastFrom = -1;
  let lastTo = -1;
  for (const { from, to, deco } of decos) {
    // RangeSetBuilder exige orden estricto; saltear duplicados exactos
    if (from === lastFrom && to === lastTo && to !== from) continue;
    builder.add(from, to, deco);
    lastFrom = from;
    lastTo = to;
  }
  return builder.finish();
}
