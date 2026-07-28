"use client";

import { Maximize2, Minimize2, X } from "lucide-react";
import { useEffect, useState } from "react";
import { findLeaf, GRAPH_TAB_ID, useTabsStore } from "@/stores/tabsStore";
import { useSidebarViewerStore } from "@/stores/sidebarViewerStore";
import { useVaultStore } from "@/stores/vaultStore";
import { ExplorerPanel } from "./ExplorerPanel";
import { SidebarNoteView } from "./SidebarNoteView";
import styles from "./ExplorerDock.module.css";

/**
 * Explorador como visor (DEF-023 P3, estilo Obsidian). El árbol de archivos SIEMPRE
 * está arriba; debajo, en una región redimensionable (divisor arrastrable), se
 * muestran los documentos anclados con su propia barra de pestañas. Se ancla
 * arrastrando una pestaña del área de trabajo aquí; se devuelve arrastrando la
 * pestaña del documento de vuelta al área de trabajo.
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

  const tituloDe = (notaId: string) =>
    notaId === GRAPH_TAB_ID
      ? "Grafo de conexiones"
      : notas.find((n) => n.id === notaId)?.titulo ?? "…";

  const hayDocs = tabs.length > 0;
  const activo = tabs.includes(activeTab) ? activeTab : tabs[tabs.length - 1] ?? "";

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

  // Divisor: arrastrar hacia ARRIBA agranda la región de documentos.
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
      {/* Árbol de archivos: ocupa el espacio libre de arriba; se oculta cuando el
          documento está a pantalla completa (mode === "full"). */}
      <div
        className={`${styles.treeRegion} ${
          hayDocs && mode === "full" ? styles.treeOculto : ""
        }`}
      >
        <ExplorerPanel />
      </div>

      {hayDocs && mode === "split" && (
        <div
          className={styles.divisor}
          role="separator"
          aria-orientation="horizontal"
          aria-label="Ajustar el tamaño del visor"
          onPointerDown={onDivisorDown}
        />
      )}

      {hayDocs && (
        <div
          className={`${styles.docsRegion} ${mode === "full" ? styles.docsFull : ""}`}
          style={mode === "split" ? { height: `${docsHeight}px` } : undefined}
        >
          <div className={styles.tabBar} role="tablist">
            {tabs.map((notaId) => {
                const activaTab = activo === notaId;
                return (
                  <div
                    key={notaId}
                    role="tab"
                    aria-selected={activaTab}
                    draggable
                    className={`${styles.tab} ${activaTab ? styles.tabActive : ""}`}
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
              })}
              <button
                type="button"
                className={styles.modeToggle}
                onClick={toggleMode}
                title={mode === "full" ? "Dividir con el explorador" : "Pantalla completa"}
                aria-label={mode === "full" ? "Dividir" : "Pantalla completa"}
              >
                {mode === "full" ? (
                  <Minimize2 size={13} aria-hidden />
                ) : (
                  <Maximize2 size={13} aria-hidden />
                )}
              </button>
            </div>
            <div className={styles.docBody}>
              {activo && <SidebarNoteView key={activo} notaId={activo} />}
            </div>
        </div>
      )}

      {dropActivo && <div className={styles.dropHint}>Soltá para abrir aquí</div>}
    </div>
  );
}
