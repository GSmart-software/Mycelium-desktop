"use client";

import { PdfExportDialog } from "@/components/editor/PdfExportDialog";
import { useExportStore } from "@/stores/exportStore";
import { useImportStore } from "@/stores/importStore";
import styles from "./ImportDialogs.module.css";

/**
 * Progreso y diálogos de tareas de fondo (HU-07/11): barra de progreso de
 * importación Y de exportación (DEF-018: la de export vive en un store global
 * para no perderse al cerrar el menú de opciones), modal de conflicto de nombre
 * y modal de resumen final. Se monta a nivel de app (workspace).
 */
/** Tamaño legible para la barra de importación («45,2 MB»). */
function megas(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toLocaleString("es", { maximumFractionDigits: 1 })} MB`;
}

/**
 * Cuánto va de la importación: por bytes cuando los hay —un archivo de 200 MB
 * es casi todo el trabajo, aunque sea uno de cinco—, si no por archivos.
 */
function fraccion(p: { done: number; total: number; bytes?: { hechos: number; total: number } }) {
  if (p.bytes && p.bytes.total > 0) return p.bytes.hechos / p.bytes.total;
  return p.done / Math.max(1, p.total);
}

/**
 * «3 notas y 2 archivos importados, 1 omitido.» Desde `FUN-S-26` entra
 * cualquier tipo de archivo: soltar solo una imagen ya no dice «0 nota(s)».
 */
function textoResumen(s: { notas: number; adjuntos: number; omitidos: string[] }): string {
  const plural = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`;
  const partes: string[] = [];
  if (s.notas > 0) partes.push(plural(s.notas, "nota", "notas"));
  if (s.adjuntos > 0) partes.push(plural(s.adjuntos, "archivo", "archivos"));
  // Femenino si son solo notas («2 notas importadas»); con archivos, masculino
  // («1 nota y 1 archivo importados»).
  const total = s.notas + s.adjuntos;
  const participio =
    s.adjuntos > 0 ? (total === 1 ? "importado" : "importados") : total === 1 ? "importada" : "importadas";
  let texto = partes.length === 0 ? "No se importó nada" : `${partes.join(" y ")} ${participio}`;
  if (s.omitidos.length > 0) texto += `, ${plural(s.omitidos.length, "omitido", "omitidos")}`;
  return `${texto}.`;
}

export function ImportDialogs() {
  const progress = useImportStore((s) => s.progress);
  const conflict = useImportStore((s) => s.conflict);
  const summary = useImportStore((s) => s.summary);
  const titulo = useImportStore((s) => s.titulo);
  const answerConflict = useImportStore((s) => s.answerConflict);
  const clearSummary = useImportStore((s) => s.clearSummary);
  const exportProgreso = useExportStore((s) => s.progreso);

  return (
    <>
      {progress && (
        <div className={styles.progressBar} role="status">
          <span>
            Importando… {progress.done}/{progress.total}
            {progress.bytes && progress.bytes.total > 0
              ? ` · ${megas(progress.bytes.hechos)} de ${megas(progress.bytes.total)}`
              : ""}
          </span>
          <div className={styles.track}>
            <div
              className={styles.fill}
              style={{ width: `${fraccion(progress) * 100}%` }}
            />
          </div>
        </div>
      )}

      {exportProgreso && (
        <div className={styles.progressBar} role="status">
          <span>
            {exportProgreso.titulo}… {exportProgreso.done}/{exportProgreso.total}
          </span>
          <div className={styles.track}>
            <div
              className={styles.fill}
              style={{
                width: `${(exportProgreso.done / Math.max(1, exportProgreso.total)) * 100}%`,
              }}
            />
          </div>
        </div>
      )}

      {conflict && (
        <div className={styles.overlay}>
          <div className={styles.modal} role="dialog" aria-modal="true">
            <h3 className={styles.modalTitle}>Conflicto de nombre</h3>
            <p className={styles.modalText}>
              Ya existe «{conflict.nombre}» en la carpeta destino.
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
            <p className={styles.modalText}>{textoResumen(summary)}</p>
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

      {/* Diálogo de opciones de exportación a PDF (DEF-024). */}
      <PdfExportDialog />
    </>
  );
}
