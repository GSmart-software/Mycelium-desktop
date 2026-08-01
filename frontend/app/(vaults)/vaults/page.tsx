"use client";

import { FolderOpen, FolderPlus, Loader2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import {
  desvincularVault,
  listarVaults,
  vincularVault,
  type VaultRef,
} from "@/lib/vaultMode";
import { useVaultSessionStore } from "@/stores/vaultSessionStore";
import styles from "./page.module.css";

/**
 * Selector de vaults (fase 3 del "vault en carpeta", solo-desktop). Lista los
 * vaults vinculados, permite vincular una carpeta nueva (diálogo del SO), abrir
 * uno (entra al workspace leyendo esa carpeta) y quitarlo del registro. La
 * apertura automática del último vault es un ajuste GLOBAL en Configuración, no
 * una opción por vault. Ver `docs/features/vault-en-carpeta.md`.
 */
export default function VaultsPage() {
  const router = useRouter();
  const [vaults, setVaults] = useState<VaultRef[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const abriendo = useVaultSessionStore((s) => s.abriendo);
  // Avance del indexado (FUN-M-12): mientras hay progreso el botón lo muestra en
  // lugar del spinner mudo. `total === 0` (vault vacío) no aporta nada útil.
  const progreso = useVaultSessionStore((s) => s.progreso);
  const etiquetaAbrir =
    abriendo && progreso && progreso.total > 0
      ? `Indexando ${progreso.hechas}/${progreso.total}`
      : "Abrir";

  const refrescar = useCallback(async () => {
    setCargando(true);
    try {
      const lista = await listarVaults();
      setVaults(lista);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo leer el registro de vaults.");
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => {
    void refrescar();
  }, [refrescar]);

  async function onVincular() {
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const elegido = await open({ directory: true });
      if (typeof elegido !== "string") return; // cancelado o multiselección
      await vincularVault(elegido);
      await refrescar();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo vincular la carpeta.");
    }
  }

  async function onAbrir(ruta: string) {
    setError(null);
    const ok = await useVaultSessionStore.getState().abrir(ruta);
    if (ok) {
      router.replace("/workspace");
    } else {
      setError(useVaultSessionStore.getState().error ?? "No se pudo abrir el vault.");
    }
  }

  async function onQuitar(ruta: string) {
    try {
      await desvincularVault(ruta);
      await refrescar();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo quitar el vault.");
    }
  }

  return (
    <main className={styles.main}>
      <section className={styles.panel}>
        <header className={styles.header}>
          <h1 className={styles.title}>Tus vaults</h1>
          <p className={styles.subtitle}>
            Elige una carpeta para abrirla como vault, o vincula una nueva.
          </p>
        </header>

        {error && (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}

        {cargando ? (
          <p className={styles.muted}>Cargando…</p>
        ) : vaults.length === 0 ? (
          <div className={styles.empty}>
            <FolderOpen size={28} aria-hidden className={styles.emptyIcon} />
            <p className={styles.emptyTitle}>Todavía no has vinculado ningún vault.</p>
            <p className={styles.muted}>
              Vincula una carpeta con tus notas <code>.md</code> para empezar.
            </p>
          </div>
        ) : (
          <ul className={styles.list}>
            {vaults.map((v) => {
              return (
                <li key={v.ruta} className={styles.item}>
                  <div className={styles.itemInfo}>
                    <span className={styles.itemName}>{v.nombre}</span>
                    <span className={styles.itemPath} title={v.ruta}>
                      {v.ruta}
                    </span>
                  </div>
                  <div className={styles.itemActions}>
                    <button
                      type="button"
                      className={styles.openButton}
                      disabled={abriendo}
                      onClick={() => void onAbrir(v.ruta)}
                    >
                      {abriendo ? (
                        <Loader2 size={14} aria-hidden className={styles.spin} />
                      ) : null}
                      {etiquetaAbrir}
                    </button>
                    <button
                      type="button"
                      className={styles.removeButton}
                      disabled={abriendo}
                      aria-label={`Quitar ${v.nombre} del registro`}
                      title="Quitar del registro (no borra los archivos)"
                      onClick={() => void onQuitar(v.ruta)}
                    >
                      <X size={16} aria-hidden />
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        <button
          type="button"
          className={styles.linkButton}
          disabled={abriendo}
          onClick={() => void onVincular()}
        >
          <FolderPlus size={16} aria-hidden />
          Vincular carpeta…
        </button>
      </section>
    </main>
  );
}
