"use client";

import { LogOut, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { AccountSection } from "@/components/settings/AccountSection";
import { AppearanceSection } from "@/components/settings/AppearanceSection";
import { CustomCssSection } from "@/components/settings/CustomCssSection";
import { EditorSection } from "@/components/settings/EditorSection";
import { GraphSection } from "@/components/settings/GraphSection";
import { TypographySection } from "@/components/settings/TypographySection";
import { VaultSection } from "@/components/settings/VaultSection";
import { useAuthStore } from "@/stores/authStore";
import { useUiStore } from "@/stores/uiStore";
import styles from "./SettingsDrawer.module.css";

type SettingsTab = "cuenta" | "apariencia" | "editor" | "vault";

const TABS: { id: SettingsTab; label: string }[] = [
  { id: "cuenta", label: "Cuenta" },
  { id: "apariencia", label: "Apariencia" },
  { id: "editor", label: "Editor" },
  { id: "vault", label: "Vault" },
];

/**
 * Settings drawer (HU-28 CA4). Pestañas agrupadas: Cuenta (HU-34), Apariencia
 * (tema HU-12 + tipografía HU-14 + snippets CSS HU-13/15), Editor (pestañas +
 * grafo) y Vault.
 */
export function SettingsDrawer() {
  const router = useRouter();
  const settingsOpen = useUiStore((s) => s.settingsOpen);
  const setSettingsOpen = useUiStore((s) => s.setSettingsOpen);
  const logout = useAuthStore((s) => s.logout);
  const [tab, setTab] = useState<SettingsTab>("cuenta");

  const close = () => setSettingsOpen(false);

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
      <div className={styles.overlay} onClick={close} />
      <aside className={styles.drawer} aria-label="Configuración">
        <header className={styles.header}>
          <h2 className={styles.title}>Configuración</h2>
          <button
            type="button"
            className={styles.close}
            aria-label="Cerrar configuración"
            onClick={close}
          >
            <X size={18} aria-hidden />
          </button>
        </header>

        <nav className={styles.tabs} role="tablist">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              className={`${styles.tab} ${tab === t.id ? styles.tabActive : ""}`}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </nav>

        <div className={styles.body}>
          {tab === "cuenta" && <AccountSection onClose={close} />}
          {tab === "apariencia" && (
            <>
              <AppearanceSection />
              <h3 className={styles.groupTitle}>Tipografía</h3>
              <TypographySection />
              <h3 className={styles.groupTitle}>Snippets CSS</h3>
              <CustomCssSection />
            </>
          )}
          {tab === "editor" && (
            <>
              <EditorSection />
              <h3 className={styles.groupTitle}>Grafo</h3>
              <GraphSection />
            </>
          )}
          {tab === "vault" && <VaultSection />}
        </div>

        <button
          type="button"
          className={styles.logout}
          onClick={() =>
            void logout().then(() => {
              close();
              router.replace("/login");
            })
          }
        >
          <LogOut size={15} aria-hidden /> Cerrar sesión
        </button>
      </aside>
    </>
  );
}
