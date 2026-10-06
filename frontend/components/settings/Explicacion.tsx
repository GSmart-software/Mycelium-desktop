"use client";

import { ChevronDown } from "lucide-react";
import { useId, useState, type ReactNode } from "react";
import styles from "./Settings.module.css";

interface Props {
  /**
   * La frase que se ve siempre: qué hace el ajuste, en una línea. Es lo que se
   * lee de un vistazo al recorrer la ventana.
   */
  children: ReactNode;
  /**
   * El resto de la explicación —matices, casos borde, por qué—, plegado detrás
   * de «Más». Puede llevar varios párrafos (`<p>`).
   */
  detalle?: ReactNode;
}

/**
 * La explicación de un ajuste de Configuración (`FUN-M-41`): una línea visible
 * y el resto plegado. Hasta acá cada ajuste llevaba uno o dos párrafos siempre
 * abiertos y la ventana se leía como un manual; el texto estaba bien, pero
 * tapaba los controles. Lo que avisa de algo que puede perder datos NO va acá:
 * va en `.warn`, siempre visible.
 *
 * El «Más» es un botón de divulgación (`aria-expanded` + `aria-controls`), así
 * que se abre con el teclado y el lector de pantalla anuncia el estado. Cada
 * explicación se abre por su cuenta: abrir una no pliega las demás.
 */
export function Explicacion({ children, detalle }: Props) {
  const [abierta, setAbierta] = useState(false);
  const id = useId();
  return (
    <>
      <p className={styles.hint}>
        {children}
        {detalle && (
          <>
            {" "}
            <button
              type="button"
              className={styles.mas}
              aria-expanded={abierta}
              aria-controls={id}
              onClick={() => setAbierta((a) => !a)}
            >
              {abierta ? "Menos" : "Más"}
              <ChevronDown size={12} aria-hidden className={abierta ? styles.masAbierto : undefined} />
            </button>
          </>
        )}
      </p>
      {detalle && abierta && (
        <div id={id} className={styles.hintDetalle}>
          {detalle}
        </div>
      )}
    </>
  );
}
