"use client";

import { Folder, Maximize2, Minimize2, X } from "lucide-react";
import { useEffect, useState } from "react";
import { esTabTerminal, termIdDe } from "@/lib/terminal";
import { findLeaf, GRAPH_TAB_ID, useTabsStore } from "@/stores/tabsStore";
import { EXPLORER_TAB, useSidebarViewerStore } from "@/stores/sidebarViewerStore";
import { useTerminalStore } from "@/stores/terminalStore";
import { useVaultStore } from "@/stores/vaultStore";
import { ExplorerPanel } from "./ExplorerPanel";
import { SidebarNoteView } from "./SidebarNoteView";
import styles from "./ExplorerDock.module.css";

/**
 * Explorador como visor (DEF-023 P3, estilo Obsidian). Dos disposiciones:
 * - `split`: el árbol de archivos SIEMPRE arriba + los documentos anclados en una
 *   región inferior redimensionable con sus pestañas (el árbol NO es pestaña).
 * - `full`: barra de pestañas arriba donde el Explorador ES una pestaña (carpeta)
 *   junto a los documentos; la seleccionada ocupa todo el explorador.
 * El árbol (`ExplorerPanel`) se mantiene montado en el mismo lugar en ambos modos
 * (se oculta cuando no toca mostrarlo), para no perder su estado.
 */
export function ExplorerDock() {
  const notas = useVaultStore((s) => s.notas);
  const tabs = useSidebarViewerStore((s) => s.tabs);
  const activeTab = useSidebarViewerStore((s) => s.activeTab);
  const docsHeight = useSidebarViewerStore((s) => s.docsHeight);
  const mode = useSidebarViewerStore((s) => s.mode);
  const activar = useSidebarViewerStore((s) => s.activar);
  const cerrar = useSidebarViewerStore((s) => s.cerrar);
  const toggleMode = useSidebarViewerStore((s) => s.toggleMode);
  const [dropActivo, setDropActivo] = useState(false);

  // Descartar documentos anclados cuyas notas ya no existen (borradas).
  useEffect(() => {
    if (notas.length > 0) {
      useSidebarViewerStore.getState().reconcile(new Set(notas.map((n) => n.id)));
    }
  }, [notas]);

  const sesionesTerminal = useTerminalStore((s) => s.sesiones);
  const tituloDe = (notaId: string) =>
    notaId === GRAPH_TAB_ID
      ? "Grafo de conexiones"
      : esTabTerminal(notaId)
        ? sesionesTerminal[termIdDe(notaId)]?.titulo ?? "Terminal"
        : notas.find((n) => n.id === notaId)?.titulo ?? "…";

  const hayDocs = tabs.length > 0;
  const activeEsDoc = tabs.includes(activeTab);
  const activeDoc = activeEsDoc ? activeTab : tabs[tabs.length - 1] ?? "";
  // Documento que se muestra: en split, siempre el activo; en full, solo si la
  // pestaña activa es un documento (si es la del Explorador, se muestra el árbol).
  const docMostrado = mode === "split" ? activeDoc : activeEsDoc ? activeTab : "";
  const treeVisible = mode === "split" || !activeEsDoc;
  const mostrarDocFull = mode === "full" && activeEsDoc;

  // Ancla la pestaña del workspace que se esté arrastrando (drag nativo de la TabBar).
  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDropActivo(false);
    const drag = useTabsStore.getState().dragging;
    if (!drag) return;
    const leaf = findLeaf(useTabsStore.getState().root, drag.srcPaneId);
    const tab = leaf?.tabs.find((t) => t.id === drag.tabId);
    useTabsStore.getState().setDragging(null);
    if (!tab) return;
    useSidebarViewerStore.getState().dock(tab.notaId);
    useTabsStore.getState().closeTab(drag.srcPaneId, drag.tabId);
  }

  // Divisor (solo en split): arrastrar hacia ARRIBA agranda la región de documentos.
  function onDivisorDown(e: React.PointerEvent) {
    e.preventDefault();
    const startY = e.clientY;
    const startH = useSidebarViewerStore.getState().docsHeight;
    function onMove(ev: PointerEvent) {
      useSidebarViewerStore.getState().setDocsHeight(startH + (startY - ev.clientY));
    }
    function onUp() {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  const botonModo = (
    <button
      type="button"
      className={styles.modeToggle}
      onClick={toggleMode}
      title={mode === "full" ? "Dividir con el explorador" : "Pantalla completa"}
      aria-label={mode === "full" ? "Dividir" : "Pantalla completa"}
    >
      {mode === "full" ? <Minimize2 size={13} aria-hidden /> : <Maximize2 size={13} aria-hidden />}
    </button>
  );

  const pestañaDoc = (notaId: string) => (
    <div
      key={notaId}
      role="tab"
      aria-selected={docMostrado === notaId}
      draggable
      className={`${styles.tab} ${docMostrado === notaId ? styles.tabActive : ""}`}
      title={tituloDe(notaId)}
      onClick={() => activar(notaId)}
      // Arrastrar la pestaña de vuelta al área de trabajo (DEF-023 P3).
      onDragStart={(e) => {
        e.dataTransfer.setData("text/plain", notaId);
        e.dataTransfer.effectAllowed = "move";
        useTabsStore.getState().setDraggingSidebarNota(notaId);
      }}
      onDragEnd={() => useTabsStore.getState().setDraggingSidebarNota(null)}
    >
      <span className={styles.tabTitulo}>{tituloDe(notaId)}</span>
      <button
        type="button"
        className={styles.tabClose}
        aria-label={`Cerrar ${tituloDe(notaId)}`}
        onClick={(e) => {
          e.stopPropagation();
          cerrar(notaId);
        }}
      >
        <X size={12} aria-hidden />
      </button>
    </div>
  );

  return (
    <div
      className={styles.dock}
      onDragOver={(e) => {
        if (!useTabsStore.getState().dragging) return;
        e.preventDefault();
        setDropActivo(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setDropActivo(false);
      }}
      onDrop={onDrop}
    >
      {/* Modo full: barra de pestañas arriba con el Explorador como pestaña. */}
      {hayDocs && mode === "full" && (
        <div className={styles.tabBar} role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={!activeEsDoc}
            className={`${styles.tab} ${styles.tabExplorer} ${!activeEsDoc ? styles.tabActive : ""}`}
            title="Explorador"
            onClick={() => activar(EXPLORER_TAB)}
          >
            <Folder size={15} aria-hidden />
          </button>
          {tabs.map(pestañaDoc)}
          {botonModo}
        </div>
      )}

      {/* Árbol de archivos: siempre montado (mismo lugar); oculto si no toca mostrarlo. */}
      <div className={`${styles.treeRegion} ${treeVisible ? "" : styles.treeOculto}`}>
        <ExplorerPanel />
      </div>

      {/* Modo split: divisor + región de documentos abajo. */}
      {hayDocs && mode === "split" && (
        <>
          <div
            className={styles.divisor}
            role="separator"
            aria-orientation="horizontal"
            aria-label="Ajustar el tamaño del visor"
            onPointerDown={onDivisorDown}
          />
          <div className={styles.docsRegion} style={{ height: `${docsHeight}px` }}>
            <div className={styles.tabBar} role="tablist">
              {tabs.map(pestañaDoc)}
              {botonModo}
            </div>
            <div className={styles.docBody}>
              {docMostrado && <SidebarNoteView key={docMostrado} notaId={docMostrado} />}
            </div>
          </div>
        </>
      )}

      {/* Modo full: cuerpo del documento (debajo de la barra, en lugar del árbol). */}
      {mostrarDocFull && (
        <div className={styles.docBody}>
          <SidebarNoteView key={docMostrado} notaId={docMostrado} />
        </div>
      )}

      {dropActivo && <div className={styles.dropHint}>Soltá para abrir aquí</div>}
    </div>
  );
}
