"use client";

import { ControlesVentana } from "./ControlesVentana";
import styles from "./FranjaVentana.module.css";

/**
 * Minimizar, maximizar y cerrar para las pantallas que no tienen la barra
 * superior del workspace: el selector de vaults y las de espera (`DEF-114`).
 *
 * La ventana va sin la barra del sistema (`FUN-M-31`), así que cada pantalla
 * que reemplaza la página entera tiene que traer sus controles. Antes solo el
 * selector de vaults los tenía, y mientras un vault se abría —o se trababa
 * abriéndose, como en `DEF-105`— no había forma de cerrar ni minimizar la app.
 *
 * En web `ControlesVentana` no dibuja nada: queda solo la franja, vacía.
 */
export function FranjaVentana() {
  return (
    <div className={styles.franja} data-tauri-drag-region>
      <ControlesVentana />
    </div>
  );
}
