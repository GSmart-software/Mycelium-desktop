"use client";

import { usePreferencesStore } from "@/stores/preferencesStore";
import { Interruptor } from "./Interruptor";
import styles from "./Settings.module.css";

/** Sección Grafo: rendimiento de la simulación. */
export function GraphSection() {
  const continuous = usePreferencesStore((s) => s.prefs.graphContinuousSim);
  const setPref = usePreferencesStore((s) => s.setPref);

  return (
    <div>
      <Interruptor
        etiqueta="Simulación continua"
        valor={continuous}
        onChange={(v) => setPref("graphContinuousSim", v)}
        ayuda="Por defecto el grafo deja de simular cuando se asienta para ahorrar CPU. Activá esta opción para que la simulación corra en cada frame de forma continua, con los nodos siempre en movimiento."
      />
      {continuous && (
        <p className={styles.warn}>
          ⚠ La simulación continua aumenta el consumo de CPU, sobre todo con
          muchos archivos.
        </p>
      )}
    </div>
  );
}
