"use client";

import { X } from "lucide-react";
import { useEffect, useState } from "react";
import { AppearanceSection } from "@/components/settings/AppearanceSection";
import { CustomCssSection } from "@/components/settings/CustomCssSection";
import { EditorSection } from "@/components/settings/EditorSection";
import { GraphSection } from "@/components/settings/GraphSection";
import { TerminalSection } from "@/components/settings/TerminalSection";
import { TypographySection } from "@/components/settings/TypographySection";
import { UpdaterSection } from "@/components/settings/UpdaterSection";
import { VaultSection } from "@/components/settings/VaultSection";
import { APP_VERSION } from "@/lib/version";
import { useUiStore } from "@/stores/uiStore";
import { useUpdaterStore } from "@/stores/updaterStore";
import styles from "./SettingsDrawer.module.css";

/**
 * Clics seguidos sobre el número de versión que activan el modo avanzado
 * (`FUN-M-16`). Es el gesto de Android y Chrome para el modo desarrollador:
 * imposible de encontrar por accidente, trivial de recordar, y no agrega
 * ninguna superficie visible a la interfaz.
 */
const CLICS_MODO_AVANZADO = 7;

type SettingsTab = "apariencia" | "editor" | "vault";

const TABS: { id: SettingsTab; label: string }[] = [
  { id: "apariencia", label: "Apariencia" },
  { id: "editor", label: "Editor" },
  { id: "vault", label: "Vault" },
];

/**
 * Settings drawer (HU-28 CA4). Pestañas agrupadas: Apariencia (tema HU-12 +
 * tipografía HU-14 + snippets CSS HU-13/15), Editor (pestañas + grafo) y Vault.
 */
export function SettingsDrawer() {
  const settingsOpen = useUiStore((s) => s.settingsOpen);
  const setSettingsOpen = useUiStore((s) => s.setSettingsOpen);
  const [tab, setTab] = useState<SettingsTab>("apariencia");
  const avanzado = useUpdaterStore((s) => s.estado?.avanzado ?? false);
  const [clics, setClics] = useState(0);
  // Se mantiene montado durante la animación de salida para que el panel se
  // repliegue con la misma animación con que aparece (DEF-020).
  const [render, setRender] = useState(false);
  const [closing, setClosing] = useState(false);

  const close = () => setSettingsOpen(false);

  useEffect(() => {
    if (settingsOpen) {
      setRender(true);
      setClosing(false);
      setClics(0); // los siete clics tienen que hacerse en una misma apertura
    } else {
      setClosing(true); // dispara la animación de salida (si está montado)
    }
  }, [settingsOpen]);

  useEffect(() => {
    if (!settingsOpen) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setSettingsOpen(false);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [settingsOpen, setSettingsOpen]);

  if (!render) return null;

  return (
    <>
      <div
        className={`${styles.overlay} ${closing ? styles.overlayClosing : ""}`}
        onClick={close}
      />
      <aside
        className={`${styles.drawer} ${closing ? styles.drawerClosing : ""}`}
        aria-label="Configuración"
        // Al terminar la animación de salida del propio panel, desmontar.
        onAnimationEnd={(e) => {
          if (e.target === e.currentTarget && closing) setRender(false);
        }}
      >
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
              <h3 className={styles.groupTitle}>Terminal</h3>
              <TerminalSection />
            </>
          )}
          {tab === "vault" && (
            <>
              <VaultSection />
              <h3 className={styles.groupTitle}>Actualizaciones</h3>
              <UpdaterSection />
            </>
          )}
        </div>

        {/* Siete clics acá activan (o apagan) el modo avanzado: FUN-M-16. El
            contador se reinicia al cerrar el panel, así que hay que hacerlos
            seguidos y a propósito. */}
        <footer
          className={styles.footer}
          onClick={() => {
            const siguiente = clics + 1;
            if (siguiente < CLICS_MODO_AVANZADO) {
              setClics(siguiente);
              return;
            }
            setClics(0);
            setTab("vault");
            void useUpdaterStore.getState().setAvanzado(!avanzado);
          }}
        >
          Mycelium v{APP_VERSION}
          {avanzado && " · modo avanzado"}
        </footer>
      </aside>
    </>
  );
}
