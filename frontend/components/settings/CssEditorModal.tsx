"use client";

import { EditorState } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { cssEditorExtensions } from "@/lib/editor/cssExtensions";
import { renderMarkdown } from "@/lib/markdown";
import { useCssStore, type CssSnippet } from "@/stores/cssStore";
import styles from "./CssEditorModal.module.css";

const SAMPLE = `# Título de ejemplo

Texto con **negrita**, *cursiva*, ~~tachado~~ y \`código\` en línea.
Un enlace [externo](https://example.com) y un [[Wikilink]]. Un #tag.

## Subtítulo

> Una cita de ejemplo.

- Item de lista uno
- Item de lista dos
1. Lista numerada

\`\`\`js
function hola() {
  return "mundo";
}
\`\`\`

| Columna A | Columna B |
| --------- | --------- |
| uno       | dos       |

> [!note] Una nota
> cuerpo de la nota

> [!error] Atención
> algo salió mal
`;

/**
 * Editor de un snippet CSS a pantalla completa (HU-13): izquierda el CSS con
 * autocompletado/lint, centro un markdown de ejemplo editable y derecha su
 * preview. El CSS en edición se aplica en vivo a un <style> temporal; al
 * guardar persiste como contenido del snippet.
 */
export function CssEditorModal({ snippet, onClose }: { snippet: CssSnippet; onClose: () => void }) {
  const updateContent = useCssStore((s) => s.updateContent);
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const cssRef = useRef(snippet.contenido);
  const [sample, setSample] = useState(SAMPLE);
  const [saved, setSaved] = useState(false);
  const previewTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Aplica el CSS en edición a un <style> temporal (se quita al cerrar).
  const applyPreview = (cssText: string) => {
    let el = document.getElementById("mic-css-preview") as HTMLStyleElement | null;
    if (!el) {
      el = document.createElement("style");
      el.id = "mic-css-preview";
      document.head.appendChild(el);
    }
    el.textContent = cssText;
  };

  useEffect(() => {
    if (!hostRef.current || viewRef.current) return;
    applyPreview(snippet.contenido);
    viewRef.current = new EditorView({
      parent: hostRef.current,
      state: EditorState.create({
        doc: snippet.contenido,
        extensions: [
          history(),
          keymap.of([...defaultKeymap, ...historyKeymap]),
          cssEditorExtensions(),
          EditorView.updateListener.of((u) => {
            if (!u.docChanged) return;
            cssRef.current = u.state.doc.toString();
            if (previewTimer.current) clearTimeout(previewTimer.current);
            previewTimer.current = setTimeout(() => applyPreview(cssRef.current), 150);
          }),
        ],
      }),
    });
    return () => {
      if (previewTimer.current) clearTimeout(previewTimer.current);
      viewRef.current?.destroy();
      viewRef.current = null;
      document.getElementById("mic-css-preview")?.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const handleSave = async () => {
    await updateContent(snippet.id, cssRef.current);
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  };

  return (
    <div className={styles.overlay}>
      <div className={styles.modal} role="dialog" aria-modal="true" aria-label={`Editar ${snippet.nombre}`}>
        <header className={styles.header}>
          <span className={styles.title}>Editar: {snippet.nombre}</span>
          {saved && <span className={styles.saved}>Guardado</span>}
          <button type="button" className={styles.primaryBtn} onClick={() => void handleSave()}>
            Guardar
          </button>
          <button type="button" className={styles.close} aria-label="Cerrar" onClick={onClose}>
            <X size={18} aria-hidden />
          </button>
        </header>

        <div className={styles.body}>
          <section className={styles.col}>
            <span className={styles.colTitle}>CSS</span>
            <div ref={hostRef} className={styles.cssHost} />
          </section>
          <section className={styles.col}>
            <span className={styles.colTitle}>Markdown de ejemplo</span>
            <textarea
              className={styles.sample}
              value={sample}
              onChange={(e) => setSample(e.target.value)}
              spellCheck={false}
            />
          </section>
          <section className={styles.col}>
            <span className={styles.colTitle}>Vista previa</span>
            <div className={`mic-preview ${styles.preview}`}>
              <div dangerouslySetInnerHTML={{ __html: renderMarkdown(sample) }} />
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
