"use client";

import { useEffect, useState } from "react";
import { DIRECCIONES, enTauri, type Direccion } from "@/lib/ventana";
import styles from "./BordesRedimensionado.module.css";

/**
 * Los ocho bordes por los que se agarra la ventana para cambiarle el tamaño
 * (`FUN-M-31`). Sin la barra del sistema, Windows deja de dibujar el marco
 * **y** de atender el arrastre de sus bordes: si no se repone, la ventana queda
 * del tamaño que se abrió.
 *
 * Son franjas transparentes de 6px pegadas al borde, que al pulsarlas le piden
 * a Tauri el arrastre nativo (`startResizeDragging`): desde ahí lo maneja el
 * sistema, con su misma fluidez.
 */
export function BordesRedimensionado() {
  const [visible, setVisible] = useState(false);

  // Solo en Tauri, y recién tras montar: en el render del servidor no hay
  // ventana y el HTML exportado se sirve igual en los dos lados.
  useEffect(() => setVisible(enTauri()), []);

  if (!visible) return null;

  const agarrar = async (e: React.PointerEvent, direccion: Direccion) => {
    // Solo el botón principal: con el secundario, Windows abre su menú.
    if (e.button !== 0) return;
    e.preventDefault();
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    await getCurrentWindow().startResizeDragging(direccion);
  };

  return (
    <>
      {DIRECCIONES.map((d) => (
        <div
          key={d}
          className={`${styles.borde} ${styles[`borde${d}`]}`}
          onPointerDown={(e) => void agarrar(e, d)}
          aria-hidden
        />
      ))}
    </>
  );
}
