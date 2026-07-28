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
  const draggingNota = useTabsStore((s) => s.draggingNota);
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

        {/* Zonas de drop en los bordes para crear splits (HU-25 CA9 / HU-26 CA1-2).
            También al arrastrar una nota del explorador (DEF-023 P2): en ese caso
            solo dan feedback visual + atributos para el hit-test; el drop lo resuelve
            el explorador (dnd-kit no alcanza a los panes). */}
        {(dragging || draggingNota) && (
          <DropZones
            paneId={pane.id}
            noteDrag={draggingNota !== null}
            onDrop={(edge) => {
              const drag = useTabsStore.getState().dragging;
              if (!drag) return; // drag de nota: lo maneja el explorador
              splitWithTab(drag.srcPaneId, drag.tabId, pane.id, edge);
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

function DropZones({
  paneId,
  noteDrag,
  onDrop,
}: {
  paneId: string;
  noteDrag: boolean;
  onDrop: (edge: SplitEdge) => void;
}) {
  const [hover, setHover] = useState<SplitEdge | "center" | null>(null);

  return (
    <>
      {/* Zona central: solo al arrastrar una nota (DEF-023 P2) = abrir como pestaña.
          Se dibuja detrás de los bordes para que estos ganen en las esquinas. */}
      {noteDrag && (
        <div
          data-edge="center"
          className={`${styles.dropZoneCenter} ${
            hover === "center" ? styles.dropZoneHover : ""
          }`}
          onPointerEnter={() => {
            setHover("center");
            useTabsStore.getState().setNotaDropTarget({ paneId, edge: "center" });
          }}
          onPointerLeave={() => {
            setHover(null);
            useTabsStore.getState().setNotaDropTarget(null);
          }}
        />
      )}
      {EDGES.map((edge) => (
        <div
          key={edge}
          data-edge={edge}
          className={`${styles.dropZone} ${styles[`dropZone_${edge}`]} ${
            hover === edge ? styles.dropZoneHover : ""
          }`}
          // Drag NATIVO de pestañas (HU-25/26)
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
          // Drag de nota (dnd-kit, por puntero): feedback + registro del objetivo.
          // El drop lo resuelve el explorador leyendo notaDropTarget (DEF-023 P2).
          onPointerEnter={() => {
            if (!noteDrag) return;
            setHover(edge);
            useTabsStore.getState().setNotaDropTarget({ paneId, edge });
          }}
          onPointerLeave={() => {
            if (!noteDrag) return;
            setHover(null);
            useTabsStore.getState().setNotaDropTarget(null);
          }}
        />
      ))}
    </>
  );
}
