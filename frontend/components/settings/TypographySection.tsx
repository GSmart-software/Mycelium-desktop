"use client";

import { EDITOR_FONTS, PREVIEW_FONTS, usePreferencesStore } from "@/stores/preferencesStore";
import styles from "./Settings.module.css";

/** Sección Tipografía: fuente y tamaño de editor y preview (HU-14). */
export function TypographySection() {
  const prefs = usePreferencesStore((s) => s.prefs);
  const setPref = usePreferencesStore((s) => s.setPref);

  return (
    <div>
      <div className={styles.field}>
        <label className={styles.label} htmlFor="editorFont">Fuente del editor</label>
        <select
          id="editorFont"
          className={styles.select}
          value={prefs.editorFont}
          onChange={(e) => setPref("editorFont", e.target.value)}
        >
          {EDITOR_FONTS.map((f) => (
            <option key={f.label} value={f.value}>{f.label}</option>
          ))}
        </select>
      </div>

      <div className={styles.field}>
        <label className={styles.label} htmlFor="editorSize">Tamaño del editor</label>
        <div className={styles.rangeRow}>
          <input
            id="editorSize"
            type="range"
            min={12}
            max={24}
            value={prefs.editorSize}
            className={styles.range}
            onChange={(e) => setPref("editorSize", Number(e.target.value))}
          />
          <span className={styles.rangeValue}>{prefs.editorSize}px</span>
        </div>
      </div>

      <div className={styles.field}>
        <label className={styles.label} htmlFor="previewFont">Fuente del preview</label>
        <select
          id="previewFont"
          className={styles.select}
          value={prefs.previewFont}
          onChange={(e) => setPref("previewFont", e.target.value)}
        >
          {PREVIEW_FONTS.map((f) => (
            <option key={f.label} value={f.value}>{f.label}</option>
          ))}
        </select>
      </div>

      <div className={styles.field}>
        <label className={styles.label} htmlFor="previewSize">Tamaño del preview</label>
        <div className={styles.rangeRow}>
          <input
            id="previewSize"
            type="range"
            min={12}
            max={24}
            value={prefs.previewSize}
            className={styles.range}
            onChange={(e) => setPref("previewSize", Number(e.target.value))}
          />
          <span className={styles.rangeValue}>{prefs.previewSize}px</span>
        </div>
      </div>
    </div>
  );
}
