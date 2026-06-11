"use client";

import { X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useAuthStore } from "@/stores/authStore";
import { useUiStore } from "@/stores/uiStore";
import styles from "./SettingsDrawer.module.css";

/**
 * Settings drawer deslizable desde el lateral derecho (HU-28 CA4).
 * Las secciones Apariencia / Tipografía / CSS personalizado llegan en la
 * Fase 8 (HU-12/13/14/15/34).
 */
export function SettingsDrawer() {
  const router = useRouter();
  const settingsOpen = useUiStore((s) => s.settingsOpen);
  const setSettingsOpen = useUiStore((s) => s.setSettingsOpen);
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);

  useEffect(() => {
    if (!settingsOpen) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setSettingsOpen(false);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [settingsOpen, setSettingsOpen]);

  if (!settingsOpen) return null;

  return (
    <>
      <div className={styles.overlay} onClick={() => setSettingsOpen(false)} />
      <aside className={styles.drawer} aria-label="Configuración">
        <header className={styles.header}>
          <h2 className={styles.title}>Configuración</h2>
          <button
            type="button"
            className={styles.close}
            aria-label="Cerrar configuración"
            onClick={() => setSettingsOpen(false)}
          >
            <X size={18} aria-hidden />
          </button>
        </header>

        <section className={styles.section}>
          <h3 className={styles.sectionTitle}>Cuenta</h3>
          <p className={styles.row}>
            <span className={styles.rowLabel}>Nombre</span>
            <span>{user?.nombre}</span>
          </p>
          <p className={styles.row}>
            <span className={styles.rowLabel}>Email</span>
            <span>{user?.email}</span>
          </p>
          <button
            type="button"
            className={styles.logout}
            onClick={() =>
              void logout().then(() => {
                setSettingsOpen(false);
                router.replace("/login");
              })
            }
          >
            Cerrar sesión
          </button>
        </section>

        <section className={styles.section}>
          <h3 className={styles.sectionTitle}>Apariencia</h3>
          <p className={styles.placeholder}>
            Temas, modo oscuro, tipografía y CSS personalizado llegan en la
            Fase 8.
          </p>
        </section>
      </aside>
    </>
  );
}
