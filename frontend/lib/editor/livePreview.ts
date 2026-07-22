import {
  HighlightStyle,
  syntaxHighlighting,
  syntaxTree,
} from "@codemirror/language";
import {
  type EditorState,
  RangeSetBuilder,
  StateEffect,
  StateField,
  type Extension,
} from "@codemirror/state";
import {
  Decoration,
  EditorView,
  ViewPlugin,
  ViewUpdate,
  WidgetType,
  type DecorationSet,
} from "@codemirror/view";
import { tags } from "@lezer/highlight";
import { renderMarkdown } from "@/lib/markdown";
import { renderExcalidrawInto } from "@/lib/excalidraw";
import { getAllViews } from "@/lib/editor/viewRegistry";
import { useUiStore } from "@/stores/uiStore";

/** Estilos inline del live preview (HU-01 CA6/CA7). */
const micelioHighlight = HighlightStyle.define([
  { tag: tags.strong, fontWeight: "700" },
  { tag: tags.emphasis, fontStyle: "italic" },
  {
    tag: tags.strikethrough,
    textDecoration: "line-through",
    color: "var(--mic-text-muted)",
  },
  {
    tag: tags.monospace,
    fontFamily: "var(--mic-font-mono)",
    background: "var(--mic-bg-code)",
    color: "var(--mic-text-primary)",
    borderRadius: "var(--mic-radius-sm)",
    padding: "0.05em 0.2em",
  },
  { tag: tags.heading, fontWeight: "700" },
  { tag: tags.quote, color: "var(--mic-text-muted)", fontStyle: "italic" },
  { tag: tags.link, color: "var(--mic-accent)" },
  // Tokens de código embebido en bloques cercados (HU-03), con la misma
  // paleta de sintaxis del editor de CSS (--mic-syntax-*).
  {
    tag: [tags.comment, tags.lineComment, tags.blockComment],
    color: "var(--mic-syntax-comment)",
    fontStyle: "italic",
  },
  { tag: [tags.keyword, tags.modifier, tags.controlKeyword, tags.definitionKeyword], color: "var(--mic-syntax-keyword)" },
  { tag: [tags.string, tags.special(tags.string)], color: "var(--mic-syntax-string)" },
  { tag: [tags.number, tags.bool, tags.atom], color: "var(--mic-syntax-number)" },
  { tag: [tags.function(tags.variableName), tags.function(tags.propertyName)], color: "var(--mic-syntax-keyword)" },
  { tag: [tags.variableName, tags.propertyName], color: "var(--mic-syntax-variable)" },
  { tag: [tags.typeName, tags.className, tags.namespace], color: "var(--mic-syntax-tag)" },
  { tag: [tags.operator, tags.punctuation, tags.separator], color: "var(--mic-text-muted)" },
]);

/** Efecto para forzar recálculo del live preview (p. ej. al togglear tablas). */
export const refreshLiveEffect = StateEffect.define<null>();

// Generación de los embeds excalidraw en vivo: aumenta en cada refresh para que
// los widgets se vuelvan a renderizar (su eq() la incluye) tras guardar un dibujo.
let liveGen = 0;

/** Redispara el live preview en todos los editores abiertos. */
export function refreshAllLiveViews() {
  liveGen++;
  for (const view of getAllViews()) {
    view.dispatch({ effects: refreshLiveEffect.of(null) });
  }
}

/** Widget de bloque que renderiza una tabla markdown como HTML (HU-01). */
class TableWidget extends WidgetType {
  constructor(readonly md: string) {
    super();
  }
  eq(other: TableWidget) {
    return other.md === this.md;
  }
  toDOM() {
    const wrap = document.createElement("div");
    wrap.className = "mic-preview mic-live-table";
    wrap.innerHTML = renderMarkdown(this.md);
    return wrap;
  }
  /**
   * Altura estimada del widget para el height-map de CodeMirror. Es CLAVE: sin
   * ella (por defecto -1 = desconocida) CM estima mal la altura de las tablas
   * FUERA de pantalla, y el height-map (que posiciona el gutter y el scroll del
   * buscador) diverge del contenido real medido, acumulando desfase cuanto más
   * contenido hay. Estimación: nº de filas (líneas con `|`) × alto de fila
   * (~36px: fuente 0.875rem·1.7 + padding + borde) + márgenes de tabla/widget.
   */
  get estimatedHeight() {
    const filas = this.md.split("\n").filter((l) => l.includes("|")).length;
    return Math.max(1, filas) * 36 + 26;
  }
  ignoreEvent() {
    return false;
  }
}

type TableState = { decorations: DecorationSet; ranges: [number, number][] };

/**
 * Calcula las tablas a renderizar como bloque. Las decoraciones de bloque DEBEN
 * venir de un StateField (un ViewPlugin rompe el layout de CodeMirror).
 */
function computeTables(state: EditorState): TableState {
  const builder = new RangeSetBuilder<Decoration>();
  const ranges: [number, number][] = [];
  if (!useUiStore.getState().liveTables) return { decorations: builder.finish(), ranges };

  const doc = state.doc;
  const active = new Set<number>();
  for (const r of state.selection.ranges) {
    const a = doc.lineAt(r.from).number;
    const b = doc.lineAt(r.to).number;
    for (let l = a; l <= b; l++) active.add(l);
  }

  syntaxTree(state).iterate({
    enter(node) {
      if (node.name !== "Table") return undefined;
      const startLine = doc.lineAt(node.from);
      const endLine = doc.lineAt(node.to);
      for (let l = startLine.number; l <= endLine.number; l++) {
        if (active.has(l)) return false; // cursor dentro → editar en crudo
      }
      const md = doc.sliceString(startLine.from, endLine.to);
      builder.add(
        startLine.from,
        endLine.to,
        Decoration.replace({ widget: new TableWidget(md), block: true }),
      );
      ranges.push([startLine.from, endLine.to]);
      return false;
    },
  });
  return { decorations: builder.finish(), ranges };
}

/** Tablas renderizadas (decoraciones de bloque) — vía StateField. */
const tableField = StateField.define<TableState>({
  create: (state) => computeTables(state),
  update(value, tr) {
    if (
      tr.docChanged ||
      tr.selection ||
      tr.effects.some((e) => e.is(refreshLiveEffect))
    ) {
      return computeTables(tr.state);
    }
    return value;
  },
  provide: (f) => EditorView.decorations.from(f, (v) => v.decorations),
});

/** Extensiones del modo `live`: highlight + tablas (block) + decoraciones inline. */
export function liveExtensions(
  onWikilinkClick: (title: string) => void,
  noteExists: (target: string) => boolean,
  notaId: string | null = null,
): Extension {
  return [
    syntaxHighlighting(micelioHighlight),
    tableField,
    livePreview(onWikilinkClick, noteExists, notaId),
  ];
}

const WIKILINK_RE = /\[\[([^[\]]+)\]\]/g;
/** Embed de un diagrama/archivo excalidraw: `![[ref.excalidraw]]`. */
const EXCALIDRAW_RE = /!\[\[([^[\]]+)\.excalidraw\]\]/g;
const TAG_RE = /(^|[\s(])#([\p{L}\p{N}_/-]+)/gu;
/** Cabecera de callout: `> [!tipo]` con símbolo de plegado opcional (-/+). */
const CALLOUT_HEAD_RE = /^(\s*>\s*)\[!([\w-]+)\]([-+]?)/;

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

/** Regla horizontal (--- *** ___): se dibuja como separador fuera de la línea activa. */
class HrWidget extends WidgetType {
  eq() {
    return true;
  }
  toDOM() {
    const hr = document.createElement("span");
    hr.className = "mic-live-hr";
    return hr;
  }
  ignoreEvent() {
    return false;
  }
}

/** Checkbox visual (no interactivo) de lista de tareas en la edición en vivo. */
class CheckboxWidget extends WidgetType {
  constructor(readonly checked: boolean) {
    super();
  }
  eq(other: CheckboxWidget) {
    return other.checked === this.checked;
  }
  toDOM() {
    const span = document.createElement("span");
    span.className = "mic-live-check" + (this.checked ? " mic-live-check-on" : "");
    return span;
  }
}

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
export function livePreview(
  onWikilinkClick: (title: string) => void,
  noteExists: (target: string) => boolean,
  notaId: string | null = null,
) {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;

      constructor(view: EditorView) {
        this.decorations = buildDecorations(view, noteExists, notaId);
      }

      update(update: ViewUpdate) {
        const refreshed = update.transactions.some((tr) =>
          tr.effects.some((e) => e.is(refreshLiveEffect)),
        );
        if (update.docChanged || update.selectionSet || update.viewportChanged || refreshed) {
          this.decorations = buildDecorations(update.view, noteExists, notaId);
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

/**
 * Widget de bloque que renderiza un embed de excalidraw (`![[ref.excalidraw]]`)
 * como el dibujo (SVG). Al hacer clic, coloca el cursor en la línea del embed
 * para que se muestre la fuente (se deja de renderizar), como el resto del live
 * preview. Solo aparece cuando el cursor NO está en esa línea.
 */
class ExcalidrawWidget extends WidgetType {
  constructor(
    readonly ref: string,
    readonly notaId: string | null,
    readonly pos: number,
    readonly gen: number,
  ) {
    super();
  }

  eq(other: ExcalidrawWidget) {
    return other.ref === this.ref && other.notaId === this.notaId && other.gen === this.gen;
  }

  toDOM(view: EditorView) {
    const block = document.createElement("div");
    block.className = "mic-live-excalidraw";
    block.addEventListener("mousedown", (event) => {
      // Clic → revelar la fuente: colocar el cursor en la línea del embed.
      event.preventDefault();
      view.dispatch({ selection: { anchor: this.pos } });
      view.focus();
    });
    void renderExcalidrawInto(block, this.ref, this.notaId);
    return block;
  }

  ignoreEvent() {
    return true; // dejamos que nuestro propio listener de mousedown gestione el clic
  }
}

type PendingDeco = { from: number; to: number; deco: Decoration };

function buildDecorations(
  view: EditorView,
  noteExists: (target: string) => boolean,
  notaId: string | null = null,
): DecorationSet {
  const decos: PendingDeco[] = [];
  const doc = view.state.doc;

  // ¿La línea siguiente sigue siendo parte del MISMO callout? Lo es si empieza
  // con `>` y no es la cabecera de un callout nuevo. Sirve para marcar la última
  // línea del callout (no se pueden envolver las líneas en un <div> en CodeMirror).
  const continuesCallout = (lineNumber: number): boolean => {
    if (lineNumber >= doc.lines) return false;
    const t = doc.line(lineNumber + 1).text;
    return /^\s*>/.test(t) && !CALLOUT_HEAD_RE.test(t);
  };

  // Líneas "activas": las tocadas por el cursor o la selección (CA1/CA2)
  const activeLines = new Set<number>();
  for (const range of view.state.selection.ranges) {
    const fromLine = doc.lineAt(range.from).number;
    const toLine = doc.lineAt(range.to).number;
    for (let line = fromLine; line <= toLine; line++) activeLines.add(line);
  }

  // Rangos de tablas renderizadas (las calcula tableField); se omiten aquí.
  const renderedTables = view.state.field(tableField, false)?.ranges ?? [];

  for (const { from, to } of view.visibleRanges) {
    syntaxTree(view.state).iterate({
      from,
      to,
      enter(node) {
        // Omitir cualquier nodo dentro de una tabla renderizada como bloque
        if (renderedTables.some(([f, t]) => node.from >= f && node.from < t)) {
          return false;
        }

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

        // Regla horizontal (--- *** ___): se muestra como separador cuando el
        // cursor no está en la línea; al entrar, se ve el texto crudo para editar.
        if (node.name === "HorizontalRule") {
          const line = doc.lineAt(node.from);
          if (!activeLines.has(line.number)) {
            decos.push({
              from: line.from,
              to: line.to,
              deco: Decoration.replace({ widget: new HrWidget() }),
            });
          }
          return false;
        }

        // Bloque de código cercado: fondo/estilo de bloque por línea (HU-03).
        if (node.name === "FencedCode" || node.name === "CodeBlock") {
          const first = doc.lineAt(node.from).number;
          const last = doc.lineAt(node.to).number;
          for (let n = first; n <= last; n++) {
            const ln = doc.line(n);
            const edge = n === first ? " mic-live-code-first" : n === last ? " mic-live-code-last" : "";
            decos.push({
              from: ln.from,
              to: ln.from,
              deco: Decoration.line({ class: `mic-live-code${edge}` }),
            });
          }
          return;
        }

        // Énfasis con `_` (estilo propio de Mycelium): _x_ cursiva + glow,
        // __x__ negrita + accent, ___x___ negrita sin cursiva + degradado. Los
        // de `*` usan el resaltado estándar (cursiva/negrita) y no se tocan.
        if (node.name === "Emphasis" || node.name === "StrongEmphasis") {
          const marks = node.node.getChildren("EmphasisMark");
          if (marks.length >= 2 && doc.sliceString(marks[0].from, marks[0].from + 1) === "_") {
            const line = doc.lineAt(node.from);
            const isActive = activeLines.has(line.number);
            const strong = node.name === "Emphasis" ? node.node.getChild("StrongEmphasis") : null;
            if (strong) {
              // ___texto___ → triple: ocultar todas las marcas y pintar el centro
              const im = strong.getChildren("EmphasisMark");
              const cFrom = im.length >= 2 ? im[0].to : strong.from;
              const cTo = im.length >= 2 ? im[im.length - 1].from : strong.to;
              if (!isActive) {
                decos.push({ from: node.from, to: cFrom, deco: hide });
                decos.push({ from: cTo, to: node.to, deco: hide });
              }
              if (cFrom < cTo) {
                decos.push({ from: cFrom, to: cTo, deco: Decoration.mark({ class: "mic-em-cm-tri" }) });
              }
              return false; // ya gestionamos marcas y contenido
            }
            const cFrom = marks[0].to;
            const cTo = marks[marks.length - 1].from;
            if (cFrom < cTo) {
              decos.push({
                from: cFrom,
                to: cTo,
                deco: Decoration.mark({
                  class: node.name === "Emphasis" ? "mic-em-cm-us" : "mic-strong-cm-us",
                }),
              });
            }
            // sin return: el caso EmphasisMark oculta las marcas fuera de foco
          }
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
          case "CodeMark": {
            // Fences de bloque (```) permanecen visibles; los backticks inline
            // se ocultan fuera de la línea activa.
            const parent = node.node.parent?.name;
            if (parent === "FencedCode" || parent === "CodeBlock") break;
            const line = doc.lineAt(node.from);
            if (!activeLines.has(line.number)) {
              decos.push({ from: node.from, to: node.to, deco: hide });
            }
            break;
          }
          case "EmphasisMark":
          case "StrikethroughMark":
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
          case "TaskMarker": {
            // `[ ]`/`[x]` → checkbox visual fuera de la línea activa; al entrar
            // el cursor se ve el texto crudo para editarlo.
            const line = doc.lineAt(node.from);
            if (!activeLines.has(line.number)) {
              const checked = /\[[xX]\]/.test(doc.sliceString(node.from, node.to));
              decos.push({
                from: node.from,
                to: node.to,
                deco: Decoration.replace({ widget: new CheckboxWidget(checked) }),
              });
            }
            break;
          }
        }
      },
    });

    // [[wikilinks]], #tags, citas y callouts se detectan por línea.
    let pos = from;
    let calloutType: string | null = null; // tipo del callout en curso
    let calloutCollapsed = false; // si el callout actual está plegado (-)
    let firstBodyPending = false; // la próxima línea de cuerpo es la 1ª del contenido
    while (pos <= to) {
      const line = doc.lineAt(pos);

      // Saltar líneas que quedaron dentro de una tabla renderizada
      if (renderedTables.some(([f, t]) => line.from >= f && line.from <= t)) {
        if (line.to >= to) break;
        pos = line.to + 1;
        continue;
      }

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
        // Ganchos por línea para CSS (no se puede englobar el callout en un div):
        // -first/-last delimitan el bloque; -foldable/-collapsed dan el estado del
        // plegado en la cabecera. Plegado → la cabecera es también la última visible.
        let headClass = "mic-live-callout mic-live-callout-head mic-live-callout-first";
        if (foldable) headClass += " mic-live-callout-foldable";
        if (calloutCollapsed) headClass += " mic-live-callout-collapsed";
        if (calloutCollapsed || !continuesCallout(line.number)) headClass += " mic-live-callout-last";
        firstBodyPending = true; // la siguiente línea `>` será la 1ª del contenido
        decos.push({
          from: line.from,
          to: line.from,
          // El estilo lo decide data-callout + variables CSS (no la clase por tipo).
          deco: Decoration.line({
            class: headClass,
            attributes: { "data-callout": calloutType },
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
        // Cuerpo del callout. Ganchos: -body siempre; -body-first en la 1ª línea
        // de contenido; -last en la última; -callout-hidden si está plegado. Así
        // se pueden estilar distinto la primera, las intermedias y la última.
        let cls = "mic-live-callout mic-live-callout-body";
        if (firstBodyPending) cls += " mic-live-callout-body-first";
        firstBodyPending = false;
        if (calloutCollapsed) cls += " mic-callout-hidden";
        if (!continuesCallout(line.number)) cls += " mic-live-callout-last";
        decos.push({
          from: line.from,
          to: line.from,
          deco: Decoration.line({ class: cls, attributes: { "data-callout": calloutType } }),
        });
        // Ocultar el marcador de cita `>` del cuerpo fuera de la línea activa
        if (!isActive && !calloutCollapsed) {
          decos.push({ from: line.from, to: line.from + quoteMark[0].length, deco: hide });
        }
      } else if (quoteMark) {
        calloutType = null;
        firstBodyPending = false;
        decos.push({
          from: line.from,
          to: line.from,
          deco: Decoration.line({ class: "mic-live-quote" }),
        });
        if (!isActive) {
          decos.push({ from: line.from, to: line.from + quoteMark[0].length, deco: hide });
        }
      } else {
        // Cualquier otra línea (incluida una EN BLANCO) cierra el callout/cita en
        // curso: en markdown una línea vacía termina el blockquote. Sin resetear
        // aquí, un `>` posterior separado por una línea en blanco heredaba el
        // estilo del callout previo (DEF-021). Para continuar un callout tras un
        // párrafo se usa una línea `>` vacía (que sí lleva quoteMark y no llega aquí).
        calloutType = null;
        firstBodyPending = false;
      }

      // Embeds de excalidraw (`![[ref.excalidraw]]`): se renderizan como bloque
      // cuando ocupan toda la línea y el cursor no está en ella. Sus rangos se
      // excluyen del paso de wikilinks (el `[[…]]` interno no debe estilarse).
      const exRanges: [number, number][] = [];
      for (const match of line.text.matchAll(EXCALIDRAW_RE)) {
        const mFrom = line.from + match.index;
        exRanges.push([mFrom, mFrom + match[0].length]);
        if (!isActive && text.trim() === match[0]) {
          decos.push({
            from: line.from,
            to: line.to,
            deco: Decoration.replace({
              widget: new ExcalidrawWidget(match[1], notaId, line.from, liveGen),
            }),
          });
        }
      }

      for (const match of line.text.matchAll(WIKILINK_RE)) {
        const start = line.from + match.index;
        if (exRanges.some(([f, t]) => start >= f && start < t)) continue;
        const innerFrom = start + 2;
        const innerTo = innerFrom + match[1].length;
        // [[destino|alias]]: el destino navega, el alias es lo visible.
        const pipe = match[1].indexOf("|");
        const target = (pipe === -1 ? match[1] : match[1].slice(0, pipe)).trim();
        // Tramo que se muestra estilizado (alias si lo hay; si no, el destino).
        const labelFrom = pipe === -1 ? innerFrom : innerFrom + pipe + 1;
        if (!isActive) {
          // Oculta `[[` y, si hay alias, también `destino|`.
          decos.push({ from: start, to: labelFrom, deco: hide });
        }
        // Feedback de inexistencia: mismo color, más oscuro (CA8 mejora).
        const missing = !noteExists(target);
        decos.push({
          from: labelFrom,
          to: innerTo,
          deco: Decoration.mark({
            class: missing ? "mic-wikilink-cm mic-wikilink-cm-missing" : "mic-wikilink-cm",
            attributes: { "data-title": target },
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
