"use client";

import { Folder, X } from "lucide-react";
import { useEffect, useState } from "react";
import {
  findLeaf,
  GRAPH_TAB_ID,
  useTabsStore,
} from "@/stores/tabsStore";
import { EXPLORER_TAB, useSidebarViewerStore } from "@/stores/sidebarViewerStore";
import { useVaultStore } from "@/stores/vaultStore";
import { ExplorerPanel } from "./ExplorerPanel";
import { SidebarNoteView } from "./SidebarNoteView";
import styles from "./ExplorerDock.module.css";

/**
 * Explorador como visor con pestañas (DEF-023 P3, estilo Obsidian). Barra de
 * pestañas arriba: "Explorador" (árbol, permanente, no cerrable) + una por
 * documento anclado. Se ancla arrastrando una pestaña del área de trabajo (drag
 * nativo de la `TabBar`) y soltándola aquí. El árbol se mantiene MONTADO (oculto
 * cuando hay un documento activo) para no perder su estado.
 */
export function ExplorerDock() {
  const notas = useVaultStore((s) => s.notas);
  const tabs = useSidebarViewerStore((s) => s.tabs);
  const activeTab = useSidebarViewerStore((s) => s.activeTab);
  const activar = useSidebarViewerStore((s) => s.activar);
  const cerrar = useSidebarViewerStore((s) => s.cerrar);
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
  const mostrandoArbol = activeTab === EXPLORER_TAB || !tabs.includes(activeTab);

  // Ancla la pestaña del workspace que se esté arrastrando (drag nativo).
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

  return (
    <div
      className={styles.dock}
      onDragOver={(e) => {
        if (!useTabsStore.getState().dragging) return;
        e.preventDefault();
        setDropActivo(true);
      }}
      onDragLeave={(e) => {
        // Solo si el puntero sale del dock (no al pasar entre hijos).
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setDropActivo(false);
      }}
      onDrop={onDrop}
    >
      <div className={styles.tabBar} role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={mostrandoArbol}
          className={`${styles.tab} ${mostrandoArbol ? styles.tabActive : ""}`}
          title="Explorador"
          onClick={() => activar(EXPLORER_TAB)}
        >
          <Folder size={15} aria-hidden />
        </button>
        {tabs.map((notaId) => {
          const activa = activeTab === notaId;
          return (
            <div
              key={notaId}
              role="tab"
              aria-selected={activa}
              className={`${styles.tab} ${styles.tabDoc} ${activa ? styles.tabActive : ""}`}
              title={tituloDe(notaId)}
              onClick={() => activar(notaId)}
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
      </div>

      <div className={styles.body}>
        {/* Árbol siempre montado; oculto cuando hay un documento activo. */}
        <div className={mostrandoArbol ? styles.pane : styles.paneOculto}>
          <ExplorerPanel />
        </div>
        {!mostrandoArbol && (
          <div className={styles.pane}>
            <SidebarNoteView key={activeTab} notaId={activeTab} />
          </div>
        )}
      </div>

      {dropActivo && (
        <div className={styles.dropHint}>Soltá para abrir aquí</div>
      )}
    </div>
  );
}
