"use client";

import { X } from "lucide-react";
import { useEffect } from "react";
import { useAvisosStore, type Aviso } from "@/stores/avisosStore";
import styles from "./Avisos.module.css";

/**
 * Los avisos flotantes de la app (`FUN-M-33`): abajo a la izquierda, sobre la
 * barra de estado. Cuentan algo que acaba de pasar y, cuando hay forma de
 * deshacerlo, la ofrecen ahí mismo.
 */
const DURACION_MS = 9000;

export function Avisos() {
  const avisos = useAvisosStore((s) => s.avisos);

  return (
    <div className={styles.pila} role="status" aria-live="polite">
      {avisos.map((a) => (
        <Tarjeta key={a.id} aviso={a} />
      ))}
    </div>
  );
}

function Tarjeta({ aviso }: { aviso: Aviso }) {
  const cerrar = useAvisosStore((s) => s.cerrar);

  // Se va solo. El temporizador se reinicia si el aviso cambia de identidad,
  // no en cada render, así que pasar el puntero por encima no lo alarga: es
  // información, no un menú.
  useEffect(() => {
    const id = window.setTimeout(() => cerrar(aviso.id), DURACION_MS);
    return () => window.clearTimeout(id);
  }, [aviso.id, cerrar]);

  return (
    <div className={styles.aviso}>
      <span className={styles.texto}>{aviso.texto}</span>
      {aviso.accion && (
        <button
          type="button"
          className={styles.accion}
          onClick={() => {
            cerrar(aviso.id);
            void aviso.accion?.hacer();
          }}
        >
          {aviso.accion.etiqueta}
        </button>
      )}
      <button
        type="button"
        className={styles.cerrar}
        aria-label="Descartar el aviso"
        onClick={() => cerrar(aviso.id)}
      >
        <X size={14} aria-hidden />
      </button>
    </div>
  );
}
