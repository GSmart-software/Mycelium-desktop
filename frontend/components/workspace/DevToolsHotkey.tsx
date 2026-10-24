"use client";

import { useEffect } from "react";

/** El aviso de las herramientas de desarrollo: en Configuración y en la consola. */
export const AVISO_CONSOLA =
  "No pegues en la consola código que te pase otra persona: puede leer tus archivos.";

/**
 * Atajo global para abrir/cerrar las herramientas de desarrollador del webview:
 * **F12** o **Ctrl/Cmd+Shift+I**. Solo abren si el vault de la ventana tiene
 * encendido «Herramientas de desarrollo» en Configuración → Avanzado; lo decide
 * Rust (`src-tauri/src/devtools.rs`), que además las apaga en WebView2 para que
 * el atajo nativo y «Inspeccionar» del menú contextual tampoco las abran.
 *
 * Se monta en el layout raíz para que funcione en toda la app (incluido el
 * selector de vaults). Si no corre dentro de Tauri, el `invoke` falla y se
 * ignora en silencio.
 *
 * Además deja el aviso en la consola al arrancar: Chromium muestra lo que se
 * registró antes de abrirla, así que es lo primero que ve quien la abre.
 */
export function DevToolsHotkey() {
  useEffect(() => {
    // Estilo Discord/Facebook, sin exagerar: un título y el aviso.
    console.log("%cCuidado", "color:#e0a040;font-size:20px;font-weight:bold");
    console.log(`%c${AVISO_CONSOLA}`, "font-size:13px");

    function onKeyDown(e: KeyboardEvent) {
      const esF12 = e.key === "F12";
      const esInspeccionar =
        (e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === "i";
      if (!esF12 && !esInspeccionar) return;
      e.preventDefault();
      void import("@tauri-apps/api/core")
        .then(({ invoke }) => invoke("alternar_devtools"))
        .catch(async (err: unknown) => {
          // Apagadas en este vault: se dice dónde se encienden. Fuera de Tauri
          // el error no es un texto y no hay nada que decir.
          if (typeof err !== "string") return;
          const { avisar } = await import("@/stores/avisosStore");
          avisar(err);
        });
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return null;
}
