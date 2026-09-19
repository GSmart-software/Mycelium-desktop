"use client";

import { LogOut, Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { useUiStore } from "@/stores/uiStore";
import { nombreDeVault } from "@/lib/vaultMode";
import { useVaultSessionStore } from "@/stores/vaultSessionStore";
import { ControlesVentana } from "@/components/ventana/ControlesVentana";
import styles from "./AppTopbar.module.css";

/**
 * AppTopbar del workspace (HU-38): logo, el disparador de la paleta de notas y
 * comandos, y salir del vault. Siempre visible.
 *
 * El centro era un campo «Buscar en Mycelium…» que no buscaba nada (`DEF-090`)
 * y a la derecha estaba «Compartir», que en desktop no existe (ver
 * `lib/capacidades.ts`). Rediseño del cascarón, 2026-09-19.
 *
 * Además es la barra de título: la ventana va sin la del sistema (`FUN-M-31`),
 * así que el fondo libre de esta barra arrastra la ventana
 * (`data-tauri-drag-region`, con doble clic para maximizar) y a la derecha van
 * minimizar, maximizar y cerrar.
 */
export function AppTopbar() {
  const router = useRouter();
  const setPaleta = useUiStore((s) => s.setPaleta);
  // Solo hay vault en carpeta (fase 3) cuando la sesión tiene ruta abierta; en
  // modo SQLite clásico `rutaActual` es null y no se muestra "Salir del vault".
  const rutaVault = useVaultSessionStore((s) => s.rutaActual);

  async function salirDelVault() {
    await useVaultSessionStore.getState().salir();
    router.replace("/vaults");
  }

  return (
    <header className={styles.topbar} data-tauri-drag-region>
      <button
        type="button"
        className={styles.logo}
        onClick={() => router.push("/workspace")}
        title="Mycelium"
        aria-label="Mycelium"
      >
        <svg viewBox="0 0 32 32" width="27" height="27" aria-hidden className={styles.logoMark}>
          <path
            d="M9 10L23 8M9 10L16 23M23 8L16 23"
            stroke="var(--mic-marco-glow)"
            strokeWidth="1.5"
            opacity="0.55"
            fill="none"
          />
          <circle cx="9" cy="10" r="4" fill="var(--mic-marco-glow)" />
          <circle cx="23" cy="8" r="3" fill="var(--mic-marco-acento)" />
          <circle cx="16" cy="23" r="4" fill="var(--mic-callout-info-border)" />
        </svg>
        <span className={styles.logoFull}>Mycelium</span>
      </button>

      {/* El vault abierto. Estaba en el título de la ventana y con el marco
          propio esa barra ya no está; el título sigue existiendo para la barra
          de tareas y el Alt+Tab, pero adentro hacía falta verlo. */}
      {rutaVault && (
        <span className={styles.vault} title={rutaVault}>
          {nombreDeVault(rutaVault)}
        </span>
      )}

      <button type="button" className={styles.searchBar} onClick={() => setPaleta("notas")}>
        <Search size={14} aria-hidden className={styles.searchIcon} />
        <span className={styles.searchPlaceholder}>Ir a una nota o comando…</span>
        <kbd className={styles.searchKey}>Ctrl+P</kbd>
      </button>

      <div className={styles.actions}>

        {rutaVault && (
          <button
            type="button"
            className={styles.vaultExitButton}
            aria-label="Salir del vault"
            title="Salir del vault"
            onClick={() => void salirDelVault()}
          >
            <LogOut size={14} aria-hidden />
          </button>
        )}

        <ControlesVentana className={styles.controlesVentana} />
      </div>
    </header>
  );
}
