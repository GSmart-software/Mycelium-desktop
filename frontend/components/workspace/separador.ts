import type React from "react";
import { valorDeSeparador, type Separador } from "@/lib/teclado/navegacion";

/**
 * Lo que un divisor de tamaño necesita para el teclado (`FUN-XL-04`, Parte 7):
 * `role="separator"` enfocable con su valor (`aria-valuenow/min/max`) y las
 * flechas de su eje para cambiarlo (con Shift, de a más; Inicio y Fin, al
 * mínimo y al máximo). El arrastre con el puntero lo sigue poniendo cada
 * divisor; esto se suma con `{...propsDeSeparador(...)}`.
 *
 * `aria-orientation` es la de la barra: una barra **vertical** separa columnas y
 * cambia anchos con ← →; una **horizontal**, filas, con ↑ ↓.
 */
export function propsDeSeparador(
  s: Separador & { etiqueta: string; alCambiar: (valor: number) => void; texto?: string },
): React.HTMLAttributes<HTMLDivElement> & { role: "separator"; tabIndex: number } {
  return {
    role: "separator",
    tabIndex: 0,
    "aria-orientation": s.orientacion,
    "aria-label": s.etiqueta,
    "aria-valuenow": Math.round(s.valor),
    "aria-valuemin": Math.round(s.min),
    "aria-valuemax": Math.round(s.max),
    "aria-valuetext": s.texto,
    title: `${s.etiqueta} (flechas; Shift para ir más rápido)`,
    onKeyDown: (e) => {
      if (e.ctrlKey || e.altKey || e.metaKey) return;
      const nuevo = valorDeSeparador(s, e.key, e.shiftKey);
      if (nuevo === null) return;
      e.preventDefault();
      e.stopPropagation();
      if (nuevo !== s.valor) s.alCambiar(nuevo);
    },
  };
}
