"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import { loadDiagram, saveDiagram, type ExcalidrawScene } from "@/lib/excalidraw";
import styles from "./ExcalidrawModal.module.css";

const Excalidraw = dynamic(
  async () => (await import("@excalidraw/excalidraw")).Excalidraw,
  { ssr: false },
);

type ExcalidrawApi = {
  getSceneElements: () => readonly unknown[];
  getFiles: () => Record<string, unknown>;
};

/**
 * Editor Excalidraw en modal (HU-16 CA3/CA5): se abre al clicar el diagrama
 * renderizado; al cerrar guarda automáticamente.
 */
export function ExcalidrawModal({
  notaId,
  diagId,
  onClose,
}: {
  notaId: string;
  diagId: string;
  onClose: () => void;
}) {
  const apiRef = useRef<ExcalidrawApi | null>(null);
  const [initialScene, setInitialScene] = useState<ExcalidrawScene | null | undefined>(
    undefined,
  );

  useEffect(() => {
    void loadDiagram(notaId, diagId).then((scene) =>
      setInitialScene(scene ?? { elements: [] }),
    );
  }, [notaId, diagId]);

  async function saveAndClose() {
    const api = apiRef.current;
    if (api) {
      await saveDiagram(notaId, diagId, {
        elements: api.getSceneElements(),
        appState: {},
        files: api.getFiles(),
      });
    }
    onClose();
  }

  return (
    <div className={styles.overlay}>
      <div className={styles.modal}>
        <header className={styles.header}>
          <span className={styles.title}>Diagrama {diagId.slice(0, 8)}</span>
          <button type="button" className={styles.save} onClick={() => void saveAndClose()}>
            Guardar y cerrar
          </button>
        </header>
        <div className={styles.canvas}>
          {initialScene !== undefined && (
            <Excalidraw
              excalidrawAPI={(api) => {
                apiRef.current = api as unknown as ExcalidrawApi;
              }}
              initialData={{
                elements: (initialScene?.elements ?? []) as never,
                files: (initialScene?.files ?? null) as never,
              }}
            />
          )}
        </div>
      </div>
    </div>
  );
}
