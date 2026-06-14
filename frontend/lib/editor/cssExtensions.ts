import {
  autocompletion,
  type Completion,
  type CompletionContext,
  type CompletionResult,
} from "@codemirror/autocomplete";
import { css, cssLanguage } from "@codemirror/lang-css";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { type Diagnostic, linter, lintGutter } from "@codemirror/lint";
import { RangeSetBuilder, type Extension } from "@codemirror/state";
import { tags as t } from "@lezer/highlight";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  lineNumbers,
  ViewPlugin,
  type ViewUpdate,
  WidgetType,
} from "@codemirror/view";

/** Tokens --mic-* del tema, ofrecidos como autocompletado (HU-13). */
const MIC_TOKENS = [
  "--mic-bg-canvas",
  "--mic-bg-surface",
  "--mic-bg-sidebar",
  "--mic-bg-code",
  "--mic-bg-base",
  "--mic-bg-hover",
  "--mic-border",
  "--mic-text-primary",
  "--mic-text-muted",
  "--mic-accent",
  "--mic-glow",
  "--mic-radius-sm",
  "--mic-radius-md",
  "--mic-radius-lg",
  "--mic-editor-font-family",
  "--mic-editor-font-size",
  "--mic-preview-font-family",
  "--mic-preview-font-size",
  "--mic-font-sans",
  "--mic-font-serif",
  "--mic-font-mono",
  "--mic-callout-note-border",
  "--mic-callout-tip-border",
  "--mic-callout-important-border",
  "--mic-callout-warning-border",
  "--mic-callout-caution-border",
  "--mic-callout-info-border",
  "--mic-callout-success-border",
  "--mic-callout-error-border",
  "--mic-callout-danger-border",
  "--mic-callout-question-border",
];

const MIC_OPTIONS: Completion[] = MIC_TOKENS.map((t) => ({
  label: t,
  type: "variable",
  detail: "token Micelio",
}));

/** Sugiere los tokens --mic-* al escribir `--` o dentro de `var(`. */
function micVarCompletions(context: CompletionContext): CompletionResult | null {
  const dash = context.matchBefore(/--[\w-]*/);
  if (dash) return { from: dash.from, options: MIC_OPTIONS, validFor: /^--[\w-]*$/ };
  return null;
}

/** Lint mínimo: detecta llaves desbalanceadas sin romper la edición (HU-13 CA6). */
function cssLinter(view: EditorView): Diagnostic[] {
  const text = view.state.doc.toString();
  const diagnostics: Diagnostic[] = [];
  const stack: number[] = [];
  let inString: string | null = null;
  let inComment = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inComment) {
      if (ch === "*" && text[i + 1] === "/") {
        inComment = false;
        i++;
      }
      continue;
    }
    if (inString) {
      if (ch === inString && text[i - 1] !== "\\") inString = null;
      continue;
    }
    if (ch === "/" && text[i + 1] === "*") {
      inComment = true;
      i++;
    } else if (ch === '"' || ch === "'") {
      inString = ch;
    } else if (ch === "{") {
      stack.push(i);
    } else if (ch === "}") {
      if (stack.length === 0) {
        diagnostics.push({ from: i, to: i + 1, severity: "error", message: "« } » sin « { »." });
      } else {
        stack.pop();
      }
    }
  }
  for (const pos of stack) {
    diagnostics.push({ from: pos, to: pos + 1, severity: "error", message: "« { » sin cerrar." });
  }
  return diagnostics;
}

// ── Previsualización de colores en el editor (HU-13) ────────────────
/** Colores literales CSS: hex, rgb()/rgba(), hsl()/hsla(). */
const COLOR_RE =
  /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})\b|\b(?:rgba?|hsla?)\([^)]*\)/g;

/** Pequeño cuadro con el color, antes del valor. */
class SwatchWidget extends WidgetType {
  constructor(readonly color: string) {
    super();
  }
  eq(other: SwatchWidget) {
    return other.color === this.color;
  }
  toDOM() {
    const span = document.createElement("span");
    span.className = "mic-color-swatch";
    span.style.backgroundColor = this.color;
    return span;
  }
}

function buildSwatches(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  for (const { from, to } of view.visibleRanges) {
    const text = view.state.sliceDoc(from, to);
    for (const m of text.matchAll(COLOR_RE)) {
      const start = from + (m.index ?? 0);
      builder.add(
        start,
        start,
        Decoration.widget({ widget: new SwatchWidget(m[0]), side: -1 }),
      );
    }
  }
  return builder.finish();
}

const colorSwatches = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = buildSwatches(view);
    }
    update(u: ViewUpdate) {
      if (u.docChanged || u.viewportChanged) this.decorations = buildSwatches(u.view);
    }
  },
  { decorations: (v) => v.decorations },
);

// ── Resaltado de sintaxis CSS (colores por token) ───────────────────
// Los colores salen de tokens --mic-syntax-* (definidos por tema/modo en
// tokens.css), así la legibilidad funciona en claro y oscuro.
const cssHighlight = HighlightStyle.define([
  { tag: [t.comment, t.blockComment, t.lineComment], color: "var(--mic-syntax-comment)", fontStyle: "italic" },
  { tag: t.propertyName, color: "var(--mic-syntax-property)" },
  { tag: t.variableName, color: "var(--mic-syntax-variable)" },
  { tag: t.className, color: "var(--mic-syntax-class)" },
  { tag: t.constant(t.className), color: "var(--mic-syntax-pseudo)" },
  { tag: [t.labelName, t.attributeName], color: "var(--mic-syntax-id)" },
  { tag: t.tagName, color: "var(--mic-syntax-tag)" },
  { tag: t.string, color: "var(--mic-syntax-string)" },
  { tag: [t.number, t.unit], color: "var(--mic-syntax-number)" },
  { tag: t.atom, color: "var(--mic-syntax-value)" },
  { tag: t.color, color: "var(--mic-syntax-color)" },
  {
    tag: [t.definitionKeyword, t.keyword, t.modifier, t.operatorKeyword],
    color: "var(--mic-syntax-keyword)",
  },
]);

/** Extensiones del editor de CSS: resaltado, autocompletado (CSS + --mic-*),
 * lint y previsualización de colores. */
export function cssEditorExtensions(): Extension {
  return [
    lineNumbers(),
    lintGutter(),
    css(),
    syntaxHighlighting(cssHighlight),
    cssLanguage.data.of({ autocomplete: micVarCompletions }),
    autocompletion(),
    linter(cssLinter),
    colorSwatches,
    EditorView.lineWrapping,
  ];
}
