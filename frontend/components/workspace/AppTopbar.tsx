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
export function AppTopbar({
  activeNoteTitle,
  shareFolder,
}: {
  activeNoteTitle: string | null;
  shareFolder: { id: string; nombre: string } | null;
}) {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const setSettingsOpen = useUiStore((s) => s.setSettingsOpen);
  const setSearchInNoteOpen = useUiStore((s) => s.setSearchInNoteOpen);
  const setShareTarget = useUiStore((s) => s.setShareTarget);

  const initials = (user?.nombre ?? "?")
    .split(/\s+/)
    .map((part) => part[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  // El botón Compartir se habilita cuando la nota activa está en una carpeta
  // compartible (HU-35 CA1b).
  const canShare = shareFolder !== null;

  return (
    <header className={styles.topbar}>
      <button
        type="button"
        className={styles.logo}
        onClick={() => router.push("/workspace")}
        title="Micelio"
      >
        <svg viewBox="0 0 32 32" width="22" height="22" aria-hidden className={styles.logoMark}>
          <path
            d="M9 10L23 8M9 10L16 23M23 8L16 23"
            stroke="var(--mic-glow)"
            strokeWidth="1.5"
            opacity="0.55"
            fill="none"
          />
          <circle cx="9" cy="10" r="4" fill="var(--mic-glow)" />
          <circle cx="23" cy="8" r="3" fill="var(--mic-accent)" />
          <circle cx="16" cy="23" r="4" fill="var(--mic-glow)" />
        </svg>
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
          onClick={() => shareFolder && setShareTarget(shareFolder)}
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
