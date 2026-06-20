"use client";

import { Check, X } from "lucide-react";
import { usePreferencesStore } from "@/stores/preferencesStore";
import styles from "./Settings.module.css";

/** Sección Editor: comportamiento de las pestañas. */
export function EditorSection() {
  const previewTabs = usePreferencesStore((s) => s.prefs.previewTabs);
  const autoCloseBrackets = usePreferencesStore((s) => s.prefs.autoCloseBrackets);
  const showFileTitle = usePreferencesStore((s) => s.prefs.showFileTitle);
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

      <div className={styles.toggleRow}>
        <span className={styles.label}>Autocerrar pares</span>
        <button
          type="button"
          className={styles.toggle}
          onClick={() => setPref("autoCloseBrackets", !autoCloseBrackets)}
          aria-pressed={autoCloseBrackets}
        >
          {autoCloseBrackets ? <Check size={15} aria-hidden /> : <X size={15} aria-hidden />}
          {autoCloseBrackets ? "Activado" : "Desactivado"}
        </button>
      </div>
      <p className={styles.hint}>
        Al escribir <code>(</code>, <code>[</code>, <code>{"{"}</code>, <code>&quot;</code>,{" "}
        <code>&apos;</code>, <code>`</code>, <code>*</code> o <code>_</code> se inserta también
        el símbolo de cierre. Con texto seleccionado, lo envuelve en vez de
        reemplazarlo. Desactivá esta opción para escribir los símbolos tal cual.
      </p>

      <div className={styles.toggleRow}>
        <span className={styles.label}>Mostrar título del archivo</span>
        <button
          type="button"
          className={styles.toggle}
          onClick={() => setPref("showFileTitle", !showFileTitle)}
          aria-pressed={showFileTitle}
        >
          {showFileTitle ? <Check size={15} aria-hidden /> : <X size={15} aria-hidden />}
          {showFileTitle ? "Activado" : "Desactivado"}
        </button>
      </div>
      <p className={styles.hint}>
        Muestra el nombre del archivo como título centrado en la parte superior
        de todas las vistas. No es un encabezado <code>#</code> del documento.
        Desactivá esta opción para ocultarlo.
      </p>
    </div>
  );
}
