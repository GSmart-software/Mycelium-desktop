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

type SettingsTab =
  | "cuenta"
  | "apariencia"
  | "tipografia"
  | "editor"
  | "grafo"
  | "css"
  | "vault";

const TABS: { id: SettingsTab; label: string }[] = [
  { id: "cuenta", label: "Cuenta" },
  { id: "apariencia", label: "Apariencia" },
  { id: "tipografia", label: "Tipografía" },
  { id: "editor", label: "Editor" },
  { id: "grafo", label: "Grafo" },
  { id: "css", label: "CSS" },
  { id: "vault", label: "Vault" },
];

/**
 * Settings drawer (HU-28 CA4) con secciones Cuenta (HU-34), Apariencia (HU-12),
 * Tipografía (HU-14) y CSS personalizado (HU-13/15).
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
          {tab === "apariencia" && <AppearanceSection />}
          {tab === "tipografia" && <TypographySection />}
          {tab === "editor" && <EditorSection />}
          {tab === "grafo" && <GraphSection />}
          {tab === "css" && <CustomCssSection />}
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
