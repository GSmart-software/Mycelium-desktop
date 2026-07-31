"use client";

import { useEffect } from "react";

/**
 * Atajo global para abrir/cerrar las herramientas de desarrollador del webview:
 * **F12** o **Ctrl/Cmd+Shift+I**. Están disponibles también en las builds de
 * producción (feature `devtools` del crate `tauri`), porque son útiles para
 * escribir CSS propio y depurar el uso diario.
 *
 * Se monta en el layout raíz para que funcione en toda la app (incluido el
 * selector de vaults). Si no corre dentro de Tauri, el `invoke` falla y se
 * ignora en silencio.
 */
export function DevToolsHotkey() {
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const esF12 = e.key === "F12";
      const esInspeccionar =
        (e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === "i";
      if (!esF12 && !esInspeccionar) return;
      e.preventDefault();
      void import("@tauri-apps/api/core")
        .then(({ invoke }) => invoke("alternar_devtools"))
        .catch(() => {
          /* fuera de Tauri (o sin la feature): no hay nada que abrir */
        });
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return null;
}
