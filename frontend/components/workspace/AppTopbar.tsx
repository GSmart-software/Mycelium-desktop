"use client";

import { Search, Share2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useAuthStore } from "@/stores/authStore";
import { useUiStore } from "@/stores/uiStore";
import styles from "./AppTopbar.module.css";

/**
 * AppTopbar del workspace (HU-38): logo, búsqueda en la nota activa,
 * botón Compartir y avatar. Siempre visible.
 */
export function AppTopbar({ activeNoteTitle }: { activeNoteTitle: string | null }) {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const setSettingsOpen = useUiStore((s) => s.setSettingsOpen);
  const setSearchInNoteOpen = useUiStore((s) => s.setSearchInNoteOpen);

  const initials = (user?.nombre ?? "?")
    .split(/\s+/)
    .map((part) => part[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  // El botón Compartir se habilita cuando la nota activa está en una carpeta
  // compartible (HU-35). Hasta entonces queda deshabilitado.
  const canShare = false;

  return (
    <header className={styles.topbar}>
      <button
        type="button"
        className={styles.logo}
        onClick={() => router.push("/workspace")}
        title="Micelio"
      >
        <span className={styles.logoFull}>Micelio</span>
        <span className={styles.logoCompact} aria-hidden>M</span>
      </button>

      <button
        type="button"
        className={styles.searchBar}
        onClick={() => setSearchInNoteOpen(true)}
        title="Buscar en la nota activa (Ctrl+F)"
      >
        <Search size={14} aria-hidden className={styles.searchIcon} />
        <span className={styles.searchPlaceholder}>
          {activeNoteTitle ?? "Micelio"}
        </span>
      </button>

      <div className={styles.actions}>
        <button
          type="button"
          className={styles.shareButton}
          disabled={!canShare}
          title={
            canShare
              ? "Compartir la carpeta de esta nota"
              : "Disponible cuando la nota esté en una carpeta compartible"
          }
        >
          <Share2 size={14} aria-hidden />
          <span className={styles.shareLabel}>Compartir</span>
        </button>

        <button
          type="button"
          className={styles.avatar}
          onClick={() => setSettingsOpen(true)}
          title={user?.nombre ?? "Cuenta"}
          aria-label="Abrir configuración"
        >
          {initials}
        </button>
      </div>
    </header>
  );
}
