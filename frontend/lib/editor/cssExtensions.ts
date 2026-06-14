import {
  autocompletion,
  type Completion,
  type CompletionContext,
  type CompletionResult,
} from "@codemirror/autocomplete";
import { css, cssLanguage } from "@codemirror/lang-css";
import { type Diagnostic, linter, lintGutter } from "@codemirror/lint";
import type { Extension } from "@codemirror/state";
import { EditorView, lineNumbers } from "@codemirror/view";

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

/** Extensiones del editor de CSS: resaltado, autocompletado (CSS + --mic-*) y lint. */
export function cssEditorExtensions(): Extension {
  return [
    lineNumbers(),
    lintGutter(),
    css(),
    cssLanguage.data.of({ autocomplete: micVarCompletions }),
    autocompletion(),
    linter(cssLinter),
    EditorView.lineWrapping,
  ];
}
