"use client";

import { forwardRef, useCallback, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import styles from "./graficas.module.css";

/** Lo que muestra el tooltip de una marca: un título, el valor y una nota tenue. */
export type Detalle = { titulo: string; valor?: string; nota?: string };

type Api = { mostrar: (x: number, y: number, d: Detalle) => void; ocultar: () => void };

type Estado = { x: number; y: number; d: Detalle } | null;

/**
 * El tooltip de una gráfica. Va en un portal sobre `document.body` con
 * `position: fixed` (DESIGN_SYSTEM, «La salida es el portal»): así no lo
 * recorta el `overflow` del panel ni lo afecta una opacidad de más arriba. Su
 * estado es propio: moverse sobre una marca vuelve a dibujar el tooltip, no la
 * gráfica entera.
 */
const Tooltip = forwardRef<Api>(function Tooltip(_, ref) {
  const [estado, setEstado] = useState<Estado>(null);
  const caja = useRef<HTMLDivElement>(null);

  useImperativeHandle(ref, () => ({
    mostrar: (x, y, d) => setEstado({ x, y, d }),
    ocultar: () => setEstado(null),
  }));

  // Se acota a la ventana después de medirse: a la derecha del puntero, o a
  // su izquierda si no entra; abajo, o arriba si no entra.
  useLayoutEffect(() => {
    const el = caja.current;
    if (!el || !estado) return;
    const { width, height } = el.getBoundingClientRect();
    const izquierda = estado.x + 14 + width > window.innerWidth - 8 ? estado.x - 14 - width : estado.x + 14;
    const arriba = estado.y + 14 + height > window.innerHeight - 8 ? estado.y - 14 - height : estado.y + 14;
    el.style.left = `${Math.max(8, izquierda)}px`;
    el.style.top = `${Math.max(8, arriba)}px`;
  }, [estado]);

  if (!estado || typeof document === "undefined") return null;
  return createPortal(
    <div ref={caja} className={`mic-grafica-tooltip ${styles.tooltip}`} role="tooltip">
      <b>{estado.d.titulo}</b>
      {estado.d.valor && <span className={styles.tooltipValor}>{estado.d.valor}</span>}
      {estado.d.nota && <span className={styles.tooltipNota}>{estado.d.nota}</span>}
    </div>,
    document.body,
  );
});

/**
 * Un tooltip para una gráfica. `con(detalle, alPasar?)` da los manejadores de
 * puntero de una marca; `alPasar(true/false)` avisa al entrar y al salir (el
 * resaltado sincronizado con la lista). `nodo` va en cualquier lugar del JSX
 * de la gráfica.
 */
export function useTooltip() {
  const ref = useRef<Api>(null);
  const con = useCallback(
    (d: Detalle, alPasar?: (dentro: boolean) => void) => ({
      onPointerMove: (e: React.PointerEvent) => ref.current?.mostrar(e.clientX, e.clientY, d),
      onPointerEnter: () => alPasar?.(true),
      onPointerLeave: () => {
        ref.current?.ocultar();
        alPasar?.(false);
      },
    }),
    [],
  );
  const nodo = useMemo(() => <Tooltip ref={ref} />, []);
  return { con, nodo };
}
