"use client";

import { useLayoutEffect, useRef, useState } from "react";

/**
 * El ancho de un contenedor, en px enteros, para dibujar la gráfica a su
 * tamaño real: así los textos quedan siempre a 11–12 px en vez de achicarse
 * con un `viewBox` escalado. Un `ResizeObserver` solo avisa cuando el tamaño
 * cambia: en reposo no hace nada (`DEF-174`).
 */
export function useAncho<T extends HTMLElement = HTMLDivElement>() {
  const ref = useRef<T>(null);
  const [ancho, setAncho] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const medir = () => setAncho(Math.floor(el.getBoundingClientRect().width));
    medir();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(medir);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return { ref, ancho };
}
