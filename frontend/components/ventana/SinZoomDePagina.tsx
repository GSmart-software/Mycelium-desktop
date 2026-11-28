"use client";

import { useEffect } from "react";

/**
 * Que el pellizco del touchpad y Ctrl+rueda nunca agranden **toda** la
 * interfaz (`DEF-187`).
 *
 * Desde `DEF-187` WebView2 tiene el pellizco encendido (`src-tauri/src/pellizco.rs`):
 * sin eso el gesto no llegaba a la página y el visor de imágenes no podía hacer
 * zoom. Chromium entrega cada paso del pellizco como un `wheel` con `ctrlKey`, y
 * si nadie lo cancela aplica él mismo el zoom de página (la escala del visual
 * viewport); con Ctrl+rueda del mouse, el del navegador. Los que hacen zoom
 * propio (visor, lienzo, minigrafo, Excalidraw) ya cancelan el suyo, pero el
 * resto de la interfaz no: esta guarda cancela todo `wheel` con `ctrlKey`.
 *
 * - **Fase de captura, en `window`.** Corre antes que nadie, así que ninguna
 *   escucha puede cortar la propagación antes de que llegue (las tarjetas del
 *   lienzo cortan la rueda para desplazarse por dentro). `preventDefault` no
 *   detiene la propagación: los manejadores propios reciben el evento igual. Lo
 *   único que cambia para ellos es `defaultPrevented`, que ninguno mira en la
 *   rueda.
 * - **El costo de no ser pasiva.** Una escucha de `wheel` no pasiva en `window`
 *   obliga a Chromium a esperar al hilo principal antes de desplazar, porque la
 *   escucha podría cancelar el desplazamiento. Lo acota que Chromium solo espera
 *   el **primer** `wheel` de cada gesto (los siguientes del mismo gesto ya no se
 *   pueden cancelar), y que la escucha no hace nada más que mirar `ctrlKey`.
 *   Con el hilo principal ocupado, el primer paso de un desplazamiento puede
 *   tardar lo que tarde esa tarea; es el precio de que el zoom de página no se
 *   escape. Los eventos con `ctrlKey` sí son siempre cancelables.
 * - **Pantallas táctiles**: el pellizco con los dedos no pasa por acá (son
 *   eventos táctiles); lo frena `touch-action: pan-x pan-y` en `globals.css`.
 */
export function SinZoomDePagina() {
  useEffect(() => {
    const guarda = (e: WheelEvent) => {
      if (e.ctrlKey) e.preventDefault();
    };
    window.addEventListener("wheel", guarda, { capture: true, passive: false });
    return () => window.removeEventListener("wheel", guarda, { capture: true });
  }, []);
  return null;
}
