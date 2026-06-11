"use client";

import type { EditorView } from "@codemirror/view";
import {
  Bold,
  Braces,
  Code,
  Columns2,
  Eye,
  Heading1,
  Heading2,
  Heading3,
  Italic,
  Link,
  List,
  ListOrdered,
  Minus,
  PenLine,
  Quote,
  Strikethrough,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useState } from "react";
import {
  insertHorizontalRule,
  insertLink,
  setHeading,
  toggleLinePrefix,
  wrapSelection,
} from "@/lib/editor/commands";
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

/**
 * Barra de herramientas del editor (HU-02): formato a la izquierda,
 * selector de modo a la derecha. En modo `read` solo queda el selector.
 */
export function EditorToolbar({
  getView,
  mode,
  onModeChange,
  syncState,
}: {
  getView: () => EditorView | null;
  mode: EditorMode;
  onModeChange: (mode: EditorMode) => void;
  syncState: SyncState;
}) {
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkText, setLinkText] = useState("");
  const [linkUrl, setLinkUrl] = useState("");

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
    setLinkOpen(true);
  }

  function confirmLink() {
    run((view) => insertLink(view, linkText, linkUrl));
    setLinkOpen(false);
  }

  // Ctrl+K desde el editor abre el popover (HU-02 CA6)
  useEffect(() => {
    function onRequest() {
      const view = getView();
      if (!view) return;
      const { from, to } = view.state.selection.main;
      setLinkText(view.state.sliceDoc(from, to));
      setLinkUrl("");
      setLinkOpen(true);
    }
    window.addEventListener("micelio:link-popover", onRequest);
    return () => window.removeEventListener("micelio:link-popover", onRequest);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const showFormatTools = mode !== "read";

  return (
    <div className={styles.toolbar}>
      {showFormatTools && (
        <div className={styles.formatGroup}>
          <ToolButton icon={Bold} label="Negrita (Ctrl+B)" onClick={() => run((v) => wrapSelection(v, "**"))} />
          <ToolButton icon={Italic} label="Cursiva (Ctrl+I)" onClick={() => run((v) => wrapSelection(v, "*"))} />
          <ToolButton icon={Strikethrough} label="Tachado" onClick={() => run((v) => wrapSelection(v, "~~"))} />
          <ToolButton icon={Braces} label="Código inline (Ctrl+Shift+C)" onClick={() => run((v) => wrapSelection(v, "`"))} />
          <span className={styles.divider} />
          <ToolButton icon={Heading1} label="Título 1" onClick={() => run((v) => setHeading(v, 1))} />
          <ToolButton icon={Heading2} label="Título 2" onClick={() => run((v) => setHeading(v, 2))} />
          <ToolButton icon={Heading3} label="Título 3" onClick={() => run((v) => setHeading(v, 3))} />
          <span className={styles.divider} />
          <ToolButton icon={List} label="Lista desordenada" onClick={() => run((v) => toggleLinePrefix(v, "- "))} />
          <ToolButton icon={ListOrdered} label="Lista ordenada" onClick={() => run((v) => toggleLinePrefix(v, "1. "))} />
          <ToolButton icon={Quote} label="Cita" onClick={() => run((v) => toggleLinePrefix(v, "> "))} />
          <span className={styles.relative}>
            <ToolButton icon={Link} label="Link (Ctrl+K)" onClick={openLinkPopover} />
            {linkOpen && (
              <div className={styles.linkPopover}>
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
              </div>
            )}
          </span>
          <ToolButton icon={Minus} label="Divisor horizontal" onClick={() => run(insertHorizontalRule)} />
        </div>
      )}

      <div className={styles.spacer} />

      <span
        className={`${styles.syncDot} ${styles[`sync_${syncState}`]}`}
        title={SYNC_LABEL[syncState]}
        aria-label={SYNC_LABEL[syncState]}
      />

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
