"use client";

import { MoreHorizontal, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { exportNoteMd, exportNotePdfActive } from "@/lib/export";
import { useSyncStore } from "@/stores/syncStore";
import { allLeaves, useTabsStore, type LeafPane, type Tab } from "@/stores/tabsStore";
import { useVaultStore } from "@/stores/vaultStore";
import styles from "./panes.module.css";

/** Tab bar de un pane (HU-25): pestañas con dot de sync, drag y menú "...". */
export function TabBar({ pane }: { pane: LeafPane }) {
  const router = useRouter();
  const store = useTabsStore();
  const notas = useVaultStore((s) => s.notas);
  const carpetas = useVaultStore((s) => s.carpetas);
  const syncByNota = useSyncStore((s) => s.byNota);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    function onPointerDown(e: PointerEvent) {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    }
    window.addEventListener("pointerdown", onPointerDown);
    return () => window.removeEventListener("pointerdown", onPointerDown);
  }, [menuOpen]);

  function pushUrl() {
    const nid = useTabsStore.getState().activeNotaId();
    router.push(nid ? `/workspace?note=${nid}` : "/workspace");
  }

  function titleOf(tab: Tab) {
    return notas.find((n) => n.id === tab.notaId)?.titulo ?? "…";
  }

  /** Tooltip: nombre completo + ruta de carpetas (HU-25 comportamiento). */
  function tooltipOf(tab: Tab) {
    const nota = notas.find((n) => n.id === tab.notaId);
    if (!nota) return "";
    const parts: string[] = [];
    let carpetaId = nota.carpetaId;
    while (carpetaId) {
      const carpeta = carpetas.find((c) => c.id === carpetaId);
      if (!carpeta) break;
      parts.unshift(carpeta.nombre);
      carpetaId = carpeta.padreId;
    }
    return parts.length > 0 ? `${nota.titulo} — ${parts.join("/")}` : nota.titulo;
  }

  const otherPanes = allLeaves(useTabsStore.getState().root).filter(
    (leaf) => leaf.id !== pane.id && leaf.linkedTo === null,
  );

  // Nota activa del pane, para las acciones de exportación del menú "..." (HU-08)
  const activeNotaId = pane.tabs.find((t) => t.id === pane.activeTabId)?.notaId;
  const activeNota = activeNotaId
    ? notas.find((n) => n.id === activeNotaId) ?? null
    : null;

  return (
    <div className={styles.tabBar} role="tablist">
      {pane.tabs.map((tab, index) => {
        const sync = syncByNota[tab.notaId] ?? "synced";
        const isActiveTab = tab.id === pane.activeTabId;
        return (
          <div
            key={tab.id}
            role="tab"
            aria-selected={isActiveTab}
            draggable
            title={tooltipOf(tab)}
            className={isActiveTab ? `${styles.tab} ${styles.tabActive}` : styles.tab}
            onClick={() => {
              store.activateTab(pane.id, tab.id);
              router.push(`/workspace?note=${tab.notaId}`);
            }}
            onDragStart={(e) => {
              e.dataTransfer.setData("text/plain", tab.id);
              e.dataTransfer.effectAllowed = "move";
              store.setDragging({ srcPaneId: pane.id, tabId: tab.id });
            }}
            onDragEnd={() => store.setDragging(null)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              e.stopPropagation();
              const dragging = useTabsStore.getState().dragging;
              if (!dragging) return;
              if (dragging.srcPaneId === pane.id) {
                const fromIndex = pane.tabs.findIndex((t) => t.id === dragging.tabId);
                if (fromIndex >= 0 && fromIndex !== index) {
                  store.reorderTab(pane.id, fromIndex, index);
                }
              } else {
                store.moveTabToPane(dragging.srcPaneId, dragging.tabId, pane.id);
                pushUrl();
              }
              store.setDragging(null);
            }}
          >
            <span className={styles.tabTitle}>{titleOf(tab)}</span>
            <span
              className={`${styles.tabDot} ${styles[`dot_${sync}`]}`}
              aria-hidden
            />
            <button
              type="button"
              className={styles.tabClose}
              aria-label={`Cerrar ${titleOf(tab)}`}
              onClick={(e) => {
                e.stopPropagation();
                store.closeTab(pane.id, tab.id);
                pushUrl();
              }}
            >
              <X size={12} aria-hidden />
            </button>
          </div>
        );
      })}

      <div
        className={styles.tabBarSpace}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          const dragging = useTabsStore.getState().dragging;
          if (dragging && dragging.srcPaneId !== pane.id) {
            store.moveTabToPane(dragging.srcPaneId, dragging.tabId, pane.id);
            pushUrl();
          }
          store.setDragging(null);
        }}
      />

      {pane.linkedTo !== null && (
        <span className={styles.linkedBadge} title="Este pane muestra el preview del pane vinculado">
          Preview vinculado
        </span>
      )}

      <div className={styles.tabMenuWrap} ref={menuRef}>
        <button
          type="button"
          className={styles.tabMenuButton}
          aria-label="Opciones del pane"
          onClick={() => setMenuOpen((v) => !v)}
        >
          <MoreHorizontal size={15} aria-hidden />
        </button>
        {menuOpen && (
          <div className={styles.tabMenu}>
            {activeNota && (
              <>
                <button
                  type="button"
                  className={styles.tabMenuItem}
                  onClick={() => {
                    void exportNoteMd(activeNota.id, activeNota.titulo);
                    setMenuOpen(false);
                  }}
                >
                  Exportar como .md
                </button>
                <button
                  type="button"
                  className={styles.tabMenuItem}
                  onClick={() => {
                    void exportNotePdfActive(activeNota.id, activeNota.titulo, "A4");
                    setMenuOpen(false);
                  }}
                >
                  Exportar como PDF (A4)
                </button>
                <button
                  type="button"
                  className={styles.tabMenuItem}
                  onClick={() => {
                    void exportNotePdfActive(activeNota.id, activeNota.titulo, "Letter");
                    setMenuOpen(false);
                  }}
                >
                  Exportar como PDF (Letter)
                </button>
                <div className={styles.tabMenuSep} />
              </>
            )}
            {pane.linkedTo === null ? (
              otherPanes.length > 0 ? (
                otherPanes.map((other, i) => (
                  <button
                    key={other.id}
                    type="button"
                    className={styles.tabMenuItem}
                    onClick={() => {
                      store.linkPane(pane.id, other.id);
                      setMenuOpen(false);
                    }}
                  >
                    Vincular como preview del pane {i + 1}
                  </button>
                ))
              ) : (
                <p className={styles.tabMenuEmpty}>No hay otros panes para vincular.</p>
              )
            ) : (
              <>
                <button
                  type="button"
                  className={styles.tabMenuItem}
                  onClick={() => {
                    store.toggleLinkedScrollSync(pane.id);
                    setMenuOpen(false);
                  }}
                >
                  Scroll sincronizado: {pane.linkedScrollSync ? "sí" : "no"}
                </button>
                <button
                  type="button"
                  className={styles.tabMenuItem}
                  onClick={() => {
                    store.linkPane(pane.id, null);
                    setMenuOpen(false);
                  }}
                >
                  Desvincular preview
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
