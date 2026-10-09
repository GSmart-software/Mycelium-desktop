"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  cargarExcalidraw,
  DibujoIlegible,
  encuadrarDibujo,
  hayAlgoDibujado,
  IDIOMA_EXCALIDRAW,
  loadNotaScene,
  saveNotaScene,
  type ApiEncuadre,
  type ExcalidrawScene,
} from "@/lib/excalidraw";
import { ArchivoIlegible } from "./ArchivoIlegible";
import styles from "./ExcalidrawModal.module.css";

const Excalidraw = dynamic(
  async () => (await cargarExcalidraw()).Excalidraw,
  { ssr: false },
);

type ExcalidrawApi = {
  getSceneElements: () => readonly unknown[];
  getFiles: () => Record<string, unknown>;
} & ApiEncuadre;

/**
 * Editor Excalidraw en modal (HU-16 CA3/CA5): se abre al crear o al clicar un
 * diagrama renderizado; al cerrar guarda automáticamente. Edita un archivo
 * .excalidraw del vault (`fileId`): su contenido es la escena.
 *
 * Si el archivo no se puede leer (`DEF-119`) no se monta el editor: se avisa, y
 * el botón pasa a «Cerrar» **sin guardar**. Antes se abría una escena vacía y
 * «Guardar y cerrar» la escribía encima del original.
 */
export function ExcalidrawModal({
  fileId,
  onClose,
}: {
  fileId: string;
  onClose: () => void;
}) {
  const apiRef = useRef<ExcalidrawApi | null>(null);
  const [initialScene, setInitialScene] = useState<ExcalidrawScene | null | undefined>(
    undefined,
  );
  const [ilegible, setIlegible] = useState<string | null>(null);
  /** Encuadrar lo dibujado al abrir (`FUN-L-26`), como la pestaña. */
  const encuadrePendienteRef = useRef(false);

  const cargar = useCallback(
    (vigente: () => boolean) => {
      void loadNotaScene(fileId).then(
        (scene) => {
          if (!vigente()) return;
          // `null` es que ni se pudo leer del disco: tampoco es un dibujo vacío.
          if (scene === null) {
            setIlegible("No se pudo leer el archivo.");
            return;
          }
          setIlegible(null);
          encuadrePendienteRef.current = hayAlgoDibujado(scene.elements);
          setInitialScene(scene);
        },
        (e: unknown) => {
          if (!vigente()) return;
          apiRef.current = null;
          setIlegible(e instanceof DibujoIlegible ? e.message : String(e));
        },
      );
    },
    [fileId],
  );

  useEffect(() => {
    let vigente = true;
    cargar(() => vigente);
    return () => {
      vigente = false;
    };
  }, [cargar]);

  async function saveAndClose() {
    const api = apiRef.current;
    if (api && ilegible === null) {
      const scene: ExcalidrawScene = {
        elements: api.getSceneElements(),
        appState: {},
        files: api.getFiles(),
      };
      await saveNotaScene(fileId, scene);
    }
    onClose();
  }

  return (
    <div className={styles.overlay}>
      <div className={styles.modal}>
        <header className={styles.header}>
          <span className={styles.title}>Dibujo</span>
          <button type="button" className={styles.save} onClick={() => void saveAndClose()}>
            {ilegible === null ? "Guardar y cerrar" : "Cerrar"}
          </button>
        </header>
        <div className={styles.canvas}>
          {ilegible !== null ? (
            <ArchivoIlegible
              ruta={fileId}
              formato="dibujo de Excalidraw"
              motivo={ilegible}
              onReintentar={() => cargar(() => true)}
              compacto
            />
          ) : (
            initialScene !== undefined && (
              <Excalidraw
                excalidrawAPI={(api) => {
                  apiRef.current = api as unknown as ExcalidrawApi;
                }}
                langCode={IDIOMA_EXCALIDRAW}
                initialData={{
                  elements: (initialScene?.elements ?? []) as never,
                  files: (initialScene?.files ?? null) as never,
                }}
                onChange={(elementos) => {
                  if (
                    encuadrePendienteRef.current &&
                    apiRef.current &&
                    hayAlgoDibujado(elementos)
                  ) {
                    encuadrePendienteRef.current = false;
                    encuadrarDibujo(apiRef.current);
                  }
                }}
              />
            )
          )}
        </div>
      </div>
    </div>
  );
}
