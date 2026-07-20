"use client";

import { useRef, useState } from "react";
import { exportVaultACarpeta, exportVaultZip } from "@/lib/export";
import { collectFromNativeFolder, collectFromZip } from "@/lib/import";
import { useImportStore } from "@/stores/importStore";
import { useVaultStore } from "@/stores/vaultStore";
import styles from "./Settings.module.css";

/** Abre el selector de carpeta nativo del SO; `null` si el usuario cancela. */
async function elegirCarpeta(title: string): Promise<string | null> {
  const { open } = await import("@tauri-apps/plugin-dialog");
  const elegida = await open({ directory: true, multiple: false, title });
  return typeof elegida === "string" ? elegida : null;
}

/**
 * Sección Vault: exportar todo el vault (ZIP o carpeta real del SO, HU-09) e
 * importar Obsidian desde carpeta nativa o .zip (HU-11).
 */
export function VaultSection() {
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [carpetaProgress, setCarpetaProgress] = useState<{ done: number; total: number } | null>(
    null,
  );
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const zipRef = useRef<HTMLInputElement>(null);

  const ocupado = progress !== null || carpetaProgress !== null;

  const handleZip = async () => {
    setProgress({ done: 0, total: 1 });
    try {
      await exportVaultZip((done, total) => setProgress({ done, total }));
    } finally {
      setProgress(null);
    }
  };

  const handleCarpeta = async () => {
    setMensaje(null);
    setError(null);
    try {
      const destino = await elegirCarpeta("Elegí la carpeta donde exportar el vault");
      if (!destino) return;

      const { invoke } = await import("@tauri-apps/api/core");
      const noVacia = await invoke<boolean>("carpeta_no_vacia", { ruta: destino });
      if (
        noVacia &&
        !window.confirm(
          `La carpeta "${destino}" no está vacía.\n\n` +
            "Los archivos con el mismo nombre se sobrescriben. ¿Continuar?",
        )
      ) {
        return;
      }

      setCarpetaProgress({ done: 0, total: 1 });
      const escritos = await exportVaultACarpeta(destino, (done, total) =>
        setCarpetaProgress({ done, total }),
      );
      setMensaje(`Se escribieron ${escritos} archivos en ${destino}`);
    } catch (e) {
      setError((e as Error).message ?? String(e));
    } finally {
      setCarpetaProgress(null);
    }
  };

  const activeFolder = () => useVaultStore.getState().activeFolderId;

  const handleImportarCarpeta = async () => {
    setMensaje(null);
    setError(null);
    try {
      const origen = await elegirCarpeta("Elegí la carpeta del vault a importar");
      if (!origen) return;
      const archivos = await collectFromNativeFolder(origen);
      if (archivos.length === 0) {
        setError("No se encontraron notas (.md o .excalidraw) en esa carpeta.");
        return;
      }
      await useImportStore.getState().run(archivos, activeFolder(), "Vault de Obsidian");
    } catch (e) {
      setError((e as Error).message ?? String(e));
    }
  };

  return (
    <div>
      <div className={styles.field}>
        <span className={styles.label}>Exportar</span>
        <p className={styles.cssPreviewNote} style={{ color: "var(--mic-text-muted)" }}>
          Exportá todas las notas preservando la estructura de carpetas: a una carpeta
          real del equipo (útil para git o Dropbox) o a un ZIP para compartir.
        </p>
        <div className={styles.btnRow}>
          <button
            type="button"
            className={styles.primaryBtn}
            disabled={ocupado}
            onClick={() => void handleCarpeta()}
          >
            {carpetaProgress
              ? `Exportando… ${carpetaProgress.done}/${carpetaProgress.total}`
              : "Exportar a carpeta…"}
          </button>
          <button
            type="button"
            className={styles.secondaryBtn}
            disabled={ocupado}
            onClick={() => void handleZip()}
          >
            {progress
              ? `Comprimiendo… ${progress.done}/${progress.total}`
              : "Exportar vault como ZIP"}
          </button>
        </div>
      </div>

      <div className={styles.field}>
        <span className={styles.label}>Importar vault de Obsidian</span>
        <p className={styles.cssPreviewNote} style={{ color: "var(--mic-text-muted)" }}>
          Importá una carpeta del equipo o un .zip. Se preserva la estructura, se ignora
          <code> .obsidian/</code> y los conflictos se resuelven uno a uno.
        </p>
        <div className={styles.btnRow}>
          <button
            type="button"
            className={styles.secondaryBtn}
            disabled={ocupado}
            onClick={() => void handleImportarCarpeta()}
          >
            Importar desde carpeta…
          </button>
          <button
            type="button"
            className={styles.secondaryBtn}
            disabled={ocupado}
            onClick={() => zipRef.current?.click()}
          >
            Importar .zip
          </button>
        </div>
        <input
          ref={zipRef}
          type="file"
          accept=".zip"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) {
              void collectFromZip(file).then((files) =>
                useImportStore.getState().run(files, activeFolder(), "Vault de Obsidian"),
              );
            }
            e.target.value = "";
          }}
        />
      </div>

      {mensaje && (
        <p className={styles.cssPreviewNote} style={{ color: "var(--mic-text-primary)" }}>
          {mensaje}
        </p>
      )}
      {error && (
        <p
          className={styles.cssPreviewNote}
          style={{ color: "var(--mic-callout-error-border)" }}
          role="alert"
        >
          {error}
        </p>
      )}
    </div>
  );
}
