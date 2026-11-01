"use client";

import { useEffect } from "react";
import { enTauri } from "@/lib/ventana";

/**
 * Congela las animaciones cuando la ventana **no se está usando**: sin el foco
 * del sistema, minimizada u oculta (`DEF-174`).
 *
 * Una animación CSS que nunca termina obliga al WebView2 a componer un cuadro
 * tras otro, aunque nada más cambie: la consola estilada sola, a la vista y en
 * reposo, ocupaba entre el 10 % y el 15 % de la CPU. Con la ventana detrás de
 * otras —el caso de uso normal de una app que queda abierta todo el día— ese
 * gasto no le sirve a nadie.
 *
 * Marca `<html data-reposo>` y `globals.css` pone en pausa **toda** animación
 * mientras dure (`animation-play-state: paused`). Pausar, no quitar: al volver
 * el foco cada animación sigue desde donde quedó, sin saltos. Una animación en
 * pausa no genera cuadros.
 *
 * Minimizar, además, lo resuelve Rust (`src-tauri/src/reposo.rs`): oculta el
 * WebView2, que entonces deja de dibujar del todo y frena también
 * `requestAnimationFrame` y los temporizadores. Acá solo cuenta para la marca.
 *
 * El foco es el **de la ventana** (el del sistema), no el del documento: un
 * clic dentro de un iframe —un diagrama de draw.io— le quita el foco al
 * documento pero la ventana sigue siendo la que se usa.
 */
export function ReposoVentana() {
  useEffect(() => {
    const raiz = document.documentElement;
    let vivo = true;
    let enfocada = document.hasFocus();
    let minimizada = false;

    const aplicar = () => {
      const reposo = !enfocada || minimizada || document.visibilityState === "hidden";
      if (reposo) raiz.dataset.reposo = "";
      else delete raiz.dataset.reposo;
    };
    document.addEventListener("visibilitychange", aplicar);

    const quitar: (() => void)[] = [() => document.removeEventListener("visibilitychange", aplicar)];

    if (enTauri()) {
      void (async () => {
        try {
          const { getCurrentWindow } = await import("@tauri-apps/api/window");
          const ventana = getCurrentWindow();
          const refrescarMinimizada = async () => {
            minimizada = await ventana.isMinimized();
            aplicar();
          };
          [enfocada, minimizada] = await Promise.all([ventana.isFocused(), ventana.isMinimized()]);
          if (!vivo) return;
          aplicar();
          const sinFoco = await ventana.onFocusChanged(({ payload }) => {
            enfocada = payload;
            aplicar();
          });
          const sinTamano = await ventana.onResized(() => void refrescarMinimizada());
          if (!vivo) {
            sinFoco();
            sinTamano();
            return;
          }
          quitar.push(sinFoco, sinTamano);
        } catch {
          // Sin permiso o fuera de Tauri: queda la visibilidad del documento.
        }
      })();
    } else {
      const alFoco = () => {
        enfocada = true;
        aplicar();
      };
      const alPerder = () => {
        enfocada = false;
        aplicar();
      };
      window.addEventListener("focus", alFoco);
      window.addEventListener("blur", alPerder);
      quitar.push(
        () => window.removeEventListener("focus", alFoco),
        () => window.removeEventListener("blur", alPerder),
      );
    }
    aplicar();

    return () => {
      vivo = false;
      for (const q of quitar) q();
      delete raiz.dataset.reposo;
    };
  }, []);

  return null;
}
