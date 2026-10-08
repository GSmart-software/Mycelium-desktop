"use client";

import { EDITOR_FONTS, PREVIEW_FONTS, usePreferencesStore } from "@/stores/preferencesStore";
import { Explicacion } from "./Explicacion";
import styles from "./Settings.module.css";

/**
 * Sección Tipografía: fuente y tamaño de editor y preview (HU-14). Con su
 * explicación plegable en cada ajuste, como el resto de Configuración
 * (`FUN-M-41`; se la sumó `DEF-150 n`).
 */
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
        <Explicacion
          detalle={
            <p>
              Se usa en la vista en vivo, en el modo crudo y en la mitad que se edita del modo
              dividido, incluido el título de la nota. Una fuente monoespaciada alinea columnas y
              sangrías; una proporcional se lee más como el texto final.
            </p>
          }
        >
          La letra con la que escribís.
        </Explicacion>
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
        <Explicacion
          detalle={
            <p>
              Entre 12 y 24 píxeles; por defecto 16. Cambia solo el texto de la nota, no los
              menús ni los paneles.
            </p>
          }
        >
          El tamaño del texto mientras escribís.
        </Explicacion>
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
        <Explicacion
          detalle={
            <p>
              Se usa en el modo lectura, en la mitad renderizada del modo dividido y en el texto
              de las tarjetas de un lienzo (mientras escribís en una, va la del editor). El
              código sigue en monoespaciada.
            </p>
          }
        >
          La letra con la que se leen las notas ya renderizadas.
        </Explicacion>
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
        <Explicacion
          detalle={
            <p>
              Entre 12 y 24 píxeles; por defecto 16. Es independiente del tamaño del editor: podés
              escribir chico y leer grande.
            </p>
          }
        >
          El tamaño del texto en el modo lectura.
        </Explicacion>
      </div>
    </div>
  );
}
