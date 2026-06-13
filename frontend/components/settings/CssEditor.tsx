"use client";

import { css } from "@codemirror/lang-css";
import { type Diagnostic, linter, lintGutter } from "@codemirror/lint";
import { EditorState } from "@codemirror/state";
import { EditorView, lineNumbers } from "@codemirror/view";
import { useEffect, useRef } from "react";
import styles from "./CssEditor.module.css";

/**
 * Linter de CSS muy básico (HU-13 CA6): detecta llaves desbalanceadas y marca
 * la línea conflictiva. No pretende validar todo el CSS, solo evitar romper la
 * UI y dar feedback sobre el error más común al escribir a mano.
 */
function cssLinter(view: EditorView): Diagnostic[] {
  const text = view.state.doc.toString();
  const diagnostics: Diagnostic[] = [];
  const stack: number[] = [];
  let inString: string | null = null;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (ch === inString && text[i - 1] !== "\\") inString = null;
      continue;
    }
    if (ch === '"' || ch === "'") inString = ch;
    else if (ch === "{") stack.push(i);
    else if (ch === "}") {
      if (stack.length === 0) {
        diagnostics.push({
          from: i,
          to: i + 1,
          severity: "error",
          message: "« } » sin « { » correspondiente.",
        });
      } else {
        stack.pop();
      }
    }
  }
  for (const pos of stack) {
    diagnostics.push({
      from: pos,
      to: pos + 1,
      severity: "error",
      message: "« { » sin cerrar.",
    });
  }
  return diagnostics;
}

/** Editor de código para el CSS personalizado (HU-13 CA1/CA2/CA6). */
export function CssEditor({
  value,
  onChange,
}: {
  value: string;
  onChange: (css: string) => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    if (!hostRef.current || viewRef.current) return;
    viewRef.current = new EditorView({
      parent: hostRef.current,
      state: EditorState.create({
        doc: value,
        extensions: [
          lineNumbers(),
          lintGutter(),
          css(),
          linter(cssLinter),
          EditorView.lineWrapping,
          EditorView.updateListener.of((u) => {
            if (u.docChanged) onChangeRef.current(u.state.doc.toString());
          }),
        ],
      }),
    });
    return () => {
      viewRef.current?.destroy();
      viewRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sincroniza cambios externos (p. ej. importar un .css) sin perder el cursor.
  useEffect(() => {
    const view = viewRef.current;
    if (view && value !== view.state.doc.toString()) {
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: value },
      });
    }
  }, [value]);

  return <div ref={hostRef} className={styles.editor} />;
}
