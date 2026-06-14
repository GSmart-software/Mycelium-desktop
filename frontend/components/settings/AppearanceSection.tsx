"use client";

import { Moon, Sun } from "lucide-react";
import { type Tema, usePreferencesStore } from "@/stores/preferencesStore";
import styles from "./Settings.module.css";

// Swatches con la paleta del modo oscuro (predeterminado) de cada tema.
const TEMAS: { value: Tema; nombre: string; canvas: string; mist: string; glow: string; accent: string }[] = [
  { value: "bioluminiscencia", nombre: "Bioluminiscencia", canvas: "#071219", mist: "#0a1a24", glow: "#3DFFC4", accent: "#19E6FF" },
  { value: "cantarela", nombre: "Cantarela", canvas: "#1b1305", mist: "#241a08", glow: "#FFC247", accent: "#C77F2E" },
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
              <span className={styles.swatchPreview} style={{ background: t.canvas }}>
                <span className={styles.swatchDot} style={{ background: t.glow }} />
                <span className={styles.swatchDot} style={{ background: t.accent }} />
                <span className={styles.swatchDot} style={{ background: t.mist }} />
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
