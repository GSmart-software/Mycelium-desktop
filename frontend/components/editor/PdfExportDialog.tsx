"use client";

import { exportNotePdf } from "@/lib/export";
import { usePdfExportStore } from "@/stores/pdfExportStore";
import type { PdfPrintOpts } from "@/lib/printStyles";
import styles from "../explorer/ImportDialogs.module.css";

const OPCIONES: { key: keyof PdfPrintOpts; label: string; hint: string }[] = [
  {
    key: "fondoBlanco",
    label: "Fondo blanco",
    hint: "Blanco con texto negro (si se desactiva, usa el fondo del tema de Mycelium).",
  },
  {
    key: "colores",
    label: "Incluir colores del texto",
    hint: "Conserva los acentos de color de Mycelium (enlaces, etiquetas, énfasis).",
  },
  {
    key: "callouts",
    label: "Estilar callouts",
    hint: "Renderiza los callouts como cajas; si no, como cita simple.",
  },
  {
    key: "estilosMycelium",
    label: "Estilos de Mycelium",
    hint: "Tipografía y estilo de Mycelium; si no, un documento plano y sobrio.",
  },
];

/**
 * Diálogo de opciones al exportar a PDF (DEF-024). Se monta a nivel de app (en
 * ImportDialogs). Lo abre `exportNotePdfActive` y aquí se elige tamaño y estilo.
 */
export function PdfExportDialog() {
  const solicitud = usePdfExportStore((s) => s.solicitud);
  const pageSize = usePdfExportStore((s) => s.pageSize);
  const opts = usePdfExportStore((s) => s.opts);
  const setPageSize = usePdfExportStore((s) => s.setPageSize);
  const setOpts = usePdfExportStore((s) => s.setOpts);
  const cerrar = usePdfExportStore((s) => s.cerrar);

  if (!solicitud) return null;

  const onExportar = () => {
    const { notaId, titulo } = solicitud;
    cerrar();
    void exportNotePdf(notaId, titulo, pageSize, opts).catch((e) => {
      if (typeof window !== "undefined") window.alert((e as Error).message);
    });
  };

  return (
    <div className={styles.overlay} onClick={cerrar}>
      <div
        className={styles.modal}
        role="dialog"
        aria-modal="true"
        aria-label="Opciones de exportación a PDF"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className={styles.modalTitle}>Exportar a PDF</h3>

        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", margin: "0.2rem 0 0.7rem" }}>
          <span style={{ fontSize: "0.8125rem", color: "var(--mic-text-muted)" }}>Tamaño</span>
          {(["A4", "Letter"] as const).map((p) => (
            <button
              key={p}
              type="button"
              className={p === pageSize ? styles.btnPrimary : styles.btn}
              onClick={() => setPageSize(p)}
            >
              {p}
            </button>
          ))}
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: "0.55rem" }}>
          {OPCIONES.map((o) => (
            <label
              key={o.key}
              style={{ display: "flex", gap: "0.5rem", alignItems: "flex-start", cursor: "pointer" }}
            >
              <input
                type="checkbox"
                checked={opts[o.key]}
                onChange={(e) => setOpts({ [o.key]: e.target.checked })}
                style={{ marginTop: "0.15rem" }}
              />
              <span>
                <span style={{ fontSize: "0.85rem" }}>{o.label}</span>
                <br />
                <span style={{ fontSize: "0.75rem", color: "var(--mic-text-muted)" }}>{o.hint}</span>
              </span>
            </label>
          ))}
        </div>

        <div className={styles.modalActions}>
          <button type="button" className={styles.btnPrimary} onClick={onExportar}>
            Exportar
          </button>
          <button type="button" className={styles.btn} onClick={cerrar}>
            Cancelar
          </button>
        </div>
      </div>
    </div>
  );
}
