"use client";

import { useEffect } from "react";
import { useVaultStore } from "@/stores/vaultStore";
import styles from "./TrashPanel.module.css";

const RETENTION_DAYS = 30;

/** Vista de papelera (HU-23 CA9/CA10): recuperar o eliminar definitivamente. */
export function TrashPanel() {
  const papelera = useVaultStore((s) => s.papelera);
  const loadPapelera = useVaultStore((s) => s.loadPapelera);
  const restoreNota = useVaultStore((s) => s.restoreNota);
  const deleteNotaForever = useVaultStore((s) => s.deleteNotaForever);
  const vaultId = useVaultStore((s) => s.vaultId);

  useEffect(() => {
    if (vaultId) void loadPapelera();
  }, [vaultId, loadPapelera]);

  if (papelera.length === 0) {
    return <p className={styles.empty}>La papelera está vacía.</p>;
  }

  return (
    <ul className={styles.list}>
      {papelera.map((item) => {
        const eliminado = new Date(item.eliminadoEn);
        const diasPasados = Math.floor(
          (Date.now() - eliminado.getTime()) / (24 * 60 * 60 * 1000),
        );
        const diasRestantes = Math.max(0, RETENTION_DAYS - diasPasados);

        return (
          <li key={item.notaId} className={styles.item}>
            <p className={styles.titulo}>{item.titulo}</p>
            <p className={styles.meta}>
              {item.rutaOriginal} · eliminada el {eliminado.toLocaleDateString()} ·{" "}
              {diasRestantes} día{diasRestantes === 1 ? "" : "s"} restantes
            </p>
            <div className={styles.itemActions}>
              <button
                type="button"
                className={styles.restore}
                onClick={() => void restoreNota(item.notaId)}
              >
                Recuperar
              </button>
              <button
                type="button"
                className={styles.deleteForever}
                onClick={() => {
                  if (
                    window.confirm(
                      `"${item.titulo}" se eliminará permanentemente. ¿Continuar?`,
                    )
                  ) {
                    void deleteNotaForever(item.notaId);
                  }
                }}
              >
                Eliminar ahora
              </button>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
