"use client";

import { SlidersHorizontal } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { usePreferencesStore } from "@/stores/preferencesStore";
import styles from "./GraphOptionsMenu.module.css";

const DIRECTIONS: { value: "none" | "animated" | "arrow" | "both"; label: string }[] = [
  { value: "none", label: "Ninguno" },
  { value: "animated", label: "Animado" },
  { value: "arrow", label: "Flecha" },
  { value: "both", label: "Ambos" },
];

/**
 * Menú desplegable de opciones del grafo del vault (overlay arriba a la derecha).
 * Pensado para crecer con más opciones; por ahora: indicador de dirección de los
 * enlaces e intensidad del brillo de las conexiones al apuntar un nodo.
 */
export function GraphOptionsMenu() {
  const edgeDirection = usePreferencesStore((s) => s.prefs.graphEdgeDirection);
  const hoverGlow = usePreferencesStore((s) => s.prefs.graphHoverGlow);
  const setPref = usePreferencesStore((s) => s.setPref);

  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDown(e: PointerEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    }
    window.addEventListener("pointerdown", onDown);
    return () => window.removeEventListener("pointerdown", onDown);
  }, [open]);

  return (
    <div className={styles.wrap} ref={wrapRef}>
      <button
        type="button"
        className={styles.button}
        title="Opciones del grafo"
        aria-label="Opciones del grafo"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <SlidersHorizontal size={16} aria-hidden />
      </button>

      {open && (
        <div className={styles.menu} role="menu">
          <div className={styles.group}>
            <span className={styles.label}>Indicador de dirección</span>
            <div className={styles.segmented} role="radiogroup">
              {DIRECTIONS.map((d) => (
                <button
                  key={d.value}
                  type="button"
                  role="radio"
                  aria-checked={edgeDirection === d.value}
                  className={
                    edgeDirection === d.value
                      ? `${styles.segment} ${styles.segmentActive}`
                      : styles.segment
                  }
                  onClick={() => setPref("graphEdgeDirection", d.value)}
                >
                  {d.label}
                </button>
              ))}
            </div>
          </div>

          <div className={styles.group}>
            <span className={styles.label}>
              Brillo de conexiones al apuntar
              <span className={styles.value}>{Math.round(hoverGlow * 100)}%</span>
            </span>
            <input
              className={styles.slider}
              type="range"
              min={0}
              max={2}
              step={0.1}
              value={hoverGlow}
              onChange={(e) => setPref("graphHoverGlow", Number(e.target.value))}
              aria-label="Intensidad del brillo de las conexiones al apuntar un nodo"
            />
          </div>
        </div>
      )}
    </div>
  );
}
