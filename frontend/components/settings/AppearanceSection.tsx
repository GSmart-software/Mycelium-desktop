"use client";

import { Moon, Sun } from "lucide-react";
import { type Tema, usePreferencesStore } from "@/stores/preferencesStore";
import styles from "./Settings.module.css";

const TEMAS: { value: Tema; nombre: string; canvas: string; mist: string; glow: string; accent: string }[] = [
  { value: "bioluminiscencia", nombre: "Bioluminiscencia", canvas: "#F1EFE8", mist: "#E1F5EE", glow: "#5DCAA5", accent: "#0F6E56" },
  { value: "cantarela", nombre: "Cantarela", canvas: "#FAF6EE", mist: "#FAEEDA", glow: "#EF9F27", accent: "#854F0B" },
];

/** Sección Apariencia: selector de tema + modo oscuro (HU-12). */
export function AppearanceSection() {
  const tema = usePreferencesStore((s) => s.tema);
  const modoOscuro = usePreferencesStore((s) => s.modoOscuro);
  const setTema = usePreferencesStore((s) => s.setTema);
  const toggleDark = usePreferencesStore((s) => s.toggleDark);

  return (
    <div>
      <div className={styles.field}>
        <span className={styles.label}>Tema</span>
        <div className={styles.swatchGroup}>
          {TEMAS.map((t) => (
            <button
              key={t.value}
              type="button"
              className={`${styles.swatch} ${tema === t.value ? styles.swatchActive : ""}`}
              aria-pressed={tema === t.value}
              onClick={() => setTema(t.value)}
            >
              <span
                className={styles.swatchPreview}
                style={{ background: modoOscuro ? t.accent : t.mist }}
              >
                <span className={styles.swatchDot} style={{ background: t.glow }} />
                <span className={styles.swatchDot} style={{ background: t.accent }} />
                <span className={styles.swatchDot} style={{ background: t.canvas }} />
              </span>
              <span className={styles.swatchName}>{t.nombre}</span>
            </button>
          ))}
        </div>
      </div>

      <div className={styles.toggleRow}>
        <span className={styles.label}>Modo oscuro</span>
        <button type="button" className={styles.toggle} onClick={toggleDark} aria-pressed={modoOscuro}>
          {modoOscuro ? <Moon size={15} aria-hidden /> : <Sun size={15} aria-hidden />}
          {modoOscuro ? "Oscuro" : "Claro"}
        </button>
      </div>
    </div>
  );
}
