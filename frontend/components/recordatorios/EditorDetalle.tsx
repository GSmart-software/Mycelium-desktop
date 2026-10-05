"use client";

import { autocompletion } from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { languages } from "@codemirror/language-data";
import { EditorState } from "@codemirror/state";
import { EditorView, keymap, placeholder } from "@codemirror/view";
import { GFM_MYCELIUM } from "@/lib/editor/tareas";
import { useEffect, useLayoutEffect, useRef } from "react";
import { liveExtensions } from "@/lib/editor/livePreview";
import { correctorOrtografico } from "@/lib/editor/ortografia";
import { usePreferencesStore } from "@/stores/preferencesStore";
import { wikilinkCompletions } from "@/lib/editor/wikilink";
import styles from "./Recordatorios.module.css";

/**
 * El detalle de un recordatorio se escribe con **el mismo editor** de las notas
 * —CodeMirror con el live preview de la app— pero **sin archivo** detrás
 * (§ 4.3): lo escrito vuelve por `onCambio` y el formulario lo guarda en el
 * JSON al confirmar.
 *
 * De la pila del editor de notas se toma lo que tiene sentido para un texto
 * suelto: el markdown con GFM, el live preview (que pinta los `[[enlaces]]` y
 * los marca rotos si la nota no existe), el autocompletado de enlaces y el
 * historial. Lo que depende de ser una nota —título en el documento, guardado,
 * colaboración, plegado, búsqueda— queda afuera.
 *
 * Tab **no** indenta: en un formulario, Tab tiene que llevar al campo siguiente.
 */
export function EditorDetalle({
  valorInicial,
  onCambio,
  abrirEnlace,
  existeNota,
  etiqueta,
}: {
  valorInicial: string;
  onCambio: (texto: string) => void;
  abrirEnlace: (titulo: string) => void;
  existeNota: (titulo: string) => boolean;
  etiqueta: string;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  // La vista se crea una sola vez: lo que cambia entre renders viaja por refs.
  const onCambioRef = useRef(onCambio);
  const abrirRef = useRef(abrirEnlace);
  const existeRef = useRef(existeNota);
  useLayoutEffect(() => {
    onCambioRef.current = onCambio;
    abrirRef.current = abrirEnlace;
    existeRef.current = existeNota;
  });

  useEffect(() => {
    if (!hostRef.current) return;
    const view = new EditorView({
      parent: hostRef.current,
      state: EditorState.create({
        doc: valorInicial,
        extensions: [
          history(),
          keymap.of([...defaultKeymap, ...historyKeymap]),
          markdown({ extensions: GFM_MYCELIUM, codeLanguages: languages }),
          autocompletion({ override: [wikilinkCompletions] }),
          EditorView.lineWrapping,
          EditorView.contentAttributes.of({ "aria-label": etiqueta }),
          // El mismo corrector que las notas (`FUN-L-12`).
          correctorOrtografico(() => usePreferencesStore.getState().prefs.correctorOrtografico),
          placeholder("Detalle en markdown. Podés enlazar notas con [[…]]"),
          liveExtensions(
            (titulo) => abrirRef.current(titulo),
            (titulo) => existeRef.current(titulo),
          ),
          EditorView.updateListener.of((u) => {
            if (u.docChanged) onCambioRef.current(u.state.doc.toString());
          }),
        ],
      }),
    });
    return () => view.destroy();
    // El valor inicial y la etiqueta solo importan al crear la vista.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <div ref={hostRef} className={`mic-editor-host ${styles.editorDetalle}`} />;
}
