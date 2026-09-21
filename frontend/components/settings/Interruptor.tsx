"use client";

import { useId, type ReactNode } from "react";
import styles from "./Settings.module.css";

interface Props {
  /** Rótulo del ajuste. Es también lo que indexa el buscador de la ventana. */
  etiqueta: string;
  valor: boolean;
  onChange: (valor: boolean) => void;
  disabled?: boolean;
  /** Explicación bajo la fila. Va siempre en medida de lectura. */
  ayuda?: ReactNode;
  /** Clase extra para la fila (espaciados propios de una sección). */
  className?: string;
}

/**
 * Un ajuste de sí o no. Existe para que **haya uno solo**: hasta la crítica de
 * Configuración (2026-09-20) convivían dos, un botón con la palabra «Activado»
 * (nueve ajustes) y esta píldora (tres), con tres tratamientos de foco entre
 * los dos. Con dos formas para la misma decisión la columna de la derecha deja
 * de poder leerse de un vistazo, que es justo lo que una lista de ajustes tiene
 * que permitir.
 *
 * El rótulo no es un `<label>` envolvente: la píldora ya es el control y el
 * texto queda a la izquierda, así que se atan con `aria-labelledby`.
 */
export function Interruptor({ etiqueta, valor, onChange, disabled, ayuda, className }: Props) {
  const id = useId();
  return (
    <>
      <div className={className ? `${styles.toggleRow} ${className}` : styles.toggleRow}>
        <span className={styles.label} id={id}>
          {etiqueta}
        </span>
        <label className={styles.switch}>
          <input
            type="checkbox"
            checked={valor}
            disabled={disabled}
            aria-labelledby={id}
            onChange={(e) => onChange(e.target.checked)}
          />
          <span className={styles.switchTrack} aria-hidden />
        </label>
      </div>
      {ayuda && <p className={styles.hint}>{ayuda}</p>}
    </>
  );
}
