"use client";

import type { EditorView } from "@codemirror/view";
import {
  Bold,
  Braces,
  ChevronDown,
  CircleDot,
  Code,
  Columns2,
  Eye,
  Heading1,
  Heading2,
  Heading3,
  IndentDecrease,
  IndentIncrease,
  Italic,
  Link,
  List,
  ListOrdered,
  Minus,
  MoreVertical,
  PanelRight,
  PenLine,
  Quote,
  Search,
  Shapes,
  Strikethrough,
  TableProperties,
  type LucideIcon,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { panelMetaAbierto, useTabsStore } from "@/stores/tabsStore";
import { useUiStore } from "@/stores/uiStore";
import {
  indentLine,
  insertarBloquePropiedades,
  insertHorizontalRule,
  insertLink,
  outdentLine,
  setHeading,
  toggleLinePrefix,
  wrapSelection,
} from "@/lib/editor/commands";
import { refreshAllLiveViews } from "@/lib/editor/livePreview";
import { insertarEsporaEnVista, leerEspora, type Espora } from "@/lib/esporasVault";
import { exportNoteMd, exportNotePdfActive } from "@/lib/export";
import { useMenuEmergente } from "@/lib/useMenuEmergente";
import { EsporaMenu } from "./EsporaMenu";
import { ExportMenu } from "./ExportMenu";
import styles from "./EditorToolbar.module.css";

export type EditorMode = "live" | "split" | "read" | "raw";

export type SyncState = "local" | "syncing" | "synced" | "offline" | "error";

const MODES: { mode: EditorMode; icon: LucideIcon; label: string; shortcut: string }[] = [
  { mode: "live", icon: PenLine, label: "En vivo", shortcut: "Ctrl+1" },
  { mode: "split", icon: Columns2, label: "Dividido", shortcut: "Ctrl+2" },
  { mode: "read", icon: Eye, label: "Lectura", shortcut: "Ctrl+3" },
  // `DEF-096`: era «Raw», el único en inglés entre tres modos en español.
  // DESIGN.md ya lo llamaba «crudo».
  { mode: "raw", icon: Code, label: "Crudo", shortcut: "Ctrl+4" },
];

/** Acción de formato: o un divisor, o un botón con ícono. */
type FormatAction =
  | { divider: true }
  | { icon: LucideIcon; label: string; run?: (view: EditorView) => void; action?: () => void };

/**
 * Barra de herramientas del editor (HU-02): formato a la izquierda; buscar,
 * panel de enlaces, el selector de modo y «…» a la derecha. En `read` no hay
 * formato. Colapso responsive en dos etapas, solo cuando no hay espacio:
 * primero el formato pasa a «Formato ▾», y si aun así no entra, el grupo
 * derecho pasa a «⋯».
 *
 * El rediseño del cascarón (2026-09-19) probó el formato siempre dentro de
 * «Formato ▾»; el usuario prefiere las herramientas a la vista, así que el menú
 * quedó solo para cuando no entran.
 */
export function EditorToolbar({
  getView,
  mode,
  onModeChange,
  onInsertDiagram,
  notaId,
  titulo,
  paneId,
}: {
  getView: () => EditorView | null;
  mode: EditorMode;
  onModeChange: (mode: EditorMode) => void;
  onInsertDiagram?: () => void;
  notaId: string;
  titulo: string;
  /** Pane al que pertenece esta barra: su panel de metadatos es propio (`DEF-060`). */
  paneId: string;
}) {
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkText, setLinkText] = useState("");
  const [linkUrl, setLinkUrl] = useState("");
  const [linkPos, setLinkPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  // Menú de Esporas (FUN-M-03): null = cerrado. `aviso` sobrevive a la inserción
  // cuando algo no se pudo fusionar, para que se pueda leer.
  const [esporasPos, setEsporasPos] = useState<{ top: number; left: number } | null>(null);
  const [esporaAviso, setEsporaAviso] = useState<string | null>(null);
  const [formatMenuOpen, setFormatMenuOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [rightCollapsed, setRightCollapsed] = useState(false);
  const [rightMenuOpen, setRightMenuOpen] = useState(false);
  const [rightMenuPos, setRightMenuPos] = useState<{ top: number; right: number }>({
    top: 0,
    right: 0,
  });

  const liveTables = useUiStore((s) => s.liveTables);
  const setLiveTables = useUiStore((s) => s.setLiveTables);

  const toolbarRef = useRef<HTMLDivElement>(null);
  const rightRef = useRef<HTMLDivElement>(null);
  const rightMeasureRef = useRef<HTMLDivElement>(null);
  const formatMeasureRef = useRef<HTMLDivElement>(null);
  const formatWrapRef = useRef<HTMLDivElement>(null);
  const formatMenuRef = useRef<HTMLDivElement>(null);
  const formatBtnRef = useRef<HTMLButtonElement>(null);
  const rightMenuRef = useRef<HTMLDivElement>(null);
  const rightMenuWrapRef = useRef<HTMLDivElement>(null);
  const rightMenuBtnRef = useRef<HTMLButtonElement>(null);

  function run(action: (view: EditorView) => void) {
    const view = getView();
    if (view) {
      action(view);
      view.focus();
    }
  }

  function openLinkPopover() {
    const view = getView();
    if (!view) return;
    const { from, to } = view.state.selection.main;
    setLinkText(view.state.sliceDoc(from, to));
    setLinkUrl("");
    const rect = toolbarRef.current?.getBoundingClientRect();
    if (rect) setLinkPos({ top: rect.bottom + 4, left: rect.left + 8 });
    setLinkOpen(true);
    setFormatMenuOpen(false);
  }

  function confirmLink() {
    run((view) => insertLink(view, linkText, linkUrl));
    setLinkOpen(false);
  }

  function abrirEsporas() {
    const rect = toolbarRef.current?.getBoundingClientRect();
    setEsporaAviso(null);
    setEsporasPos(rect ? { top: rect.bottom + 4, left: rect.left + 8 } : { top: 0, left: 0 });
    setFormatMenuOpen(false);
  }

  /**
   * Inserta la Espora elegida en la nota abierta. El cuerpo va al cursor y las
   * propiedades se fusionan con el frontmatter, en UNA transacción (ver
   * `insertarEsporaEnVista`): `Ctrl+Z` lo deshace en un solo paso.
   */
  async function insertarEspora(espora: Espora) {
    const view = getView();
    if (!view) return;
    try {
      const aviso = insertarEsporaEnVista(view, await leerEspora(espora.id), titulo);
      setEsporaAviso(aviso);
      if (!aviso) setEsporasPos(null); // sin avisos, el menú se cierra solo
    } catch (e) {
      setEsporaAviso(e instanceof Error ? e.message : String(e));
    }
  }

  // Ctrl+K desde el editor abre el popover (HU-02 CA6)
  useEffect(() => {
    function onRequest() {
      openLinkPopover();
    }
    window.addEventListener("micelio:link-popover", onRequest);
    return () => window.removeEventListener("micelio:link-popover", onRequest);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const showFormatTools = mode !== "read";
  // Panel de metadatos/conexiones a la derecha (toggle desde la toolbar).
  const metaPanelOpen = useTabsStore((s) => panelMetaAbierto(s.root, paneId));
  const toggleMetaPanel = () => useTabsStore.getState().togglePanelMeta(paneId);

  // Colapso en dos etapas, con los anchos naturales de medidores ocultos (así
  // colapsar no cambia lo que se mide): si no entra todo, el formato pasa a
  // «Formato ▾»; si aun así no entra, el grupo derecho pasa a «⋯».
  useEffect(() => {
    const toolbar = toolbarRef.current;
    if (!toolbar) return;
    const measure = () => {
      const formatNatural = showFormatTools ? formatMeasureRef.current?.offsetWidth ?? 0 : 0;
      const rightNatural = rightMeasureRef.current?.offsetWidth ?? 0;
      const formatBtn = showFormatTools ? 96 : 0;
      const disponible = toolbar.clientWidth - 16;
      setCollapsed(formatNatural + rightNatural > disponible);
      setRightCollapsed(formatBtn + rightNatural > disponible);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(toolbar);
    return () => ro.disconnect();
  }, [showFormatTools]);

  // Clic afuera, Escape, flechas y uno solo a la vez (`useMenuEmergente`).
  const cerrarFormato = useCallback(() => setFormatMenuOpen(false), []);
  const cerrarDerecho = useCallback(() => setRightMenuOpen(false), []);
  useMenuEmergente({
    abierto: formatMenuOpen,
    cerrar: cerrarFormato,
    contenedorRef: formatWrapRef,
    menuRef: formatMenuRef,
    disparadorRef: formatBtnRef,
  });
  useMenuEmergente({
    abierto: rightMenuOpen,
    cerrar: cerrarDerecho,
    contenedorRef: rightMenuWrapRef,
    menuRef: rightMenuRef,
    disparadorRef: rightMenuBtnRef,
  });

  const openRightMenu = () => {
    const r = rightMenuBtnRef.current?.getBoundingClientRect();
    if (r) setRightMenuPos({ top: r.bottom + 4, right: window.innerWidth - r.right });
    setRightMenuOpen((v) => !v);
  };

  const formatActions: FormatAction[] = [
    { icon: Bold, label: "Negrita (Ctrl+B)", run: (v) => wrapSelection(v, "**") },
    { icon: Italic, label: "Cursiva (Ctrl+I)", run: (v) => wrapSelection(v, "*") },
    { icon: Strikethrough, label: "Tachado", run: (v) => wrapSelection(v, "~~") },
    { icon: Braces, label: "Código inline (Ctrl+Shift+C)", run: (v) => wrapSelection(v, "`") },
    { divider: true },
    { icon: Heading1, label: "Título 1", run: (v) => setHeading(v, 1) },
    { icon: Heading2, label: "Título 2", run: (v) => setHeading(v, 2) },
    { icon: Heading3, label: "Título 3", run: (v) => setHeading(v, 3) },
    { divider: true },
    { icon: List, label: "Lista desordenada", run: (v) => toggleLinePrefix(v, "- ") },
    { icon: ListOrdered, label: "Lista ordenada", run: (v) => toggleLinePrefix(v, "1. ") },
    { icon: Quote, label: "Cita", run: (v) => toggleLinePrefix(v, "> ") },
    { icon: IndentIncrease, label: "Aumentar sangría (Tab)", run: indentLine },
    { icon: IndentDecrease, label: "Disminuir sangría (Shift+Tab)", run: outdentLine },
    { icon: Link, label: "Link (Ctrl+K)", action: openLinkPopover },
    { icon: Minus, label: "Divisor horizontal", run: insertHorizontalRule },
    // Propiedades (FUN-M-19): la vía para una nota SIN frontmatter, donde no hay
    // tarjeta en la que pulsar «+ Agregar propiedad».
    { icon: TableProperties, label: "Propiedades de la nota", run: insertarBloquePropiedades },
    // Plantillas (FUN-M-03): la única vía que sirve para notas que YA existen.
    { icon: CircleDot, label: "Insertar Espora", action: abrirEsporas },
    ...(onInsertDiagram
      ? ([
          { divider: true },
          { icon: Shapes, label: "Insertar diagrama Excalidraw", action: onInsertDiagram },
        ] as FormatAction[])
      : []),
  ];

  const runAction = (a: Extract<FormatAction, { icon: LucideIcon }>) => {
    if (a.run) run(a.run);
    else a.action?.();
  };

  return (
    <div className={styles.toolbar} ref={toolbarRef}>
      {showFormatTools && !collapsed && (
        <div className={styles.formatGroup} role="toolbar" aria-label="Formato">
          {formatActions.map((a, i) =>
            "divider" in a ? (
              <span key={i} className={styles.divider} />
            ) : (
              <ToolButton key={i} icon={a.icon} label={a.label} onClick={() => runAction(a)} />
            ),
          )}
        </div>
      )}

      {/* Medidor oculto: ancho natural de la tira de formato. */}
      {showFormatTools && (
        <div className={styles.measure} aria-hidden ref={formatMeasureRef}>
          {formatActions.map((a, i) =>
            "divider" in a ? (
              <span key={i} className={styles.divider} />
            ) : (
              <span key={i} className={styles.toolButton}>
                <a.icon size={16} aria-hidden />
              </span>
            ),
          )}
        </div>
      )}

      {showFormatTools && collapsed && (
        <div className={styles.formatMenuWrap} ref={formatWrapRef}>
          <button
            ref={formatBtnRef}
            type="button"
            className={formatMenuOpen ? `${styles.formatTrigger} ${styles.modeActive}` : styles.formatTrigger}
            aria-haspopup="menu"
            aria-expanded={formatMenuOpen}
            onClick={() => setFormatMenuOpen((o) => !o)}
          >
            Formato
            <ChevronDown size={14} aria-hidden />
          </button>
          {formatMenuOpen && (
            <div ref={formatMenuRef} className={styles.formatMenu} role="menu" aria-label="Formato">
              {formatActions.map((a, i) =>
                "divider" in a ? (
                  <div key={i} className={styles.formatMenuSep} />
                ) : (
                  <button
                    key={i}
                    type="button"
                    role="menuitem"
                    className={styles.formatMenuItem}
                    onClick={() => {
                      runAction(a);
                      setFormatMenuOpen(false);
                    }}
                  >
                    <a.icon size={15} aria-hidden />
                    <span>{a.label}</span>
                  </button>
                ),
              )}
            </div>
          )}
        </div>
      )}

      {/* Popover en un portal a <body>: así nunca queda recortado por el
          overflow de la toolbar/panes ni por un containing-block (transform)
          de un ancestro. Posición fija calculada desde el rect de la toolbar. */}
      {linkOpen &&
        typeof document !== "undefined" &&
        createPortal(
          <div className={styles.linkPopover} style={{ position: "fixed", top: linkPos.top, left: linkPos.left }}>
            <input
              className={styles.linkInput}
              placeholder="Texto del enlace"
              value={linkText}
              autoFocus
              onChange={(e) => setLinkText(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && confirmLink()}
            />
            <input
              className={styles.linkInput}
              placeholder="URL"
              value={linkUrl}
              onChange={(e) => setLinkUrl(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") confirmLink();
                if (e.key === "Escape") setLinkOpen(false);
              }}
            />
            <div className={styles.linkActions}>
              <button type="button" className={styles.linkConfirm} onClick={confirmLink}>
                Insertar
              </button>
              <button type="button" className={styles.linkCancel} onClick={() => setLinkOpen(false)}>
                Cancelar
              </button>
            </div>
          </div>,
          document.body,
        )}

      {esporasPos && (
        <EsporaMenu
          top={esporasPos.top}
          left={esporasPos.left}
          aviso={esporaAviso}
          onElegir={(espora) => void insertarEspora(espora)}
          onCerrar={() => setEsporasPos(null)}
        />
      )}

      <div className={styles.spacer} />

      <div className={styles.right} ref={rightRef}>
        {!rightCollapsed ? (
          <>
            <ToolButton
              icon={Search}
              label="Buscar en el archivo (Ctrl+F)"
              onClick={() => useUiStore.getState().setSearchInNoteOpen(true)}
            />

            <button
              type="button"
              className={metaPanelOpen ? `${styles.toolButton} ${styles.modeActive}` : styles.toolButton}
              title="Panel de enlaces (Ctrl+Shift+\\)"
              aria-label="Panel de enlaces"
              aria-pressed={metaPanelOpen}
              onClick={toggleMetaPanel}
            >
              <PanelRight size={16} aria-hidden />
            </button>

            <div className={styles.modeGroup} role="group" aria-label="Modo de visualización">
              {MODES.map(({ mode: m, icon: Icon, label, shortcut }) => (
                <button
                  key={m}
                  type="button"
                  className={mode === m ? `${styles.modeButton} ${styles.modeActive}` : styles.modeButton}
                  data-mode={m}
                  title={`${label} (${shortcut})`}
                  aria-label={label}
                  aria-pressed={mode === m}
                  onClick={() => onModeChange(m)}
                >
                  <Icon size={16} aria-hidden />
                </button>
              ))}
            </div>

            {/* «…» al extremo derecho, después de los modos (VS Code, Obsidian). */}
            <ExportMenu notaId={notaId} titulo={titulo} />
          </>
        ) : (
          // Pantalla muy chica: buscar, exportar y modos colapsados en "⋯".
          <div className={styles.rightMenuWrap} ref={rightMenuWrapRef}>
            <button
              ref={rightMenuBtnRef}
              type="button"
              className={styles.toolButton}
              title="Más acciones"
              aria-label="Más acciones"
              aria-haspopup="menu"
              aria-expanded={rightMenuOpen}
              onClick={openRightMenu}
            >
              <MoreVertical size={16} aria-hidden />
            </button>
            {rightMenuOpen && (
              <div
                ref={rightMenuRef}
                className={styles.rightMenu}
                role="menu"
                style={{ position: "fixed", top: rightMenuPos.top, right: rightMenuPos.right }}
              >
                <button
                  type="button"
                  role="menuitem"
                  className={styles.formatMenuItem}
                  onClick={() => {
                    useUiStore.getState().setSearchInNoteOpen(true);
                    setRightMenuOpen(false);
                  }}
                >
                  <Search size={15} aria-hidden />
                  <span>Buscar en el archivo</span>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className={
                    metaPanelOpen
                      ? `${styles.formatMenuItem} ${styles.menuItemActive}`
                      : styles.formatMenuItem
                  }
                  onClick={() => {
                    toggleMetaPanel();
                    setRightMenuOpen(false);
                  }}
                >
                  <PanelRight size={15} aria-hidden />
                  <span>Panel de enlaces</span>
                </button>
                <div className={styles.formatMenuSep} />
                {MODES.map(({ mode: m, icon: Icon, label }) => (
                  <button
                    key={m}
                    type="button"
                    role="menuitemradio"
                    aria-checked={mode === m}
                    className={
                      mode === m
                        ? `${styles.formatMenuItem} ${styles.menuItemActive}`
                        : styles.formatMenuItem
                    }
                    onClick={() => {
                      onModeChange(m);
                      setRightMenuOpen(false);
                    }}
                  >
                    <Icon size={15} aria-hidden />
                    <span>{label}</span>
                  </button>
                ))}
                <div className={styles.formatMenuSep} />
                <button
                  type="button"
                  role="menuitem"
                  className={styles.formatMenuItem}
                  onClick={() => {
                    void exportNoteMd(notaId, titulo);
                    setRightMenuOpen(false);
                  }}
                >
                  <span>Exportar como .md</span>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className={styles.formatMenuItem}
                  onClick={() => {
                    exportNotePdfActive(notaId, titulo);
                    setRightMenuOpen(false);
                  }}
                >
                  <span>Exportar como PDF…</span>
                </button>
                <div className={styles.formatMenuSep} />
                <label className={styles.rightMenuCheck}>
                  <input
                    type="checkbox"
                    checked={liveTables}
                    onChange={(e) => {
                      setLiveTables(e.target.checked);
                      refreshAllLiveViews();
                    }}
                  />
                  Renderizar tablas (vista en vivo)
                </label>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Medidor oculto del grupo derecho (ancho natural para decidir colapso). */}
      <div className={styles.measure} aria-hidden ref={rightMeasureRef} style={{ gap: "0.4rem" }}>
        <span className={styles.toolButton}>
          <Search size={16} aria-hidden />
        </span>
        <span className={styles.toolButton}>
          <PanelRight size={16} aria-hidden />
        </span>
        <span className={styles.modeGroup}>
          {MODES.map(({ mode: m, icon: Icon }) => (
            <span key={m} className={styles.modeButton} data-mode={m}>
              <Icon size={16} aria-hidden />
            </span>
          ))}
        </span>
        <span className={styles.toolButton}>
          <MoreVertical size={16} aria-hidden />
        </span>
      </div>
    </div>
  );
}

function ToolButton({
  icon: Icon,
  label,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  onClick: () => void;
}) {
  return (
    <button type="button" className={styles.toolButton} title={label} aria-label={label} onClick={onClick}>
      <Icon size={16} aria-hidden />
    </button>
  );
}
