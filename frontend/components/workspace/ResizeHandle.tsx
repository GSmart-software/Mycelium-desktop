"use client";

import { useRef } from "react";
import { PANEL_MAX_WIDTH, PANEL_MIN_WIDTH } from "@/stores/panelLayoutStore";
import { propsDeSeparador } from "./separador";
import styles from "./ResizeHandle.module.css";

/**
 * Handle de redimensionado de paneles laterales (HU-29 CA5).
 * Reporta el ancho deseado en px; el store lo clampa a [160, 480]. Con el
 * teclado (`FUN-XL-04`, Parte 7) es una parada de Tab y las flechas cambian el
 * ancho (ver `propsDeSeparador`).
 */
export function ResizeHandle({
  side,
  width,
  onResize,
}: {
  side: "left" | "right";
  /** El ancho de ahora: el valor del divisor para el teclado. */
  width: number;
  onResize: (width: number) => void;
}) {
  const dragging = useRef(false);

  return (
    <div
      {...propsDeSeparador({
        etiqueta: "Ancho del panel",
        valor: width,
        min: PANEL_MIN_WIDTH,
        max: PANEL_MAX_WIDTH,
        orientacion: "vertical",
        // El borde de un panel de la derecha está a su izquierda: crece con ←.
        invertido: side === "right",
        paso: 10,
        pasoGrande: 50,
        alCambiar: onResize,
      })}
      className={`${styles.handle} ${side === "left" ? styles.left : styles.right}`}
      onPointerDown={(e) => {
        dragging.current = true;
        e.currentTarget.setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => {
        if (!dragging.current) return;
        const railWidth = 56;
        const width =
          side === "left" ? e.clientX - railWidth : window.innerWidth - e.clientX;
        onResize(width);
      }}
      onPointerUp={(e) => {
        dragging.current = false;
        e.currentTarget.releasePointerCapture(e.pointerId);
      }}
    />
  );
}
