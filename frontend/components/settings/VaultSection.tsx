"use client";

import { useEffect, useRef, useState } from "react";
import { exportVaultACarpeta, exportVaultZip } from "@/lib/export";
import {
  FRAMEWORK_IA_VERSION,
  generarFramework,
  versionInstalada,
} from "@/lib/ia/framework";
import { collectFromNativeFolder, collectFromZip } from "@/lib/import";
import { getAbrirUltimo, setAbrirUltimo } from "@/lib/vaultMode";
import { useExportStore } from "@/stores/exportStore";
import { useImportStore } from "@/stores/importStore";
import { useVaultSessionStore } from "@/stores/vaultSessionStore";
import { useVaultStore } from "@/stores/vaultStore";
import styles from "./Settings.module.css";

// Títulos de progreso (DEF-018): identifican qué exportación corre para etiquetar
// el botón correcto y la barra global.
const T_ZIP = "Comprimiendo ZIP";
const T_CARPETA = "Exportando a carpeta";

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
  // Progreso GLOBAL (DEF-018): sobrevive al cierre del menú de opciones.
  const progreso = useExportStore((s) => s.progreso);
  const setProgreso = useExportStore((s) => s.setProgreso);
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [abrirUltimo, setAbrirUltimoState] = useState(false);
  const zipRef = useRef<HTMLInputElement>(null);
  // Framework IA (FUN-L-08): versión instalada en el vault (null = no generado).
  const rutaVault = useVaultSessionStore((s) => s.rutaActual);
  const [versionIa, setVersionIa] = useState<string | null>(null);
  const [generandoIa, setGenerandoIa] = useState(false);

  const ocupado = progreso !== null;

  useEffect(() => {
    void getAbrirUltimo().then(setAbrirUltimoState).catch(() => undefined);
  }, []);

  useEffect(() => {
    if (rutaVault) void versionInstalada(rutaVault).then(setVersionIa);
    else setVersionIa(null);
  }, [rutaVault]);

  const handleGenerarIa = async () => {
    if (!rutaVault) return;
    setMensaje(null);
    setError(null);
    setGenerandoIa(true);
    try {
      await generarFramework(rutaVault);
      setVersionIa(FRAMEWORK_IA_VERSION);
      setMensaje(
        `Instrucciones IA v${FRAMEWORK_IA_VERSION} generadas en el vault (CLAUDE.md + .claude/).`,
      );
    } catch (e) {
      setError((e as Error).message ?? String(e));
    } finally {
      setGenerandoIa(false);
    }
  };

  const onToggleAbrirUltimo = async (valor: boolean) => {
    setAbrirUltimoState(valor); // optimista
    try {
      await setAbrirUltimo(valor);
    } catch {
      setAbrirUltimoState(!valor); // revertir si falla
    }
  };

  const handleZip = async () => {
    setProgreso({ done: 0, total: 1, titulo: T_ZIP });
    try {
      await exportVaultZip((done, total) => setProgreso({ done, total, titulo: T_ZIP }));
    } finally {
      setProgreso(null);
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

      setProgreso({ done: 0, total: 1, titulo: T_CARPETA });
      const escritos = await exportVaultACarpeta(destino, (done, total) =>
        setProgreso({ done, total, titulo: T_CARPETA }),
      );
      setMensaje(`Se escribieron ${escritos} archivos en ${destino}`);
    } catch (e) {
      setError((e as Error).message ?? String(e));
    } finally {
      setProgreso(null);
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
        <div className={styles.toggleRow}>
          <span className={styles.label}>Abrir el último vault al iniciar</span>
          <label
            className={styles.switch}
            title={abrirUltimo ? "Activado" : "Desactivado"}
          >
            <input
              type="checkbox"
              checked={abrirUltimo}
              onChange={(e) => void onToggleAbrirUltimo(e.target.checked)}
              aria-label="Abrir automáticamente el último vault al iniciar"
            />
            <span className={styles.switchTrack} aria-hidden />
          </label>
        </div>
        <p className={styles.cssPreviewNote} style={{ color: "var(--mic-text-muted)" }}>
          Al abrir Mycelium se reabre automáticamente el último vault que usaste. Si
          está desactivado, se muestra el selector de vaults para elegir.
        </p>
      </div>

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
            {progreso?.titulo === T_CARPETA
              ? `Exportando… ${progreso.done}/${progreso.total}`
              : "Exportar a carpeta…"}
          </button>
          <button
            type="button"
            className={styles.secondaryBtn}
            disabled={ocupado}
            onClick={() => void handleZip()}
          >
            {progreso?.titulo === T_ZIP
              ? `Comprimiendo… ${progreso.done}/${progreso.total}`
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

      <div className={styles.field}>
        <span className={styles.label}>Asistente IA (Claude Code)</span>
        <p className={styles.cssPreviewNote} style={{ color: "var(--mic-text-muted)" }}>
          Genera en el vault las instrucciones para asistentes de IA por terminal
          (<code>CLAUDE.md</code> + skill + comandos en <code>.claude/</code>): le
          enseñan a navegar tus notas con los vínculos <code>[[...]]</code>, la
          estructura y las funciones de Mycelium. Solo se crean si lo pedís acá.
          {versionIa && (
            <>
              {" "}Instalado: <strong>v{versionIa}</strong>
              {versionIa !== FRAMEWORK_IA_VERSION && (
                <> · disponible: <strong>v{FRAMEWORK_IA_VERSION}</strong></>
              )}
            </>
          )}
        </p>
        {rutaVault ? (
          <div className={styles.btnRow}>
            <button
              type="button"
              className={versionIa ? styles.secondaryBtn : styles.primaryBtn}
              disabled={generandoIa}
              onClick={() => void handleGenerarIa()}
            >
              {generandoIa
                ? "Generando…"
                : !versionIa
                  ? "Generar instrucciones IA"
                  : versionIa !== FRAMEWORK_IA_VERSION
                    ? `Actualizar a v${FRAMEWORK_IA_VERSION}`
                    : "Regenerar"}
            </button>
          </div>
        ) : (
          <p className={styles.cssPreviewNote} style={{ color: "var(--mic-text-muted)" }}>
            Disponible solo con un vault en carpeta (los archivos se escriben en disco).
          </p>
        )}
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
