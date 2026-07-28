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

        {/* Zonas de drop en los bordes para crear splits al arrastrar una PESTAÑA
            (drag nativo HTML5, HU-25 CA9 / HU-26 CA1-2). */}
        {dragging && (
          <DropZones
            onDrop={(edge) => {
              const drag = useTabsStore.getState().dragging;
              if (!drag) return;
              splitWithTab(drag.srcPaneId, drag.tabId, pane.id, edge);
              const nid = useTabsStore.getState().activeNotaId();
              router.push(nid ? `/workspace?note=${nid}` : "/workspace");
            }}
          />
        )}

        {/* Al arrastrar una NOTA del explorador (DEF-023 P2): un único overlay por
            encima del editor cubre todo el pane. Así el puntero nunca llega a
            CodeMirror (que si no iniciaría una selección y cancelaría el drag de
            dnd-kit). Calcula borde/centro por posición y registra `notaDropTarget`;
            el drop real lo resuelve el explorador leyéndolo. */}
        {draggingNota && <NoteDropOverlay paneId={pane.id} />}
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

/** Distancia al borde bajo la cual el drop divide en ese lado; el resto = centro. */
const UMBRAL_BORDE = 56;

/** Zona (borde o centro) según la posición local del puntero dentro del pane. */
function zonaEn(x: number, y: number, w: number, h: number): SplitEdge | "center" {
  const d = { top: y, bottom: h - y, left: x, right: w - x };
  const min = Math.min(d.top, d.bottom, d.left, d.right);
  if (min > UMBRAL_BORDE) return "center";
  if (min === d.top) return "top";
  if (min === d.bottom) return "bottom";
  if (min === d.left) return "left";
  return "right";
}

/**
 * Overlay de drop para arrastrar una nota del explorador (DEF-023 P2). Cubre todo
 * el pane por encima del editor: el puntero no llega a CodeMirror (evita que este
 * cancele el drag de dnd-kit). Registra la zona bajo el puntero en `notaDropTarget`
 * y muestra el previo del split/apertura; el drop lo resuelve el explorador.
 */
function NoteDropOverlay({ paneId }: { paneId: string }) {
  const [zona, setZona] = useState<SplitEdge | "center" | null>(null);

  return (
    <div
      className={styles.noteDropOverlay}
      onPointerMove={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        const z = zonaEn(e.clientX - r.left, e.clientY - r.top, r.width, r.height);
        setZona(z);
        useTabsStore.getState().setNotaDropTarget({ paneId, edge: z });
      }}
      onPointerLeave={() => {
        setZona(null);
        useTabsStore.getState().setNotaDropTarget(null);
      }}
    >
      {zona && <div className={`${styles.noteDropHint} ${styles[`nd_${zona}`]}`} />}
    </div>
  );
}
