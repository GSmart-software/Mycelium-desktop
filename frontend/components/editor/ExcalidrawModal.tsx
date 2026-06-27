"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import {
  loadDiagram,
  loadNotaScene,
  saveDiagram,
  saveNotaScene,
  type ExcalidrawScene,
} from "@/lib/excalidraw";
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
 * Editor Excalidraw en modal (HU-16 CA3/CA5): se abre al crear o al clicar un
 * diagrama renderizado; al cerrar guarda automáticamente. Edita un archivo
 * .excalidraw del vault (`fileId`, contenido de la nota) o, en su defecto, un
 * diagrama embebido legado (`notaId`+`diagId`).
 */
export function ExcalidrawModal({
  notaId,
  diagId,
  fileId,
  onClose,
}: {
  notaId?: string;
  diagId?: string;
  fileId?: string;
  onClose: () => void;
}) {
  const apiRef = useRef<ExcalidrawApi | null>(null);
  const [initialScene, setInitialScene] = useState<ExcalidrawScene | null | undefined>(
    undefined,
  );

  useEffect(() => {
    const load = fileId
      ? loadNotaScene(fileId)
      : notaId && diagId
        ? loadDiagram(notaId, diagId)
        : Promise.resolve<ExcalidrawScene | null>({ elements: [] });
    void load.then((scene) => setInitialScene(scene ?? { elements: [] }));
  }, [fileId, notaId, diagId]);

  async function saveAndClose() {
    const api = apiRef.current;
    if (api) {
      const scene: ExcalidrawScene = {
        elements: api.getSceneElements(),
        appState: {},
        files: api.getFiles(),
      };
      if (fileId) await saveNotaScene(fileId, scene);
      else if (notaId && diagId) await saveDiagram(notaId, diagId, scene);
    }
    onClose();
  }

  return (
    <div className={styles.overlay}>
      <div className={styles.modal}>
        <header className={styles.header}>
          <span className={styles.title}>Dibujo</span>
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
