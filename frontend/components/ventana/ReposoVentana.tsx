"use client";

import { useEffect } from "react";
import { enTauri } from "@/lib/ventana";

/**
 * Congela las animaciones cuando la ventana **no se ve**: minimizada u oculta
 * (`DEF-174`).
 *
 * Una animación CSS que nunca termina obliga al WebView2 a componer un cuadro
 * tras otro, aunque nada más cambie: la consola estilada a la vista y en
 * reposo ocupaba entre el 10 % y el 15 % de la CPU, y seguía igual minimizada.
 *
 * Marca `<html data-reposo>` y `globals.css` pone en pausa **toda** animación
 * mientras dure (`animation-play-state: paused`). Pausar, no quitar: al volver
 * cada animación sigue desde donde quedó, sin saltos. Una animación en pausa no
 * genera cuadros.
 *
 * > [!warning] Perder el foco NO pausa (decisión del usuario, 2026-11-01)
 * > La primera versión pausaba también sin el foco del sistema. Con dos
 * > pantallas eso se veía mal: el foco en un programa y Mycelium a la vista en
 * > la otra, con la consola congelada. Sin foco la ventana puede estar a la
 * > vista, así que sigue animando; solo se detiene la que no se ve.
 *
 * Minimizar, además, lo resuelve Rust (`src-tauri/src/reposo.rs`): oculta el
 * WebView2, que entonces deja de dibujar del todo y frena también
 * `requestAnimationFrame` y los temporizadores. La marca de acá es la red de
 * seguridad por si el aviso al WebView2 no llega.
 */
export function ReposoVentana() {
  useEffect(() => {
    const raiz = document.documentElement;
    let vivo = true;
    let minimizada = false;

    const aplicar = () => {
      const reposo = minimizada || document.visibilityState === "hidden";
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
          const refrescar = async () => {
            minimizada = await ventana.isMinimized();
            aplicar();
          };
          await refrescar();
          // Minimizar y restaurar llegan como un cambio de tamaño.
          const sinTamano = await ventana.onResized(() => void refrescar());
          if (!vivo) {
            sinTamano();
            return;
          }
          quitar.push(sinTamano);
        } catch {
          // Sin permiso o fuera de Tauri: queda la visibilidad del documento.
        }
      })();
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
