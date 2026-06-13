"use client";

import { useImportStore } from "@/stores/importStore";
import styles from "./ImportDialogs.module.css";

/**
 * Diálogos de importación (HU-07/11): barra de progreso, modal de conflicto de
 * nombre (Reemplazar / Renombrar / Cancelar) y modal de resumen final.
 */
export function ImportDialogs() {
  const progress = useImportStore((s) => s.progress);
  const conflict = useImportStore((s) => s.conflict);
  const summary = useImportStore((s) => s.summary);
  const titulo = useImportStore((s) => s.titulo);
  const answerConflict = useImportStore((s) => s.answerConflict);
  const clearSummary = useImportStore((s) => s.clearSummary);

  return (
    <>
      {progress && (
        <div className={styles.progressBar} role="status">
          <span>
            Importando… {progress.done}/{progress.total}
          </span>
          <div className={styles.track}>
            <div
              className={styles.fill}
              style={{ width: `${(progress.done / Math.max(1, progress.total)) * 100}%` }}
            />
          </div>
        </div>
      )}

      {conflict && (
        <div className={styles.overlay}>
          <div className={styles.modal} role="dialog" aria-modal="true">
            <h3 className={styles.modalTitle}>Conflicto de nombre</h3>
            <p className={styles.modalText}>
              Ya existe una nota llamada «{conflict.nombre}» en la carpeta destino.
            </p>
            <div className={styles.modalActions}>
              <button
                type="button"
                className={styles.btnPrimary}
                onClick={() => answerConflict("renombrar")}
              >
                Renombrar
              </button>
              <button
                type="button"
                className={styles.btn}
                onClick={() => answerConflict("reemplazar")}
              >
                Reemplazar
              </button>
              <button
                type="button"
                className={styles.btn}
                onClick={() => answerConflict("cancelar")}
              >
                Cancelar este archivo
              </button>
            </div>
          </div>
        </div>
      )}

      {summary && (
        <div className={styles.overlay} onClick={clearSummary}>
          <div
            className={styles.modal}
            role="dialog"
            aria-modal="true"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className={styles.modalTitle}>{titulo} completada</h3>
            <p className={styles.modalText}>
              {summary.notas} nota(s) importada(s)
              {summary.adjuntos > 0 ? `, ${summary.adjuntos} adjunto(s)` : ""}
              {summary.omitidos.length > 0 ? `, ${summary.omitidos.length} omitido(s)` : ""}.
            </p>
            {summary.omitidos.length > 0 && (
              <ul className={styles.omitidos}>
                {summary.omitidos.map((o, i) => (
                  <li key={i}>{o}</li>
                ))}
              </ul>
            )}
            <div className={styles.modalActions}>
              <button type="button" className={styles.btnPrimary} onClick={clearSummary}>
                Listo
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
