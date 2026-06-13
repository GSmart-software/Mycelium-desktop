"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ExcalidrawFileEditor } from "@/components/editor/ExcalidrawFileEditor";
import { NoteEditor } from "@/components/editor/NoteEditor";
import { GraphView } from "@/components/graph/GraphView";
import { GRAPH_TAB_ID, useTabsStore, type LeafPane, type SplitEdge } from "@/stores/tabsStore";
import { useVaultStore } from "@/stores/vaultStore";
import { LinkedPreviewPane } from "./LinkedPreviewPane";
import { TabBar } from "./TabBar";
import styles from "./panes.module.css";

/** Pane hoja: tab bar propio + editor de la pestaña activa (HU-25 CA2). */
export function EditorPane({ pane }: { pane: LeafPane }) {
  const router = useRouter();
  const activePaneId = useTabsStore((s) => s.activePaneId);
  const dragging = useTabsStore((s) => s.dragging);
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
      <div className={styles.paneBody}>
        {pane.linkedTo !== null ? (
          <LinkedPreviewPane pane={pane} />
        ) : activeTab && activeTab.notaId === GRAPH_TAB_ID ? (
          <GraphView key={activeTab.id} />
        ) : activeTab && activeTipo === "excalidraw" ? (
          <ExcalidrawFileEditor key={activeTab.id} notaId={activeTab.notaId} />
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

        {/* Zonas de drop en los bordes para crear splits (HU-25 CA9 / HU-26 CA1-2) */}
        {dragging && (
          <DropZones
            onDrop={(edge) => {
              splitWithTab(dragging.srcPaneId, dragging.tabId, pane.id, edge);
              const nid = useTabsStore.getState().activeNotaId();
              router.push(nid ? `/workspace?note=${nid}` : "/workspace");
            }}
          />
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
