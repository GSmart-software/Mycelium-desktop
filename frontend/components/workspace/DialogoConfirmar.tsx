"use client";

import { useCallback, useEffect, useRef } from "react";
import { useDialogoModal } from "@/lib/useDialogoModal";
import { useConfirmarStore, type OrigenPregunta } from "@/stores/confirmarStore";
import styles from "./DialogoConfirmar.module.css";

/**
 * La pregunta antes de algo irreversible (`FUN-M-33`). Antes la hacía el
 * diálogo del sistema (`@tauri-apps/plugin-dialog`), con su tipografía y su
 * marco, encima de una app que se sacó la barra de título de Windows justo para
 * no parecerse a eso (crítica del cascarón, 2026-09-20).
 *
 * El foco arranca en **Cancelar**: lo que abre un diálogo destructivo con el
 * teclado no debe poder confirmarlo con un Enter de inercia.
 *
 * Las preguntas van en cola (`stores/confirmarStore.ts`): se muestra la
 * primera, y cada una se monta de nuevo —con el foco otra vez en Cancelar—.
 * Las que pide la IA por el MCP de control (`FUN-L-09`) **lo dicen**: una
 * pregunta que el usuario no provocó y que no dice de dónde viene es una
 * pregunta que se contesta que sí por inercia.
 */
export function DialogoConfirmar() {
  const pendiente = useConfirmarStore((s) => s.pendiente);
  const responder = useConfirmarStore((s) => s.responder);
  const setMontado = useConfirmarStore((s) => s.setMontado);

  useEffect(() => {
    setMontado(true);
    return () => setMontado(false);
  }, [setMontado]);

  if (!pendiente) return null;
  return (
    <Pregunta
      key={pendiente.id}
      origen={pendiente.origen}
      mensaje={pendiente.mensaje}
      confirmar={pendiente.confirmar}
      responder={responder}
    />
  );
}

function Pregunta({
  origen,
  mensaje,
  confirmar,
  responder,
}: {
  origen: OrigenPregunta;
  mensaje: string;
  confirmar: string;
  responder: (ok: boolean) => void;
}) {
  const dialogoRef = useRef<HTMLDivElement>(null);
  const cancelar = useCallback(() => responder(false), [responder]);
  useDialogoModal({ abierto: true, cerrar: cancelar, dialogoRef });

  return (
    <div className={styles.velo} onPointerDown={(e) => e.target === e.currentTarget && cancelar()}>
      <div
        ref={dialogoRef}
        className={styles.dialogo}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirmar-mensaje"
        data-origen={origen}
      >
        {origen === "ia" && <p className={styles.origen}>Lo pide Claude Code</p>}
        <p id="confirmar-mensaje" className={styles.mensaje}>
          {mensaje}
        </p>
        <div className={styles.botones}>
          <button type="button" className={styles.cancelar} onClick={cancelar}>
            Cancelar
          </button>
          <button type="button" className={styles.confirmar} onClick={() => responder(true)}>
            {confirmar}
          </button>
        </div>
      </div>
    </div>
  );
}
