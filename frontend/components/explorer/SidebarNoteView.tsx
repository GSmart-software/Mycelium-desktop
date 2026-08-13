"use client";

import { Eye, Pencil } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { BaseView } from "@/components/bases/BaseView";
import { CanvasView } from "@/components/canvas/CanvasView";
import { ExcalidrawFileEditor } from "@/components/editor/ExcalidrawFileEditor";
import { NoteEditor } from "@/components/editor/NoteEditor";
import { GraphView } from "@/components/graph/GraphView";
import { TerminalView } from "@/components/terminal/TerminalView";
import { esTabTerminal, termIdDe } from "@/lib/terminal";
import { useTerminalStore } from "@/stores/terminalStore";
import { subscribeDoc } from "@/lib/editor/docBroker";
import { renderExcalidrawIn } from "@/lib/excalidraw";
import { fetchNoteContent } from "@/lib/export";
import { renderNota } from "@/lib/markdown";
import { renderMermaidIn } from "@/lib/mermaid";
import { useSidebarViewerStore } from "@/stores/sidebarViewerStore";
import { GRAPH_TAB_ID } from "@/stores/tabsStore";
import { useVaultStore } from "@/stores/vaultStore";
import styles from "../workspace/SidebarDock.module.css";

/**
 * Documento anclado en el explorador (DEF-023 P3): solo lectura por defecto, con
 * botón para alternar a edición (monta el `NoteEditor`). Los `.excalidraw` siempre
 * usan su editor (única forma de verlos).
 */
export function SidebarNoteView({ notaId }: { notaId: string }) {
  const nota = useVaultStore((s) => s.notas.find((n) => n.id === notaId) ?? null);
  const editing = useSidebarViewerStore((s) => !!s.editing[notaId]);
  const toggleEdit = useSidebarViewerStore((s) => s.toggleEdit);
  const tituloTerminal = useTerminalStore((s) =>
    esTabTerminal(notaId) ? s.sesiones[termIdDe(notaId)]?.titulo ?? "Terminal" : null,
  );
  const esExcalidraw = nota?.tipo === "excalidraw";
  // Una base anclada muestra su tabla, no el YAML crudo dentro del editor de
  // markdown: allá tendría vista en vivo, wikilinks y autoguardado, que no le
  // corresponden. Su propio botón «Fuente» ya deja editarla (`FUN-L-03`).
  const esBase = nota?.tipo === "base";
  const esCanvas = nota?.tipo === "canvas";

  // Una consola también se puede anclar en el visor (FUN-L-07): se muestra la
  // TerminalView real (misma sesión), no un render de nota.
  if (esTabTerminal(notaId)) {
    return (
      <div className={styles.viewer}>
        <div className={styles.viewerHeader}>
          <span className={styles.viewerTitle}>{tituloTerminal}</span>
        </div>
        <div className={styles.viewerGraph}>
          <TerminalView termId={termIdDe(notaId)} />
        </div>
      </div>
    );
  }

  // El grafo de conexiones también se puede anclar (no es una nota editable).
  if (notaId === GRAPH_TAB_ID) {
    return (
      <div className={styles.viewer}>
        <div className={styles.viewerHeader}>
          <span className={styles.viewerTitle}>Grafo de conexiones</span>
        </div>
        <div className={styles.viewerGraph}>
          <GraphView />
        </div>
      </div>
    );
  }

  return (
    <div className={styles.viewer}>
      <div className={styles.viewerHeader}>
        <span className={styles.viewerTitle} title={nota?.titulo}>
          {nota?.titulo ?? "…"}
        </span>
        {!esExcalidraw && !esBase && !esCanvas && (
          <button
            type="button"
            className={styles.viewerToggle}
            onClick={() => toggleEdit(notaId)}
            title={editing ? "Ver (solo lectura)" : "Editar"}
          >
            {editing ? <Eye size={14} aria-hidden /> : <Pencil size={14} aria-hidden />}
            {editing ? "Ver" : "Editar"}
          </button>
        )}
      </div>
      <div className={styles.viewerBody}>
        {esExcalidraw ? (
          <ExcalidrawFileEditor key={notaId} notaId={notaId} />
        ) : esBase ? (
          <BaseView key={notaId} notaId={notaId} />
        ) : esCanvas ? (
          <CanvasView key={notaId} notaId={notaId} />
        ) : editing ? (
          <NoteEditor
            key={`edit-${notaId}`}
            notaId={notaId}
            instanceId={`sidebar-${notaId}`}
            paneId="sidebar"
          />
        ) : (
          <ReadOnlyNote notaId={notaId} />
        )}
      </div>
    </div>
  );
}

/** Render de solo lectura de una nota markdown (patrón de `LinkedPreviewPane`). */
function ReadOnlyNote({ notaId }: { notaId: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [html, setHtml] = useState("");

  useEffect(() => {
    let vigente = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    // Carga inicial (backend/db, con caché offline como respaldo).
    void fetchNoteContent(notaId)
      .then((content) => {
        if (vigente) setHtml(renderNota(content));
      })
      .catch(() => {
        /* nota inaccesible: se deja vacío */
      });
    // Actualización en vivo si el documento se edita en otra vista.
    const unsubscribe = subscribeDoc(notaId, `sidebar-read-${notaId}`, (content) => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => setHtml(renderNota(content)), 130);
    });
    return () => {
      vigente = false;
      if (timer) clearTimeout(timer);
      unsubscribe();
    };
  }, [notaId]);

  // Diagramas Mermaid y Excalidraw embebidos (solo lectura).
  useEffect(() => {
    if (containerRef.current) {
      void renderMermaidIn(containerRef.current);
      void renderExcalidrawIn(containerRef.current, notaId);
    }
  }, [html, notaId]);

  return (
    <div ref={containerRef} className="mic-preview mic-layout-read">
      <div dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  );
}
