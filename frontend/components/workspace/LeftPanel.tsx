"use client";

import { Files, Search, Tag, Terminal, Trash2, type LucideIcon } from "lucide-react";
import { ExplorerPanel } from "@/components/explorer/ExplorerPanel";
import { SearchPanel } from "@/components/explorer/SearchPanel";
import { TrashPanel } from "@/components/explorer/TrashPanel";
import { TerminalPanel } from "@/components/terminal/TerminalPanel";
import { usePanelLayoutStore, type RailSection } from "@/stores/panelLayoutStore";
import { ResizeHandle } from "./ResizeHandle";
import { SidebarDock } from "./SidebarDock";
import styles from "./Panels.module.css";

const SECTION_TITLES: Record<RailSection, string> = {
  explorer: "Explorador",
  search: "Búsqueda",
  tags: "Tags",
  trash: "Papelera",
  terminal: "Consolas",
};

const SECTION_ICONS: Record<RailSection, LucideIcon> = {
  explorer: Files,
  search: Search,
  tags: Tag,
  trash: Trash2,
  terminal: Terminal,
};

/**
 * Panel izquierdo del workspace (HU-29): su contenido cambia según el ícono
 * activo del rail. Colapsado = width 0 sin cambiar el track del grid.
 * Toda sección va envuelta en el `SidebarDock` (DEF-023 P3 generalizado): el
 * panel es también un espacio de pestañas donde anclar cualquier pestaña del
 * workspace (nota, grafo, terminal…), sea cual sea la sección activa.
 */
export function LeftPanel() {
  const activeSection = usePanelLayoutStore((s) => s.activeSection);
  const setLeftWidth = usePanelLayoutStore((s) => s.setLeftWidth);

  return (
    <aside
      className={`${styles.panel} ${styles.panelLeft}`}
      aria-hidden={activeSection === null}
    >
      {activeSection !== null && (
        <>
          <div className={styles.panelContent}>
            <SidebarDock
              icon={SECTION_ICONS[activeSection]}
              label={SECTION_TITLES[activeSection]}
            >
              {activeSection === "explorer" ? (
                // El explorador aporta su propia cabecera/toolbar, sin título.
                <ExplorerPanel />
              ) : (
                <>
                  <h2 className={styles.panelTitle}>{SECTION_TITLES[activeSection]}</h2>
                  <SectionContent section={activeSection} />
                </>
              )}
            </SidebarDock>
          </div>
          <ResizeHandle side="left" onResize={setLeftWidth} />
        </>
      )}
    </aside>
  );
}

function SectionContent({ section }: { section: RailSection }) {
  switch (section) {
    case "explorer":
      return null; // el explorador se renderiza arriba (sin título)
    case "search":
      return <SearchPanel />;
    case "tags":
      // Placeholder permanente en esta versión (docs/BACKLOG.md).
      return <p className={styles.placeholder}>La vista de tags está planificada para una versión futura.</p>;
    case "trash":
      return <TrashPanel />;
    case "terminal":
      return <TerminalPanel />;
  }
}
