"use client";

import { nombreTecla, textoAtajo, type Atajo } from "@/lib/comandos/atajos";
import { useDistribucion } from "@/lib/comandos/distribucion";
import styles from "./TeclasAtajo.module.css";

/**
 * Un atajo dibujado como teclas («Ctrl» «Shift» «P»), con el carácter que el
 * usuario ve en su teclado (`distribucion.ts`). Lo usan la hoja de atajos y
 * Configuración → Atajos de teclado. Clase global `mic-atajo` (y `mic-tecla`
 * en cada tecla) para estilarlo desde un snippet.
 */
export function TeclasAtajo({ atajo }: { atajo: Atajo }) {
  const distribucion = useDistribucion();
  const partes = [
    atajo.ctrl && "Ctrl",
    atajo.alt && "Alt",
    atajo.shift && "Shift",
    nombreTecla(atajo.code, distribucion),
  ].filter((p): p is string => !!p);
  return (
    <span className={`${styles.atajo} mic-atajo`} aria-label={textoAtajo(atajo, distribucion)}>
      {partes.map((p, i) => (
        <kbd key={i} className={`${styles.tecla} mic-tecla`} aria-hidden>
          {p}
        </kbd>
      ))}
    </span>
  );
}
