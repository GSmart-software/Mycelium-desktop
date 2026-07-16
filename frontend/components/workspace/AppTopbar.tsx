"use client";

import { Search, Share2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useUiStore } from "@/stores/uiStore";
import styles from "./AppTopbar.module.css";

/**
 * AppTopbar del workspace (HU-38): logo, búsqueda en la nota activa y
 * botón Compartir. Siempre visible.
 */
export function AppTopbar({
  shareFolder,
}: {
  shareFolder: { id: string; nombre: string } | null;
}) {
  const router = useRouter();
  const setShareTarget = useUiStore((s) => s.setShareTarget);

  // El botón Compartir se habilita cuando la nota activa está en una carpeta
  // compartible (HU-35 CA1b).
  const canShare = shareFolder !== null;

  return (
    <header className={styles.topbar}>
      <button
        type="button"
        className={styles.logo}
        onClick={() => router.push("/workspace")}
        title="Mycelium"
      >
        <svg viewBox="0 0 32 32" width="27" height="27" aria-hidden className={styles.logoMark}>
          <path
            d="M9 10L23 8M9 10L16 23M23 8L16 23"
            stroke="var(--mic-glow)"
            strokeWidth="1.5"
            opacity="0.55"
            fill="none"
          />
          <circle cx="9" cy="10" r="4" fill="var(--mic-glow)" />
          <circle cx="23" cy="8" r="3" fill="var(--mic-accent)" />
          <circle cx="16" cy="23" r="4" fill="var(--mic-callout-info-border)" />
        </svg>
        <span className={styles.logoFull}>Mycelium</span>
        <span className={styles.logoCompact} aria-hidden>M</span>
      </button>

      <div className={styles.searchBar}>
        <Search size={14} aria-hidden className={styles.searchIcon} />
        <input
          className={styles.searchInput}
          placeholder="Buscar en Mycelium…"
          aria-label="Buscar"
        />
      </div>

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
      </div>
    </header>
  );
}
