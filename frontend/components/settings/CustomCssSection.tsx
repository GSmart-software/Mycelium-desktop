"use client";

import { useRef, useState } from "react";
import { usePreferencesStore } from "@/stores/preferencesStore";
import { CssEditor } from "./CssEditor";
import styles from "./Settings.module.css";

const WARN_BYTES = 50 * 1024; // HU-15 CA5

/** Sección CSS personalizado: editor + toggle + import/export (HU-13/15). */
export function CustomCssSection() {
  const customCss = usePreferencesStore((s) => s.customCss);
  const savedCss = usePreferencesStore((s) => s.savedCss);
  const cssActivo = usePreferencesStore((s) => s.prefs.cssActivo);
  const setCustomCss = usePreferencesStore((s) => s.setCustomCss);
  const setPref = usePreferencesStore((s) => s.setPref);
  const saveCss = usePreferencesStore((s) => s.saveCss);

  const fileRef = useRef<HTMLInputElement>(null);
  const [saved, setSaved] = useState(false);
  // Importación en preview (temporal, sin guardar) — HU-15 CA3/CA4
  const [importing, setImporting] = useState<{ prev: string; warn: boolean } | null>(null);

  const dirty = customCss !== savedCss;

  const handleSave = async () => {
    await saveCss();
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  };

  const handleDownload = () => {
    const blob = new Blob([customCss], { type: "text/css" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "micelio-tema.css";
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleFile = async (file: File) => {
    const text = await file.text();
    setImporting({ prev: customCss, warn: file.size > WARN_BYTES });
    setCustomCss(text); // preview en vivo
  };

  return (
    <div>
      <div className={styles.toggleRow}>
        <span className={styles.label}>CSS personalizado</span>
        <button
          type="button"
          className={styles.toggle}
          aria-pressed={cssActivo}
          onClick={() => setPref("cssActivo", !cssActivo)}
        >
          {cssActivo ? "Activado" : "Desactivado"}
        </button>
      </div>

      <div className={styles.field}>
        <CssEditor value={customCss} onChange={setCustomCss} />
      </div>

      {importing && (
        <div className={styles.field}>
          {importing.warn && (
            <p className={styles.cssPreviewNote}>
              El archivo supera 50 KB. Podés continuar igual.
            </p>
          )}
          <p className={styles.cssPreviewNote}>
            Previsualizando el CSS importado (sin guardar).
          </p>
          <div className={styles.btnRow}>
            <button
              type="button"
              className={styles.primaryBtn}
              onClick={() => setImporting(null)}
            >
              Aplicar import
            </button>
            <button
              type="button"
              className={styles.secondaryBtn}
              onClick={() => {
                setCustomCss(importing.prev);
                setImporting(null);
              }}
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

      <div className={styles.btnRow}>
        <button
          type="button"
          className={styles.primaryBtn}
          disabled={!dirty}
          onClick={handleSave}
        >
          Guardar CSS
        </button>
        <button type="button" className={styles.secondaryBtn} onClick={handleDownload}>
          Descargar CSS
        </button>
        <button
          type="button"
          className={styles.secondaryBtn}
          onClick={() => fileRef.current?.click()}
        >
          Importar .css
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".css,text/css"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void handleFile(file);
            e.target.value = "";
          }}
        />
      </div>
      {saved && <p className={styles.feedback}>CSS guardado.</p>}
    </div>
  );
}
