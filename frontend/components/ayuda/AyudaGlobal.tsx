"use client";

import dynamic from "next/dynamic";
import { useEffect } from "react";
import { useUiStore } from "@/stores/uiStore";

/**
 * La ventana de ayuda se carga recién cuando se abre: trae el índice entero y
 * el motor de Markdown, y el selector de vaults no los necesita para nada más.
 */
const VentanaAyuda = dynamic(() => import("./VentanaAyuda").then((m) => m.VentanaAyuda), { ssr: false });

/** Los diálogos que la ayuda puede reemplazar al abrirse (los cierra el store). */
const CEDEN_A_LA_AYUDA = "[data-cede-a-la-ayuda]";

/**
 * La ayuda integrada (`FUN-L-27`) y su tecla, **F1**, para toda la app.
 *
 * Vive en el layout raíz —como el atajo de las devtools— para que F1 funcione
 * también en el selector de vaults, que es justo donde está quien recién llega.
 *
 * F1 se escucha en **captura** sobre `window`: llega antes que nadie, incluso
 * con el foco en la terminal. xterm atiende sus teclas en su propio `textarea`
 * y corta la propagación, así que en burbuja F1 se iba al shell como `ESC O P`
 * y la ayuda no se enteraba. CodeMirror no usa F1, pero en captura tampoco
 * importaría. Decisión documentada en docs/features/ayuda-integrada.md.
 *
 * Con la ayuda abierta, F1 lleva al buscador. Con otro diálogo modal abierto
 * —el editor de un snippet, una confirmación, el editor de un dibujo— no hace
 * nada: abrir la ayuda cerraría ese diálogo o se pelearía con él por el
 * teclado, y el trabajo a medias ahí adentro se perdería. Configuración y la
 * paleta sí ceden (llevan `data-cede-a-la-ayuda`): no hay nada que perder.
 */
export function AyudaGlobal() {
  const abierta = useUiStore((s) => s.ayudaAbierta);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "F1" || e.ctrlKey || e.altKey || e.metaKey || e.shiftKey) return;
      e.preventDefault();
      e.stopPropagation();
      if (useUiStore.getState().ayudaAbierta) {
        document.getElementById("ayuda-buscar")?.focus();
        return;
      }
      const otroModal = [...document.querySelectorAll('[aria-modal="true"]')].some(
        (d) => !d.matches(CEDEN_A_LA_AYUDA),
      );
      if (otroModal) return;
      useUiStore.getState().abrirAyuda();
    }
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, []);

  return abierta ? <VentanaAyuda /> : null;
}
