"use client";

import type { EditorView } from "@codemirror/view";
import {
  Bold,
  Braces,
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
  Type,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { usePanelLayoutStore } from "@/stores/panelLayoutStore";
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
import { EsporaMenu } from "./EsporaMenu";
import { ExportMenu } from "./ExportMenu";
import styles from "./EditorToolbar.module.css";

export type EditorMode = "live" | "split" | "read" | "raw";

export type SyncState = "local" | "syncing" | "synced" | "offline" | "error";

const MODES: { mode: EditorMode; icon: LucideIcon; label: string; shortcut: string }[] = [
  { mode: "live", icon: PenLine, label: "En vivo", shortcut: "Ctrl+1" },
  { mode: "split", icon: Columns2, label: "Dividido", shortcut: "Ctrl+2" },
  { mode: "read", icon: Eye, label: "Lectura", shortcut: "Ctrl+3" },
  { mode: "raw", icon: Code, label: "Raw", shortcut: "Ctrl+4" },
];

const SYNC_LABEL: Record<SyncState, string> = {
  local: "Guardado localmente — sync pendiente",
  syncing: "Sincronizando…",
  synced: "Sincronizado",
  offline: "Sin conexión — cambios pendientes",
  error: "Error de sincronización — cambios pendientes",
};

/** Acción de formato: o un divisor, o un botón con ícono. */
type FormatAction =
  | { divider: true }
  | { icon: LucideIcon; label: string; run?: (view: EditorView) => void; action?: () => void };

/**
 * Barra de herramientas del editor (HU-02): formato a la izquierda, selector de
 * modo a la derecha. En `read` solo queda el selector. Cuando el ancho no
 * alcanza, el grupo de formato se colapsa en un menú desplegable (responsive).
 */
export function EditorToolbar({
  getView,
  mode,
  onModeChange,
  syncState,
  onInsertDiagram,
  notaId,
  titulo,
}: {
  getView: () => EditorView | null;
  mode: EditorMode;
  onModeChange: (mode: EditorMode) => void;
  syncState: SyncState;
  onInsertDiagram?: () => void;
  notaId: string;
  titulo: string;
}) {
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkText, setLinkText] = useState("");
  const [linkUrl, setLinkUrl] = useState("");
  const [linkPos, setLinkPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  // Menú de Esporas (FUN-M-03): null = cerrado. `aviso` sobrevive a la inserción
  // cuando algo no se pudo fusionar, para que se pueda leer.
  const [esporasPos, setEsporasPos] = useState<{ top: number; left: number } | null>(null);
  const [esporaAviso, setEsporaAviso] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [formatMenuOpen, setFormatMenuOpen] = useState(false);
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
  const measureRef = useRef<HTMLDivElement>(null);
  const rightMeasureRef = useRef<HTMLDivElement>(null);
  const formatWrapRef = useRef<HTMLDivElement>(null);
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
  const metaPanelOpen = usePanelLayoutStore((s) => s.rightOpen);
  const toggleMetaPanel = () => usePanelLayoutStore.getState().toggleRight();

  // Colapso responsive en dos etapas según el ancho disponible, medido con
  // medidores ocultos (anchos naturales, sin feedback al colapsar):
  //   1) si no entra todo, se colapsa primero el grupo de formato;
  //   2) si aun así no entra, se colapsa también el grupo derecho (buscar,
  //      exportar y modos) en un menú "⋯".
  useEffect(() => {
    const toolbar = toolbarRef.current;
    if (!toolbar) return;
    const measure = () => {
      const formatNatural = showFormatTools ? measureRef.current?.offsetWidth ?? 0 : 0;
      const rightNatural = rightMeasureRef.current?.offsetWidth ?? 0;
      const formatBtn = showFormatTools ? 34 : 0; // botón "Formato" colapsado
      const available = toolbar.clientWidth - 16;

      if (formatNatural + rightNatural <= available) {
        setCollapsed(false);
        setRightCollapsed(false);
      } else if (formatBtn + rightNatural <= available) {
        setCollapsed(true);
        setRightCollapsed(false);
      } else {
        setCollapsed(true);
        setRightCollapsed(true);
      }
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(toolbar);
    return () => ro.disconnect();
  }, [showFormatTools, onInsertDiagram]);

  // Cerrar los menús al hacer clic fuera.
  useEffect(() => {
    if (!formatMenuOpen && !rightMenuOpen) return;
    function onDown(e: PointerEvent) {
      if (!formatWrapRef.current?.contains(e.target as Node)) setFormatMenuOpen(false);
      if (!rightMenuWrapRef.current?.contains(e.target as Node)) setRightMenuOpen(false);
    }
    window.addEventListener("pointerdown", onDown);
    return () => window.removeEventListener("pointerdown", onDown);
  }, [formatMenuOpen, rightMenuOpen]);

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
        <div className={styles.formatGroup}>
          {formatActions.map((a, i) =>
            "divider" in a ? (
              <span key={i} className={styles.divider} />
            ) : (
              <ToolButton key={i} icon={a.icon} label={a.label} onClick={() => runAction(a)} />
            ),
          )}
        </div>
      )}

      {showFormatTools && collapsed && (
        <div className={styles.formatMenuWrap} ref={formatWrapRef}>
          <button
            type="button"
            className={styles.toolButton}
            title="Formato"
            aria-label="Herramientas de formato"
            aria-haspopup="menu"
            aria-expanded={formatMenuOpen}
            onClick={() => setFormatMenuOpen((o) => !o)}
          >
            <Type size={16} aria-hidden />
          </button>
          {formatMenuOpen && (
            <div className={styles.formatMenu} role="menu">
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

      {/* Medidor oculto: ancho natural del grupo de formato (para decidir colapso). */}
      {showFormatTools && (
        <div className={styles.measure} aria-hidden ref={measureRef}>
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
        <span
          className={`${styles.syncDot} ${styles[`sync_${syncState}`]}`}
          title={SYNC_LABEL[syncState]}
          aria-label={SYNC_LABEL[syncState]}
        />

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
              title="Panel de metadatos (Ctrl+Shift+\\)"
              aria-label="Panel de metadatos"
              aria-pressed={metaPanelOpen}
              onClick={toggleMetaPanel}
            >
              <PanelRight size={16} aria-hidden />
            </button>

            <ExportMenu notaId={notaId} titulo={titulo} />

            <div className={styles.modeGroup} role="radiogroup" aria-label="Modo de visualización">
              {MODES.map(({ mode: m, icon: Icon, label, shortcut }) => (
                <button
                  key={m}
                  type="button"
                  className={mode === m ? `${styles.modeButton} ${styles.modeActive}` : styles.modeButton}
                  data-mode={m}
                  title={`${label} (${shortcut})`}
                  aria-pressed={mode === m}
                  onClick={() => onModeChange(m)}
                >
                  <Icon size={16} aria-hidden />
                </button>
              ))}
            </div>
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
                  <span>Panel de metadatos</span>
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
        <span className={styles.syncDot} />
        <span className={styles.toolButton}>
          <Search size={16} aria-hidden />
        </span>
        <span className={styles.toolButton}>
          <PanelRight size={16} aria-hidden />
        </span>
        <span className={styles.toolButton}>
          <MoreVertical size={16} aria-hidden />
        </span>
        <span className={styles.modeGroup}>
          {MODES.map(({ mode: m, icon: Icon }) => (
            <span key={m} className={styles.modeButton} data-mode={m}>
              <Icon size={16} aria-hidden />
            </span>
          ))}
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
