"use client";

import { ArrowLeft, ArrowRight, MoreHorizontal, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { exportNoteMd, exportNotePdfActive } from "@/lib/export";
import { esTabTerminal, termIdDe } from "@/lib/terminal";
import { useSyncStore } from "@/stores/syncStore";
import { useTerminalStore } from "@/stores/terminalStore";
import {
  allLeaves,
  GRAPH_TAB_ID,
  useTabsStore,
  type LeafPane,
  type Tab,
} from "@/stores/tabsStore";
import { useVaultStore } from "@/stores/vaultStore";
import { useWheelHScroll } from "@/lib/useWheelHScroll";
import styles from "./panes.module.css";

/** Tab bar de un pane (HU-25): pestañas con dot de sync, drag y menú "...". */
export function TabBar({ pane }: { pane: LeafPane }) {
  const router = useRouter();
  const store = useTabsStore();
  const notas = useVaultStore((s) => s.notas);
  const carpetas = useVaultStore((s) => s.carpetas);
  const sesionesTerminal = useTerminalStore((s) => s.sesiones);
  const syncByNota = useSyncStore((s) => s.byNota);
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPos, setMenuPos] = useState<{ top: number; right: number }>({ top: 0, right: 0 });
  const menuRef = useRef<HTMLDivElement>(null);
  const menuBtnRef = useRef<HTMLButtonElement>(null);
  const tabBarRef = useRef<HTMLDivElement>(null);
  useWheelHScroll(tabBarRef);

  // El menú se posiciona con position:fixed para escapar del overflow del
  // tab bar (si no, quedaba recortado detrás del editor).
  const toggleMenu = () => {
    const rect = menuBtnRef.current?.getBoundingClientRect();
    if (rect) setMenuPos({ top: rect.bottom + 4, right: window.innerWidth - rect.right });
    setMenuOpen((v) => !v);
  };

  useEffect(() => {
    if (!menuOpen) return;
    function onPointerDown(e: PointerEvent) {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    }
    window.addEventListener("pointerdown", onPointerDown);
    return () => window.removeEventListener("pointerdown", onPointerDown);
  }, [menuOpen]);

  // `replace` y no `push` (DEF-040): la pila del WebView compite con el historial
  // propio de cada pestaña. La URL sigue reflejando la nota activa.
  function pushUrl() {
    const nid = useTabsStore.getState().activeNotaId();
    router.replace(nid ? `/workspace?note=${nid}` : "/workspace");
  }

  function tituloDeNotaId(notaId: string) {
    if (notaId === GRAPH_TAB_ID) return "Grafo de conexiones";
    if (esTabTerminal(notaId)) {
      return sesionesTerminal[termIdDe(notaId)]?.titulo ?? "Terminal";
    }
    return notas.find((n) => n.id === notaId)?.titulo ?? "…";
  }

  function titleOf(tab: Tab) {
    return tituloDeNotaId(tab.notaId);
  }

  // Historial de la pestaña activa de ESTE pane (DEF-040).
  const atras = store.destinoHistorial(pane.id, -1);
  const adelante = store.destinoHistorial(pane.id, 1);

  function navegar(delta: -1 | 1) {
    store.navegarHistorial(pane.id, delta);
    pushUrl();
  }

  /** Tooltip: nombre completo + ruta de carpetas (HU-25 comportamiento). */
  function tooltipOf(tab: Tab) {
    if (tab.notaId === GRAPH_TAB_ID) return "Grafo de conexiones";
    if (esTabTerminal(tab.notaId)) return titleOf(tab);
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
    <div className={styles.tabBar} role="tablist" ref={tabBarRef}>
      {/* Atrás/adelante del historial de la pestaña activa (DEF-040). */}
      <div className={styles.navGroup}>
        <button
          type="button"
          className={styles.navButton}
          disabled={atras === null}
          title={atras !== null ? `Atrás: ${tituloDeNotaId(atras)}` : "Atrás"}
          aria-label="Atrás"
          onClick={() => navegar(-1)}
        >
          <ArrowLeft size={14} aria-hidden />
        </button>
        <button
          type="button"
          className={styles.navButton}
          disabled={adelante === null}
          title={adelante !== null ? `Adelante: ${tituloDeNotaId(adelante)}` : "Adelante"}
          aria-label="Adelante"
          onClick={() => navegar(1)}
        >
          <ArrowRight size={14} aria-hidden />
        </button>
      </div>

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
            className={[
              styles.tab,
              isActiveTab ? styles.tabActive : "",
              tab.preview ? styles.tabPreview : "",
            ]
              .filter(Boolean)
              .join(" ")}
            onClick={() => {
              store.activateTab(pane.id, tab.id);
              router.replace(`/workspace?note=${tab.notaId}`);
            }}
            // Doble clic fija la pestaña de preview como permanente (Obsidian).
            onDoubleClick={() => store.pinTab(pane.id, tab.id)}
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
            {tab.notaId !== GRAPH_TAB_ID && sync !== "synced" && (
              <span
                className={`${styles.tabDot} ${styles[`dot_${sync}`]}`}
                aria-hidden
              />
            )}
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
          ref={menuBtnRef}
          type="button"
          className={styles.tabMenuButton}
          aria-label="Opciones del pane"
          onClick={toggleMenu}
        >
          <MoreHorizontal size={15} aria-hidden />
        </button>
        {menuOpen && (
          <div
            className={styles.tabMenu}
            style={{ position: "fixed", top: menuPos.top, right: menuPos.right }}
          >
            {activeNota && activeNota.tipo !== "excalidraw" && (
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
                    exportNotePdfActive(activeNota.id, activeNota.titulo);
                    setMenuOpen(false);
                  }}
                >
                  Exportar como PDF…
                </button>
                <div className={styles.tabMenuSep} />
              </>
            )}
            {pane.activeTabId && (
              <>
                <button
                  type="button"
                  className={styles.tabMenuItem}
                  onClick={() => {
                    store.splitActivePane(pane.id, "right");
                    pushUrl();
                    setMenuOpen(false);
                  }}
                >
                  Dividir a la derecha
                </button>
                <button
                  type="button"
                  className={styles.tabMenuItem}
                  onClick={() => {
                    store.splitActivePane(pane.id, "bottom");
                    pushUrl();
                    setMenuOpen(false);
                  }}
                >
                  Dividir hacia abajo
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
