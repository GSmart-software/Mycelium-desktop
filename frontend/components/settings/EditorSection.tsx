"use client";

import { Check, X } from "lucide-react";
import { usePreferencesStore } from "@/stores/preferencesStore";
import styles from "./Settings.module.css";

/** Sección Editor: comportamiento de las pestañas. */
export function EditorSection() {
  const previewTabs = usePreferencesStore((s) => s.prefs.previewTabs);
  const setPref = usePreferencesStore((s) => s.setPref);

  return (
    <div>
      <div className={styles.toggleRow}>
        <span className={styles.label}>Pestañas de previsualización</span>
        <button
          type="button"
          className={styles.toggle}
          onClick={() => setPref("previewTabs", !previewTabs)}
          aria-pressed={previewTabs}
        >
          {previewTabs ? <Check size={15} aria-hidden /> : <X size={15} aria-hidden />}
          {previewTabs ? "Activado" : "Desactivado"}
        </button>
      </div>
      <p className={styles.hint}>
        Al abrir un archivo que solo estás viendo (sin editarlo), reemplaza esa
        pestaña en vez de abrir una nueva. La pestaña se fija al editarla o con
        doble clic. Desactivá esta opción para abrir siempre una pestaña nueva.
      </p>
    </div>
  );
}
