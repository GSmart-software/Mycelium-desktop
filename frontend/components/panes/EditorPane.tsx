"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { BaseView } from "@/components/bases/BaseView";
import { CanvasView } from "@/components/canvas/CanvasView";
import { RelinkView } from "@/components/enlaces/RelinkView";
import { ExcalidrawFileEditor } from "@/components/editor/ExcalidrawFileEditor";
import { NoteEditor } from "@/components/editor/NoteEditor";
import { GraphView } from "@/components/graph/GraphView";
import { TerminalView } from "@/components/terminal/TerminalView";
import { esTabTerminal, termIdDe } from "@/lib/terminal";
import {
  ENLACES_TAB_ID,
  GRAPH_TAB_ID,
  useTabsStore,
  type LeafPane,
  type SplitEdge,
} from "@/stores/tabsStore";
import { useSidebarViewerStore } from "@/stores/sidebarViewerStore";
import { useVaultStore } from "@/stores/vaultStore";
import { LinkedPreviewPane } from "./LinkedPreviewPane";
import { TabBar } from "./TabBar";
import styles from "./panes.module.css";

/** Pane hoja: tab bar propio + editor de la pestaña activa (HU-25 CA2). */
export function EditorPane({ pane }: { pane: LeafPane }) {
  const router = useRouter();
  const activePaneId = useTabsStore((s) => s.activePaneId);
  const dragging = useTabsStore((s) => s.dragging);
  const draggingNota = useTabsStore((s) => s.draggingNota);
  const notaDropTarget = useTabsStore((s) => s.notaDropTarget);
  const draggingSidebarNota = useTabsStore((s) => s.draggingSidebarNota);
  const setActivePane = useTabsStore((s) => s.setActivePane);
  const splitWithTab = useTabsStore((s) => s.splitWithTab);

  const isActive = activePaneId === pane.id;
  const activeTab = pane.tabs.find((t) => t.id === pane.activeTabId) ?? null;
  const activeTipo = useVaultStore((s) =>
    activeTab ? s.notas.find((n) => n.id === activeTab.notaId)?.tipo ?? "markdown" : null,
  );

  return (
    <section
      className={isActive ? `${styles.pane} ${styles.paneActive}` : styles.pane}
      onPointerDownCapture={() => {
        if (!isActive) setActivePane(pane.id);
      }}
    >
      <TabBar pane={pane} />
      {/* data-pane-id: el explorador ubica este cuerpo por geometría al arrastrar
          una nota (DEF-023 P2), usando el tracking de puntero de dnd-kit. */}
      <div className={styles.paneBody} data-pane-id={pane.id}>
        {pane.linkedTo !== null ? (
          <LinkedPreviewPane pane={pane} />
        ) : activeTab && activeTab.notaId === GRAPH_TAB_ID ? (
          <GraphView key={activeTab.id} />
        ) : activeTab && activeTab.notaId === ENLACES_TAB_ID ? (
          <RelinkView key={activeTab.id} />
        ) : activeTab && esTabTerminal(activeTab.notaId) ? (
          <TerminalView key={activeTab.notaId} termId={termIdDe(activeTab.notaId)} />
        ) : activeTab && activeTipo === "excalidraw" ? (
          <ExcalidrawFileEditor key={activeTab.id} notaId={activeTab.notaId} />
        ) : activeTab && activeTipo === "base" ? (
          <BaseView key={activeTab.id} notaId={activeTab.notaId} />
        ) : activeTab && activeTipo === "canvas" ? (
          <CanvasView key={activeTab.id} notaId={activeTab.notaId} />
        ) : activeTab ? (
          <NoteEditor
            key={activeTab.id}
            notaId={activeTab.notaId}
            instanceId={activeTab.id}
            paneId={pane.id}
            isActivePane={isActive}
          />
        ) : (
          <div className={styles.emptyState}>
            <p className={styles.emptyTitle}>Abrí una nota desde el explorador</p>
            <p className={styles.emptyHint}>
              Tu red de conocimiento crece desde el panel izquierdo.
            </p>
          </div>
        )}

        {/* Zonas de drop en los bordes para crear splits al arrastrar una PESTAÑA
            (drag nativo HTML5, HU-25 CA9 / HU-26 CA1-2). */}
        {dragging && (
          <DropZones
            onDrop={(edge) => {
              const drag = useTabsStore.getState().dragging;
              if (!drag) return;
              splitWithTab(drag.srcPaneId, drag.tabId, pane.id, edge);
              const nid = useTabsStore.getState().activeNotaId();
              router.replace(nid ? `/workspace?note=${nid}` : "/workspace");
            }}
          />
        )}

        {/* Al arrastrar una NOTA del explorador (DEF-023 P2): previo visual de la
            zona objetivo (mitad para dividir, todo para abrir como pestaña). Es
            solo visual (pointer-events:none); el explorador calcula la zona por
            geometría con el tracking de dnd-kit y la publica en `notaDropTarget`. */}
        {draggingNota && notaDropTarget?.paneId === pane.id && (
          <div className={`${styles.noteDropHint} ${styles[`nd_${notaDropTarget.edge}`]}`} />
        )}

        {/* Devolver al workspace un documento anclado en el explorador (DEF-023 P3):
            zona nativa que cubre el pane; al soltar, abre la nota aquí y la quita del
            explorador. */}
        {draggingSidebarNota && (
          <div
            className={styles.sidebarReturnZone}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              const nid = useTabsStore.getState().draggingSidebarNota;
              useTabsStore.getState().setDraggingSidebarNota(null);
              if (!nid) return;
              useTabsStore.getState().openNotaInPane(nid, pane.id);
              useSidebarViewerStore.getState().cerrar(nid);
              router.replace(`/workspace?note=${nid}`);
            }}
          >
            Abrir aquí
          </div>
        )}
      </div>
    </section>
  );
}

const EDGES: SplitEdge[] = ["top", "bottom", "left", "right"];

function DropZones({ onDrop }: { onDrop: (edge: SplitEdge) => void }) {
  const [hover, setHover] = useState<SplitEdge | null>(null);

  return (
    <>
      {EDGES.map((edge) => (
        <div
          key={edge}
          data-edge={edge}
          className={`${styles.dropZone} ${styles[`dropZone_${edge}`]} ${
            hover === edge ? styles.dropZoneHover : ""
          }`}
          onDragOver={(e) => {
            e.preventDefault();
            setHover(edge);
          }}
          onDragLeave={() => setHover(null)}
          onDrop={(e) => {
            e.preventDefault();
            setHover(null);
            onDrop(edge);
          }}
        />
      ))}
    </>
  );
}
