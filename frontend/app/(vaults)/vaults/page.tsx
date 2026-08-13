"use client";

import { AppWindow, FolderOpen, FolderPlus, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import {
  abrirVaultEnVentana,
  desvincularVault,
  listarVaults,
  vincularVault,
  type VaultRef,
} from "@/lib/vaultMode";
import { AperturaVault } from "@/components/vault/AperturaVault";
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
  /**
   * Se abrió un vault y estamos yendo al workspace.
   *
   * Hace falta aparte de `abriendo` porque el store lo pone en `false` en cuanto
   * termina de abrir, y el `router.replace` corre DESPUÉS: en ese hueco la página
   * volvía a pintar la lista de vaults y se veía un parpadeo del selector justo
   * antes de entrar. No se limpia al navegar —la pantalla se va con la página—;
   * solo si la apertura falla y hay que volver a mostrar la lista.
   */
  const [navegando, setNavegando] = useState(false);

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
    setNavegando(true);
    const ok = await useVaultSessionStore.getState().abrir(ruta);
    if (ok) {
      router.replace("/workspace");
    } else {
      setNavegando(false);
      setError(useVaultSessionStore.getState().error ?? "No se pudo abrir el vault.");
    }
  }

  /**
   * Abre el vault en una ventana aparte, sin dejar esta (`FUN-L-16`). Si ya está
   * abierto en otra, se levanta esa en vez de duplicarlo — dos ventanas sobre la
   * misma carpeta serían dos indexadores escribiendo el mismo índice.
   */
  async function onAbrirEnVentana(ruta: string) {
    setError(null);
    try {
      const creada = await abrirVaultEnVentana(ruta);
      if (!creada) setError("Ese vault ya estaba abierto: se levantó su ventana.");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
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

  // Mientras se abre uno, el selector desaparece y da paso a la pantalla de carga
  // (`DEF-042`). Antes seguía a la vista y el progreso del indexado se escribía
  // en TODOS los botones, incluidos los vaults que nadie había abierto.
  //
  // Se sostiene hasta que la navegación se lleve la página, no hasta que el store
  // diga que terminó: entre las dos cosas hay un hueco en el que se veía asomar
  // el selector otra vez.
  if (abriendo || navegando) return <AperturaVault />;

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
                      onClick={() => void onAbrir(v.ruta)}
                    >
                      Abrir
                    </button>
                    <button
                      type="button"
                      className={styles.removeButton}
                      aria-label={`Abrir ${v.nombre} en una ventana nueva`}
                      title="Abrir en una ventana nueva"
                      onClick={() => void onAbrirEnVentana(v.ruta)}
                    >
                      <AppWindow size={16} aria-hidden />
                    </button>
                    <button
                      type="button"
                      className={styles.removeButton}
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
          onClick={() => void onVincular()}
        >
          <FolderPlus size={16} aria-hidden />
          Vincular carpeta…
        </button>
      </section>
    </main>
  );
}
