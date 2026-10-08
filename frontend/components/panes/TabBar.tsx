"use client";

import { ArrowLeft, ArrowRight, MoreHorizontal, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useRef, useState, type CSSProperties, type MouseEvent } from "react";
import { cerrarPestanaSinPerder } from "@/lib/conflictosAbiertos";
import { exportNoteMd, exportNotePdfActive } from "@/lib/export";
import { useMenuEmergente } from "@/lib/useMenuEmergente";
import { rutaDeTabArchivo } from "@/lib/otrosArchivos";
import { iconoDePestana, tipoDePestana, tituloDePestana } from "@/lib/pestanas";
import { esTabTerminal, termIdDe } from "@/lib/terminalBase";
import { usePreferencesStore } from "@/stores/preferencesStore";
import { useSyncStore } from "@/stores/syncStore";
import { useTerminalStore, varColorConsola } from "@/stores/terminalStore";
import { allLeaves, useTabsStore, type LeafPane, type Tab } from "@/stores/tabsStore";
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
  const iconosEnPestanas = usePreferencesStore((s) => s.prefs.iconosEnPestanas);
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPos, setMenuPos] = useState<{ top: number; right: number }>({ top: 0, right: 0 });
  const menuRef = useRef<HTMLDivElement>(null);
  const menuBtnRef = useRef<HTMLButtonElement>(null);
  const menuListaRef = useRef<HTMLDivElement>(null);
  const tabBarRef = useRef<HTMLDivElement>(null);
  useWheelHScroll(tabBarRef);

  // El menú se posiciona con position:fixed para escapar del overflow del
  // tab bar (si no, quedaba recortado detrás del editor).
  const toggleMenu = () => {
    const rect = menuBtnRef.current?.getBoundingClientRect();
    if (rect) setMenuPos({ top: rect.bottom + 4, right: window.innerWidth - rect.right });
    setMenuOpen((v) => !v);
  };

  const cerrarMenu = useCallback(() => setMenuOpen(false), []);
  // Escape, flechas, foco y un solo menú abierto a la vez: ver useMenuEmergente.
  useMenuEmergente({
    abierto: menuOpen,
    cerrar: cerrarMenu,
    contenedorRef: menuRef,
    menuRef: menuListaRef,
    disparadorRef: menuBtnRef,
  });

  // `replace` y no `push` (DEF-040): la pila del WebView compite con el historial
  // propio de cada pestaña. La URL sigue reflejando la nota activa.
  function pushUrl() {
    const nid = useTabsStore.getState().activeNotaId();
    router.replace(nid ? `/workspace?note=${nid}` : "/workspace");
  }

  // Título e ícono por tipo de pestaña (`FUN-S-11`): la misma respuesta que en
  // el dock lateral, porque sale de la misma tabla (`lib/pestanas.ts`).
  const tituloDeNotaId = (notaId: string) => tituloDePestana(notaId, notas, sesionesTerminal);

  function titleOf(tab: Tab) {
    return tituloDeNotaId(tab.notaId);
  }

  const iconoDeTab = (notaId: string) => iconoDePestana(notaId, notas);

  /**
   * El color con el que está marcada una consola (`FUN-S-12`), o `null`.
   *
   * Se atenúa en las pestañas que no tienen el foco. La atenuación es una
   * **mezcla con el fondo** y no un `opacity`: la marca vive dentro de la
   * pestaña, y apagar el elemento apagaría de paso el título.
   */
  function colorDeTab(notaId: string, activa: boolean): string | null {
    if (!esTabTerminal(notaId)) return null;
    const color = varColorConsola(sesionesTerminal[termIdDe(notaId)]?.color);
    if (color === null) return null;
    return activa ? color : `color-mix(in srgb, ${color} 60%, transparent)`;
  }

  // Historial de la pestaña activa de ESTE pane (DEF-040).
  const atras = store.destinoHistorial(pane.id, -1);
  const adelante = store.destinoHistorial(pane.id, 1);

  function navegar(delta: -1 | 1) {
    store.navegarHistorial(pane.id, delta);
    pushUrl();
  }

  /**
   * Clic con la rueda en una flecha (`FUN-S-13`): el documento anterior o
   * siguiente se abre en una pestaña nueva en segundo plano, y la actual no se
   * mueve. Es la misma convención que la rueda sobre un archivo del explorador.
   */
  function abrirDestinoAparte(e: MouseEvent, destino: string | null) {
    if (e.button !== 1 || destino === null) return;
    e.preventDefault();
    store.openNoteBackground(destino, pane.id);
    pushUrl();
  }

  /** Tooltip: nombre completo + ruta de carpetas (HU-25 comportamiento). */
  function tooltipOf(tab: Tab) {
    const tipo = tipoDePestana(tab.notaId);
    // La ruta relativa completa: es lo único que ubica al archivo, porque no
    // está en el árbol de carpetas del índice.
    if (tipo === "archivo") return rutaDeTabArchivo(tab.notaId);
    if (tipo !== "nota") return titleOf(tab);
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
          title={atras !== null ? `Atrás: ${tituloDeNotaId(atras)} (rueda: en pestaña nueva)` : "Atrás"}
          aria-label="Atrás"
          onClick={() => navegar(-1)}
          // Evita el auto-scroll del navegador al pulsar la rueda.
          onMouseDown={(e) => e.button === 1 && e.preventDefault()}
          onAuxClick={(e) => abrirDestinoAparte(e, atras)}
        >
          <ArrowLeft size={14} aria-hidden />
        </button>
        <button
          type="button"
          className={styles.navButton}
          disabled={adelante === null}
          title={adelante !== null ? `Adelante: ${tituloDeNotaId(adelante)} (rueda: en pestaña nueva)` : "Adelante"}
          aria-label="Adelante"
          onClick={() => navegar(1)}
          // Evita el auto-scroll del navegador al pulsar la rueda.
          onMouseDown={(e) => e.button === 1 && e.preventDefault()}
          onAuxClick={(e) => abrirDestinoAparte(e, adelante)}
        >
          <ArrowRight size={14} aria-hidden />
        </button>
      </div>

      {pane.tabs.map((tab, index) => {
        const sync = syncByNota[tab.notaId] ?? "synced";
        const isActiveTab = tab.id === pane.activeTabId;
        const Icono = iconoDeTab(tab.notaId);
        const color = colorDeTab(tab.notaId, isActiveTab);
        return (
          <div
            key={tab.id}
            role="tab"
            aria-selected={isActiveTab}
            // Pestañas con teclado (rediseño del cascarón): una sola parada de
            // Tab —la activa— y flechas entre ellas, como el patrón tablist.
            // Antes no se podían enfocar: solo se llegaba con el ratón.
            tabIndex={isActiveTab ? 0 : -1}
            data-tab-id={tab.id}
            onKeyDown={(e) => {
              const i = pane.tabs.findIndex((t) => t.id === tab.id);
              const destino =
                e.key === "ArrowRight" ? pane.tabs[(i + 1) % pane.tabs.length]
                : e.key === "ArrowLeft" ? pane.tabs[(i - 1 + pane.tabs.length) % pane.tabs.length]
                : e.key === "Home" ? pane.tabs[0]
                : e.key === "End" ? pane.tabs[pane.tabs.length - 1]
                : null;
              if (destino) {
                e.preventDefault();
                store.activateTab(pane.id, destino.id);
                router.replace(`/workspace?note=${destino.notaId}`);
                tabBarRef.current
                  ?.querySelector<HTMLElement>(`[data-tab-id="${CSS.escape(destino.id)}"]`)
                  ?.focus();
              } else if (e.key === "Delete") {
                e.preventDefault();
                // Sin perder lo de una nota en conflicto con el disco (`DEF-138`).
                void cerrarPestanaSinPerder(pane.id, tab.id).then((cerrada) => {
                  if (!cerrada) return;
                  pushUrl();
                  // El foco sigue en la barra, en la pestaña que quedó activa.
                  requestAnimationFrame(() =>
                    tabBarRef.current?.querySelector<HTMLElement>('[role="tab"][tabindex="0"]')?.focus(),
                  );
                });
              }
            }}
            draggable
            title={tooltipOf(tab)}
            // El color de la consola entra como variable y no como clase: son
            // seis, y seis clases que solo cambian un valor es exactamente lo
            // que las variables existen para no tener que escribir.
            style={color ? ({ "--mic-tab-color": color } as CSSProperties) : undefined}
            className={[
              styles.tab,
              isActiveTab ? styles.tabActive : "",
              tab.preview ? styles.tabPreview : "",
              color ? styles.tabConColor : "",
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
            {iconosEnPestanas && (
              <Icono size={13} className={styles.tabIcono} aria-hidden />
            )}
            <span className={styles.tabTitle}>{titleOf(tab)}</span>
            {tipoDePestana(tab.notaId) === "nota" && sync !== "synced" && (
              <span
                className={`${styles.tabDot} ${styles[`dot_${sync}`]}`}
                aria-hidden
              />
            )}
            <button
              type="button"
              className={styles.tabClose}
              // Con el teclado se cierra con Supr o Ctrl+W sobre la pestaña.
              tabIndex={-1}
              aria-label={`Cerrar ${titleOf(tab)}`}
              onClick={(e) => {
                e.stopPropagation();
                void cerrarPestanaSinPerder(pane.id, tab.id).then((cerrada) => cerrada && pushUrl());
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
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          onClick={toggleMenu}
        >
          <MoreHorizontal size={15} aria-hidden />
        </button>
        {menuOpen && (
          <div
            ref={menuListaRef}
            role="menu"
            aria-label="Opciones del pane"
            className={styles.tabMenu}
            style={{ position: "fixed", top: menuPos.top, right: menuPos.right }}
          >
            {activeNota && activeNota.tipo !== "excalidraw" && (
              <>
                <button
                  type="button"
                  role="menuitem"
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
                  role="menuitem"
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
                  role="menuitem"
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
                  role="menuitem"
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
                    role="menuitem"
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
                  role="menuitem"
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
                  role="menuitem"
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
