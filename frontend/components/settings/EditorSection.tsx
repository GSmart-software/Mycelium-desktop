"use client";

import {
  anchoTabValido,
  TAB_DEFECTO,
  TAB_MAX,
  TAB_MIN,
  usePreferencesStore,
} from "@/stores/preferencesStore";
import { usePrefVault, usePrefsVaultStore } from "@/stores/prefsVaultStore";
import { refrescarCorrector } from "@/lib/editor/ortografia";
import { DiccionariosCorrector } from "./DiccionariosCorrector";
import { Explicacion } from "./Explicacion";
import { Interruptor } from "./Interruptor";
import styles from "./Settings.module.css";

/** Sección Editor: comportamiento de las pestañas. */
export function EditorSection() {
  const previewTabs = usePreferencesStore((s) => s.prefs.previewTabs);
  const autoCloseBrackets = usePreferencesStore((s) => s.prefs.autoCloseBrackets);
  const correctorOrtografico = usePreferencesStore((s) => s.prefs.correctorOrtografico);
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
            className={`${styles.select} ${styles.numero}`}
            value={tabWidth}
            // Se guarda lo que se teclea para poder borrar y reescribir; el valor
            // se acota al salir del campo, no en cada tecla (si no, escribir "12"
            // se convertiría en "1" en cuanto se pulsa el 1).
            onChange={(e) => setPref("tabWidth", Number(e.target.value))}
            onBlur={(e) => setPref("tabWidth", anchoTabValido(e.target.value))}
          />
          <span className={styles.rangeValue}>espacios</span>
        </div>
        <Explicacion
          detalle={
            <>
              <p>
                <strong>Al leer</strong> cambia la sangría de las listas y los tabuladores de
                todos tus documentos al instante, sin editarlos. <strong>Al escribir</strong> es
                lo que inserta la tecla <kbd>Tab</kbd>. Entre {TAB_MIN} y {TAB_MAX}; por defecto{" "}
                {TAB_DEFECTO}.
              </p>
              <p>
                En la vista en vivo, la sangría <em>ya escrita</em> con espacios no se reescala:
                dos espacios ocupan dos espacios. Para cambiarla de verdad hay que reindentar el
                documento.
              </p>
            </>
          }
        >
          Cuánto sangra un nivel de indentación, al leer y al escribir.
        </Explicacion>
      </div>

      <Interruptor
        etiqueta="Pestañas de previsualización"
        valor={previewTabs}
        onChange={(v) => setPref("previewTabs", v)}
        ayuda="Abrir un archivo sin editarlo reemplaza esa pestaña en vez de abrir otra."
        detalle="La pestaña se fija al editarla o con doble clic. Desactivá esta opción para abrir siempre una pestaña nueva."
      />

      <Interruptor
        etiqueta="Ícono del tipo en las pestañas"
        valor={iconosEnPestanas}
        onChange={(v) => setPref("iconosEnPestanas", v)}
        ayuda="Nota, dibujo, lienzo, tabla o consola, junto al nombre."
        detalle="También marca los archivos que Mycelium no indexa. Apagalo si preferís que el título ocupe todo el ancho de la pestaña."
      />

      <Interruptor
        etiqueta="Autocerrar pares"
        valor={autoCloseBrackets}
        onChange={(v) => setPref("autoCloseBrackets", v)}
        ayuda="Al abrir un paréntesis, corchete o comilla se escribe también el de cierre."
        detalle={
          <>
            Vale para <code>(</code>, <code>[</code>, <code>{"{"}</code>, <code>&quot;</code>,{" "}
            <code>&apos;</code>, <code>`</code>, <code>*</code> y <code>_</code>. Con texto
            seleccionado, lo envuelve en vez de reemplazarlo. Desactivá esta opción para
            escribir los símbolos tal cual.
          </>
        }
      />

      <Interruptor
        etiqueta="Corrector ortográfico"
        valor={correctorOrtografico}
        onChange={(v) => {
          setPref("correctorOrtografico", v);
          // Los editores abiertos leen la preferencia al actualizarse: se les
          // avisa ya, para que el cambio se vea sin tener que escribir. Al
          // apagarlo, además, se termina el worker del corrector.
          refrescarCorrector(v);
        }}
        ayuda="Subraya las palabras mal escritas; clic derecho para ver sugerencias."
        detalle="También revisa lo que ya estaba escrito al abrir la nota. Desde el clic derecho podés agregar la palabra al diccionario del vault o ignorarla. El código, los enlaces, las etiquetas, las fórmulas y el frontmatter no se corrigen."
      />
      <DiccionariosCorrector />

      <Interruptor
        etiqueta="Números de línea"
        valor={numerosDeLinea}
        disabled={!hayVault}
        onChange={(v) => setPrefVault("numerosDeLinea", v)}
        ayuda={
          <>
            Al costado del texto, en las vistas de edición. Es un ajuste{" "}
            <strong>de este vault</strong>.{!hayVault && " Abrí un vault para poder cambiarlo."}
          </>
        }
        detalle={
          <>
            <p>
              Se guarda dentro de la carpeta del vault, no en tu usuario: viaja con él y cada
              vault puede tener el suyo. Desactivado por defecto.
            </p>
            <p>
              En la vista de <strong>lectura</strong> no aparecen: ahí un párrafo de varias
              líneas se reajusta al ancho y se convierte en un solo bloque, así que no hay
              dónde poner el número de cada una sin inventarlo.
            </p>
          </>
        }
      />

      <Interruptor
        etiqueta="Mostrar título del archivo"
        valor={showFileTitle}
        onChange={(v) => setPref("showFileTitle", v)}
        ayuda="El nombre del archivo como título, arriba de todas las vistas."
        detalle={
          <>
            No es un encabezado <code>#</code> del documento: es el nombre del archivo, y
            escribir en él lo renombra. Desactivá esta opción para ocultarlo.
          </>
        }
      />
    </div>
  );
}
