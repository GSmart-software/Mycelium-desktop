"use client";

import { usePanelLayoutStore } from "@/stores/panelLayoutStore";
import { ResizeHandle } from "./ResizeHandle";
import styles from "./Panels.module.css";

/**
 * Panel derecho del workspace (HU-29). Las tabs GRAFO / SALIENTES / RETRO
 * y los metadatos de la nota llegan con HU-30 (Fase 7).
 */
export function RightPanel() {
  const rightOpen = usePanelLayoutStore((s) => s.rightOpen);
  const setRightWidth = usePanelLayoutStore((s) => s.setRightWidth);

  return (
    <aside
      className={`${styles.panel} ${styles.panelRight}`}
      aria-hidden={!rightOpen}
    >
      {rightOpen && (
        <>
          <div className={styles.panelContent}>
            <h2 className={styles.panelTitle}>Conexiones</h2>
            <p className={styles.placeholder}>
              El grafo local, los enlaces salientes y los retroenlaces llegan
              con HU-30 (Fase 7).
            </p>
          </div>
          <ResizeHandle side="right" onResize={setRightWidth} />
        </>
      )}
    </aside>
  );
}
