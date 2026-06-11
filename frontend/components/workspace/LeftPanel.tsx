"use client";

import { usePanelLayoutStore, type RailSection } from "@/stores/panelLayoutStore";
import { ResizeHandle } from "./ResizeHandle";
import styles from "./Panels.module.css";

const SECTION_TITLES: Record<RailSection, string> = {
  explorer: "Explorador",
  search: "Búsqueda",
  graph: "Grafo global",
  tags: "Tags",
  trash: "Papelera",
};

/**
 * Panel izquierdo del workspace (HU-29): su contenido cambia según el ícono
 * activo del rail. Colapsado = width 0 sin cambiar el track del grid.
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
            <h2 className={styles.panelTitle}>{SECTION_TITLES[activeSection]}</h2>
            <SectionContent section={activeSection} />
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
      // El árbol real de carpetas y notas llega en la Fase 3 (HU-22/23/24).
      return <p className={styles.placeholder}>El explorador de notas se construye en la Fase 3.</p>;
    case "search":
      return <p className={styles.placeholder}>La búsqueda en el vault llega con HU-21.</p>;
    case "graph":
      return <p className={styles.placeholder}>El grafo global del vault llega en la Fase 7.</p>;
    case "tags":
      // Placeholder permanente en esta versión (docs/FUTURE_IMPLEMENTATIONS.md).
      return <p className={styles.placeholder}>La vista de tags está planificada para una versión futura.</p>;
    case "trash":
      return <p className={styles.placeholder}>La vista de papelera llega con HU-23 (Fase 3).</p>;
  }
}
