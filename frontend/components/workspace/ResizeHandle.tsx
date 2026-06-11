"use client";

import { useRef } from "react";
import styles from "./ResizeHandle.module.css";

/**
 * Handle de redimensionado de paneles laterales (HU-29 CA5).
 * Reporta el ancho deseado en px; el store lo clampa a [160, 480].
 */
export function ResizeHandle({
  side,
  onResize,
}: {
  side: "left" | "right";
  onResize: (width: number) => void;
}) {
  const dragging = useRef(false);

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Redimensionar panel"
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
