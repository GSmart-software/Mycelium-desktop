"use client";

import { useCallback, useEffect, useRef } from "react";
import { useDialogoModal } from "@/lib/useDialogoModal";
import { useConfirmarStore } from "@/stores/confirmarStore";
import styles from "./DialogoConfirmar.module.css";

/**
 * La pregunta antes de algo irreversible (`FUN-M-33`). Antes la hacía el
 * diálogo del sistema (`@tauri-apps/plugin-dialog`), con su tipografía y su
 * marco, encima de una app que se sacó la barra de título de Windows justo para
 * no parecerse a eso (crítica del cascarón, 2026-09-20).
 *
 * El foco arranca en **Cancelar**: lo que abre un diálogo destructivo con el
 * teclado no debe poder confirmarlo con un Enter de inercia.
 */
export function DialogoConfirmar() {
  const pendiente = useConfirmarStore((s) => s.pendiente);
  const responder = useConfirmarStore((s) => s.responder);
  const setMontado = useConfirmarStore((s) => s.setMontado);
  const dialogoRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setMontado(true);
    return () => setMontado(false);
  }, [setMontado]);

  const cancelar = useCallback(() => responder(false), [responder]);
  useDialogoModal({ abierto: pendiente !== null, cerrar: cancelar, dialogoRef });

  if (!pendiente) return null;

  return (
    <div className={styles.velo} onPointerDown={(e) => e.target === e.currentTarget && cancelar()}>
      <div
        ref={dialogoRef}
        className={styles.dialogo}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirmar-mensaje"
      >
        <p id="confirmar-mensaje" className={styles.mensaje}>
          {pendiente.mensaje}
        </p>
        <div className={styles.botones}>
          <button type="button" className={styles.cancelar} onClick={cancelar}>
            Cancelar
          </button>
          <button type="button" className={styles.confirmar} onClick={() => responder(true)}>
            {pendiente.confirmar}
          </button>
        </div>
      </div>
    </div>
  );
}
