"use client";

import { useEffect, useState } from "react";
import { enTauri } from "@/lib/ventana";
import styles from "./ControlesVentana.module.css";

/**
 * Minimizar, maximizar/restaurar y cerrar, con la forma de Mycelium
 * (`FUN-M-31`). La ventana va sin la barra del sistema (`decorations: false`),
 * así que estos botones son los únicos que hay: viven dentro de la barra
 * superior de la app, como en VS Code y Obsidian.
 *
 * En web no hay ventana que controlar y el componente no renderiza nada.
 */
export function ControlesVentana({ className }: { className?: string }) {
  const [maximizada, setMaximizada] = useState(false);
  const [listo, setListo] = useState(false);

  useEffect(() => {
    if (!enTauri()) return;
    let vivo = true;
    let desuscribir: (() => void) | undefined;
    void (async () => {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      const ventana = getCurrentWindow();
      const refrescar = async () => {
        const m = await ventana.isMaximized();
        if (vivo) setMaximizada(m);
      };
      await refrescar();
      if (!vivo) return;
      setListo(true);
      // `onResized` cubre maximizar, restaurar y el anclado de Windows: no hay
      // un evento propio de «cambió el estado de la ventana».
      desuscribir = await ventana.onResized(() => void refrescar());
    })();
    return () => {
      vivo = false;
      desuscribir?.();
    };
  }, []);

  if (!listo) return null;

  const accion = async (que: "minimizar" | "alternar" | "cerrar") => {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    const ventana = getCurrentWindow();
    if (que === "minimizar") await ventana.minimize();
    else if (que === "alternar") await ventana.toggleMaximize();
    else await ventana.close();
  };

  return (
    <div className={className ? `${styles.grupo} ${className}` : styles.grupo}>
      <button
        type="button"
        className={styles.boton}
        aria-label="Minimizar"
        title="Minimizar"
        onClick={() => void accion("minimizar")}
      >
        <svg viewBox="0 0 10 10" aria-hidden className={styles.icono}>
          <path d="M0 5h10" />
        </svg>
      </button>
      <button
        type="button"
        className={styles.boton}
        aria-label={maximizada ? "Restaurar" : "Maximizar"}
        title={maximizada ? "Restaurar" : "Maximizar"}
        onClick={() => void accion("alternar")}
      >
        {maximizada ? (
          <svg viewBox="0 0 10 10" aria-hidden className={styles.icono}>
            <path d="M2.5 2.5V0.5h7v7h-2" />
            <rect x="0.5" y="2.5" width="7" height="7" />
          </svg>
        ) : (
          <svg viewBox="0 0 10 10" aria-hidden className={styles.icono}>
            <rect x="0.5" y="0.5" width="9" height="9" />
          </svg>
        )}
      </button>
      <button
        type="button"
        className={`${styles.boton} ${styles.cerrar}`}
        aria-label="Cerrar"
        title="Cerrar"
        onClick={() => void accion("cerrar")}
      >
        <svg viewBox="0 0 10 10" aria-hidden className={styles.icono}>
          <path d="M0.5 0.5l9 9M9.5 0.5l-9 9" />
        </svg>
      </button>
    </div>
  );
}
