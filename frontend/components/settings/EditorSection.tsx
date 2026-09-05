"use client";

import { Check, X } from "lucide-react";
import {
  anchoTabValido,
  TAB_DEFECTO,
  TAB_MAX,
  TAB_MIN,
  usePreferencesStore,
} from "@/stores/preferencesStore";
import { usePrefVault, usePrefsVaultStore } from "@/stores/prefsVaultStore";
import styles from "./Settings.module.css";

/** Sección Editor: comportamiento de las pestañas. */
export function EditorSection() {
  const previewTabs = usePreferencesStore((s) => s.prefs.previewTabs);
  const autoCloseBrackets = usePreferencesStore((s) => s.prefs.autoCloseBrackets);
  const showFileTitle = usePreferencesStore((s) => s.prefs.showFileTitle);
  const iconosEnPestanas = usePreferencesStore((s) => s.prefs.iconosEnPestanas);
  const tabWidth = usePreferencesStore((s) => s.prefs.tabWidth);
  const setPref = usePreferencesStore((s) => s.setPref);
  // Números de línea: preferencia DEL VAULT (`FUN-M-28`), no del usuario. Sin un
  // vault abierto no hay dónde guardarla, así que el control se desactiva en vez
  // de aceptar un cambio que se perdería.
  const numerosDeLinea = usePrefVault("numerosDeLinea");
  const setPrefVault = usePrefsVaultStore((s) => s.set);
  // «Hay vault» se le pregunta al propio almacén de preferencias y no a la
  // sesión: lo que decide si el interruptor sirve no es que haya un vault
  // abierto, sino que ya haya **dónde escribir**. Además es lo único que las dos
  // versiones responden igual — en web no existe `vaultSessionStore`.
  const hayVault = usePrefsVaultStore((s) => s.ruta) !== null;

  return (
    <div>
      <div className={styles.field}>
        <label className={styles.label} htmlFor="tabWidth">Ancho de tabulación</label>
        <div className={styles.rangeRow}>
          <input
            id="tabWidth"
            type="number"
            min={TAB_MIN}
            max={TAB_MAX}
            step={1}
            className={styles.select}
            value={tabWidth}
            // Se guarda lo que se teclea para poder borrar y reescribir; el valor
            // se acota al salir del campo, no en cada tecla (si no, escribir "12"
            // se convertiría en "1" en cuanto se pulsa el 1).
            onChange={(e) => setPref("tabWidth", Number(e.target.value))}
            onBlur={(e) => setPref("tabWidth", anchoTabValido(e.target.value))}
          />
          <span className={styles.rangeValue}>espacios</span>
        </div>
      </div>
      <p className={styles.hint}>
        Cuánto sangra un nivel de indentación. <strong>Al leer</strong> cambia la
        sangría de las listas y los tabuladores de todos tus documentos al instante,
        sin editarlos. <strong>Al escribir</strong> es lo que inserta la tecla{" "}
        <kbd>Tab</kbd>. Entre {TAB_MIN} y {TAB_MAX}; por defecto {TAB_DEFECTO}.
      </p>
      <p className={styles.hint}>
        En la vista en vivo, la sangría <em>ya escrita</em> con espacios no se
        reescala: dos espacios ocupan dos espacios. Para cambiarla de verdad hay que
        reindentar el documento.
      </p>

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
        <span className={styles.label}>Ícono del tipo en las pestañas</span>
        <button
          type="button"
          className={styles.toggle}
          onClick={() => setPref("iconosEnPestanas", !iconosEnPestanas)}
          aria-pressed={iconosEnPestanas}
        >
          {iconosEnPestanas ? <Check size={15} aria-hidden /> : <X size={15} aria-hidden />}
          {iconosEnPestanas ? "Activado" : "Desactivado"}
        </button>
      </div>
      <p className={styles.hint}>
        Junto al nombre, el ícono del tipo de documento: nota, dibujo, lienzo,
        tabla, consola o un archivo que Mycelium no indexa. Apagalo si preferís
        que el título ocupe todo el ancho de la pestaña.
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
        <span className={styles.label}>Números de línea</span>
        <button
          type="button"
          className={styles.toggle}
          disabled={!hayVault}
          onClick={() => setPrefVault("numerosDeLinea", !numerosDeLinea)}
          aria-pressed={numerosDeLinea}
        >
          {numerosDeLinea ? <Check size={15} aria-hidden /> : <X size={15} aria-hidden />}
          {numerosDeLinea ? "Activado" : "Desactivado"}
        </button>
      </div>
      <p className={styles.hint}>
        Muestra el número de cada línea al costado del texto, como en el visor de
        archivos de código. Desactivado por defecto.{" "}
        <strong>Este ajuste es de este vault</strong>, no tuyo: se guarda dentro
        de su carpeta, así que viaja con él y cada vault puede tener el suyo.
        {!hayVault && " Abrí un vault para poder cambiarlo."}
      </p>
      <p className={styles.hint}>
        Solo en las vistas de <strong>edición</strong>, donde cada línea del
        archivo es una línea en pantalla. En la de <strong>lectura</strong> no
        aparecen: ahí un párrafo de varias líneas se reajusta al ancho y se
        convierte en un solo bloque, así que no hay dónde poner el número de
        cada una sin inventarlo.
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
