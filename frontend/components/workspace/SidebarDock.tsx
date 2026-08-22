"use client";

import { Maximize2, Minimize2, X, type LucideIcon } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { SidebarNoteView } from "@/components/explorer/SidebarNoteView";
import { esTabArchivo, nombreDeRuta, rutaDeTabArchivo } from "@/lib/otrosArchivos";
import { esTabTerminal, termIdDe } from "@/lib/terminal";
import { findLeaf, GRAPH_TAB_ID, useTabsStore } from "@/stores/tabsStore";
import { EXPLORER_TAB, useSidebarViewerStore } from "@/stores/sidebarViewerStore";
import { useTerminalStore } from "@/stores/terminalStore";
import { useVaultStore } from "@/stores/vaultStore";
import styles from "./SidebarDock.module.css";

/**
 * Dock del panel lateral (DEF-023 P3 generalizado): el panel izquierdo es,
 * además de la sección activa (explorador, búsqueda, tags, consolas…), un
 * ESPACIO DE PESTAÑAS: cualquier pestaña del workspace (nota, excalidraw, grafo,
 * terminal) puede arrastrarse aquí y anclarse, sin importar qué sección esté
 * activa. Dos disposiciones:
 * - `split`: la sección SIEMPRE arriba + las pestañas ancladas en una región
 *   inferior redimensionable.
 * - `full`: barra de pestañas arriba donde la sección ES una pestaña (su ícono)
 *   junto a las ancladas; la seleccionada ocupa todo el panel.
 * El contenido de la sección se mantiene MONTADO en ambos modos (se oculta, no
 * se desmonta) para no perder su estado.
 */
export function SidebarDock({
  icon: Icon,
  label,
  children,
}: {
  /** Ícono y nombre de la sección activa (para su pestaña en modo full). */
  icon: LucideIcon;
  label: string;
  children: ReactNode;
}) {
  const notas = useVaultStore((s) => s.notas);
  const tabs = useSidebarViewerStore((s) => s.tabs);
  const activeTab = useSidebarViewerStore((s) => s.activeTab);
  const docsHeight = useSidebarViewerStore((s) => s.docsHeight);
  const mode = useSidebarViewerStore((s) => s.mode);
  const activar = useSidebarViewerStore((s) => s.activar);
  const cerrar = useSidebarViewerStore((s) => s.cerrar);
  const toggleMode = useSidebarViewerStore((s) => s.toggleMode);
  const [dropActivo, setDropActivo] = useState(false);

  // Descartar pestañas ancladas cuyas notas ya no existen (borradas).
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
        : esTabArchivo(notaId)
          ? nombreDeRuta(rutaDeTabArchivo(notaId))
          : notas.find((n) => n.id === notaId)?.titulo ?? "…";

  const hayDocs = tabs.length > 0;
  const activeEsDoc = tabs.includes(activeTab);
  const activeDoc = activeEsDoc ? activeTab : tabs[tabs.length - 1] ?? "";
  // Pestaña mostrada: en split, siempre la activa; en full, solo si la activa es
  // una anclada (si es la de la sección, se muestra la sección).
  const docMostrado = mode === "split" ? activeDoc : activeEsDoc ? activeTab : "";
  const seccionVisible = mode === "split" || !activeEsDoc;
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

  // Divisor (solo en split): arrastrar hacia ARRIBA agranda la región anclada.
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
      title={mode === "full" ? `Dividir con ${label}` : "Pantalla completa"}
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
      {/* Modo full: barra de pestañas arriba con la sección como pestaña. */}
      {hayDocs && mode === "full" && (
        <div className={styles.tabBar} role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={!activeEsDoc}
            className={`${styles.tab} ${styles.tabSection} ${!activeEsDoc ? styles.tabActive : ""}`}
            title={label}
            onClick={() => activar(EXPLORER_TAB)}
          >
            <Icon size={15} aria-hidden />
          </button>
          {tabs.map(pestañaDoc)}
          {botonModo}
        </div>
      )}

      {/* Sección activa: siempre montada; oculta si no toca mostrarla. */}
      <div className={`${styles.sectionRegion} ${seccionVisible ? "" : styles.sectionOculta}`}>
        {children}
      </div>

      {/* Modo split: divisor + región de pestañas ancladas abajo. */}
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

      {/* Modo full: cuerpo de la pestaña anclada (en lugar de la sección). */}
      {mostrarDocFull && (
        <div className={styles.docBody}>
          <SidebarNoteView key={docMostrado} notaId={docMostrado} />
        </div>
      )}

      {dropActivo && <div className={styles.dropHint}>Soltá para abrir aquí</div>}
    </div>
  );
}
