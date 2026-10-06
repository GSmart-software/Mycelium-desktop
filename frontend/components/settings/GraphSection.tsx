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
        ayuda="Los nodos siguen moviéndose aunque el grafo ya se haya asentado."
        detalle="Por defecto la simulación se detiene cuando el grafo se asienta, para ahorrar CPU. Activada, corre en cada frame."
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
