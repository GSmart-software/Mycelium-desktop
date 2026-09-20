"use client";

import { useEffect, useRef, useState } from "react";
import { enTauri } from "@/lib/ventana";
import styles from "./ControlesVentana.module.css";

/**
 * Minimizar, maximizar/restaurar y cerrar, con la forma de Mycelium
 * (`FUN-M-31`). La ventana va sin la barra del sistema (`decorations: false`),
 * así que estos botones son los únicos que hay: viven dentro de la barra
 * superior de la app, como en VS Code y Obsidian.
 *
 * En web no hay ventana que controlar y el componente no renderiza nada.
 *
 * El botón de maximizar además le avisa a Rust dónde está dibujado: con eso
 * Windows 11 vuelve a ofrecer su **menú de anclaje** al dejar el puntero encima
 * (ver `src-tauri/src/marco.rs`). A cambio, ese botón deja de recibir el
 * puntero —para Windows queda fuera del área de cliente—, así que el clic lo
 * atiende Rust y el hover llega por un evento.
 */
export function ControlesVentana({ className }: { className?: string }) {
  const [maximizada, setMaximizada] = useState(false);
  const [listo, setListo] = useState(false);
  /** Hover del botón de maximizar, informado por Rust (ver arriba). */
  const [hoverMaximizar, setHoverMaximizar] = useState(false);
  const botonMaximizarRef = useRef<HTMLButtonElement>(null);

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

  // Dónde está el botón de maximizar, para el menú de anclaje. Se reporta al
  // montar y cada vez que cambia de lugar o de tamaño.
  useEffect(() => {
    if (!listo || !enTauri()) return;
    const boton = botonMaximizarRef.current;
    if (!boton) return;
    let vivo = true;
    let desuscribir: (() => void) | undefined;

    const reportar = async () => {
      const r = boton.getBoundingClientRect();
      if (!vivo || r.width === 0) return;
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("marco_zona_maximizar", {
        x: r.left,
        y: r.top,
        ancho: r.width,
        alto: r.height,
      }).catch(() => {});
    };

    void reportar();
    void (async () => {
      const { listen } = await import("@tauri-apps/api/event");
      const parar = await listen<boolean>("marco://hover-maximizar", (e) => {
        if (vivo) setHoverMaximizar(e.payload);
      });
      if (vivo) desuscribir = parar;
      else parar();
    })();

    const observador = new ResizeObserver(() => void reportar());
    observador.observe(boton);
    observador.observe(document.documentElement);

    return () => {
      vivo = false;
      observador.disconnect();
      desuscribir?.();
      void import("@tauri-apps/api/core").then(({ invoke }) =>
        invoke("marco_olvidar_zona").catch(() => {}),
      );
    };
  }, [listo]);

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
        ref={botonMaximizarRef}
        type="button"
        className={hoverMaximizar ? `${styles.boton} ${styles.hover}` : styles.boton}
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
