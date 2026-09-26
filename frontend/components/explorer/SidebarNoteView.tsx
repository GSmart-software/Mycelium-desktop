"use client";

import dynamic from "next/dynamic";
import { Eye, Pencil } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { BaseView } from "@/components/bases/BaseView";
import { CanvasView } from "@/components/canvas/CanvasView";
import { DrawioView } from "@/components/drawio/DrawioView";
import { ExcalidrawFileEditor } from "@/components/editor/ExcalidrawFileEditor";
import { NoteEditor } from "@/components/editor/NoteEditor";
import { RelinkView } from "@/components/enlaces/RelinkView";
import { GraphView } from "@/components/graph/GraphView";
import { CalendarioPanel } from "@/components/recordatorios/CalendarioPanel";
import { VisorArchivo } from "@/components/visor/VisorArchivo";
import { nombreDeRuta, rutaDeTabArchivo } from "@/lib/otrosArchivos";
import { PESTANA_SENTINELA, tipoDePestana } from "@/lib/pestanas";
import { termIdDe } from "@/lib/terminalBase";
import { useTerminalStore } from "@/stores/terminalStore";
import { subscribeDoc } from "@/lib/editor/docBroker";
import { renderDrawioIn } from "@/lib/drawioRender";
import { renderExcalidrawIn } from "@/lib/excalidraw";
import { fetchNoteContent } from "@/lib/export";
import { renderNota } from "@/lib/markdown";
import { renderMermaidIn } from "@/lib/mermaid";
import { useSidebarViewerStore } from "@/stores/sidebarViewerStore";
import { useVaultStore } from "@/stores/vaultStore";
import styles from "../workspace/SidebarDock.module.css";

// La consola se carga cuando se muestra una: TerminalView trae xterm, y este
// componente está siempre montado (ver lib/terminalBase.ts).
const TerminalView = dynamic(
  async () => (await import("@/components/terminal/TerminalView")).TerminalView,
  { ssr: false },
);

/**
 * Documento anclado en el explorador (DEF-023 P3): solo lectura por defecto, con
 * botón para alternar a edición (monta el `NoteEditor`). Los `.excalidraw` siempre
 * usan su editor (única forma de verlos).
 */
export function SidebarNoteView({ notaId }: { notaId: string }) {
  const nota = useVaultStore((s) => s.notas.find((n) => n.id === notaId) ?? null);
  const editing = useSidebarViewerStore((s) => !!s.editing[notaId]);
  const toggleEdit = useSidebarViewerStore((s) => s.toggleEdit);
  // Qué es lo anclado (`lib/pestanas.ts`): los sentinela tienen su propia vista;
  // lo demás es una nota del vault.
  const pestana = tipoDePestana(notaId);
  const tituloTerminal = useTerminalStore((s) =>
    pestana === "terminal"
      ? s.sesiones[termIdDe(notaId)]?.titulo ?? PESTANA_SENTINELA.terminal.titulo
      : null,
  );
  const esExcalidraw = nota?.tipo === "excalidraw";
  // Una base anclada muestra su tabla, no el YAML crudo dentro del editor de
  // markdown: allá tendría vista en vivo, wikilinks y autoguardado, que no le
  // corresponden. Su propio botón «Fuente» ya deja editarla (`FUN-L-03`).
  const esBase = nota?.tipo === "base";
  const esCanvas = nota?.tipo === "canvas";
  const esDrawio = nota?.tipo === "drawio";

  // Una consola también se puede anclar en el visor (FUN-L-07): se muestra la
  // TerminalView real (misma sesión), no un render de nota.
  if (pestana === "terminal") {
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

  // Un archivo que Mycelium no indexa (FUN-L-11) también se puede anclar: se
  // muestra su visor, que ya es de solo lectura, sin el botón de editar.
  if (pestana === "archivo") {
    const ruta = rutaDeTabArchivo(notaId);
    return (
      <div className={styles.viewer}>
        <div className={styles.viewerHeader}>
          <span className={styles.viewerTitle}>{nombreDeRuta(ruta)}</span>
        </div>
        <div className={styles.viewerGraph}>
          <VisorArchivo ruta={ruta} isActivePane={false} />
        </div>
      </div>
    );
  }

  // El grafo de conexiones también se puede anclar (no es una nota editable).
  if (pestana === "grafo") {
    return (
      <div className={styles.viewer}>
        <div className={styles.viewerHeader}>
          <span className={styles.viewerTitle}>{PESTANA_SENTINELA.grafo.titulo}</span>
        </div>
        <div className={styles.viewerGraph}>
          <GraphView />
        </div>
      </div>
    );
  }

  // Las referencias del vault (`FUN-L-17`) también. Hasta la auditoría del
  // 2026-09-26 este visor no las contemplaba: anclarlas caía en la rama de nota
  // y mostraba «…» con un editor vacío.
  if (pestana === "enlaces") {
    return (
      <div className={styles.viewer}>
        <div className={styles.viewerHeader}>
          <span className={styles.viewerTitle}>{PESTANA_SENTINELA.enlaces.titulo}</span>
        </div>
        <div className={styles.viewerGraph}>
          <RelinkView />
        </div>
      </div>
    );
  }

  // El calendario anclado en el costado (`FUN-L-22`) usa su vista compacta: la
  // grilla del mes no entra en el ancho de un panel.
  if (pestana === "calendario") {
    return (
      <div className={styles.viewer}>
        <div className={styles.viewerHeader}>
          <span className={styles.viewerTitle}>{PESTANA_SENTINELA.calendario.titulo}</span>
        </div>
        <div className={styles.viewerBody}>
          <CalendarioPanel />
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
        {!esExcalidraw && !esBase && !esCanvas && !esDrawio && (
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
        ) : esDrawio ? (
          // El panel lateral no es una pestaña: lleva su propia clave para que
          // el barrido de pestañas cerradas no se lo lleve por delante.
          <DrawioView key={notaId} notaId={notaId} instanceId={`sidebar:${notaId}`} />
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
      void renderDrawioIn(containerRef.current);
    }
  }, [html, notaId]);

  return (
    <div ref={containerRef} className="mic-preview mic-layout-read">
      <div dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  );
}
