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

const hide = Decoration.replace({});

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
        mousedown(event) {
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
        }
      },
    });

    // [[wikilinks]] y #tags no existen en el árbol lezer: se detectan por línea
    let pos = from;
    while (pos <= to) {
      const line = doc.lineAt(pos);
      const isActive = activeLines.has(line.number);

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
