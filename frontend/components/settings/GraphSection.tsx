"use client";

import { Check, X } from "lucide-react";
import { usePreferencesStore } from "@/stores/preferencesStore";
import styles from "./Settings.module.css";

/** Sección Grafo: rendimiento de la simulación. */
export function GraphSection() {
  const continuous = usePreferencesStore((s) => s.prefs.graphContinuousSim);
  const setPref = usePreferencesStore((s) => s.setPref);

  return (
    <div>
      <div className={styles.toggleRow}>
        <span className={styles.label}>Simulación continua</span>
        <button
          type="button"
          className={styles.toggle}
          onClick={() => setPref("graphContinuousSim", !continuous)}
          aria-pressed={continuous}
        >
          {continuous ? <Check size={15} aria-hidden /> : <X size={15} aria-hidden />}
          {continuous ? "Activada" : "Desactivada"}
        </button>
      </div>
      <p className={styles.hint}>
        Por defecto el grafo deja de simular cuando se asienta para ahorrar CPU.
        Activá esta opción para que la simulación corra en cada frame de forma
        continua, con los nodos siempre en movimiento.
      </p>
      {continuous && (
        <p className={styles.warn}>
          ⚠ La simulación continua aumenta el consumo de CPU, sobre todo con
          muchos archivos.
        </p>
      )}
    </div>
  );
}
