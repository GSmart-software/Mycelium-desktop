import { create } from "zustand";
import { persist } from "zustand/middleware";
import { PDF_OPTS_DEFAULT, type PdfPrintOpts } from "@/lib/printStyles";

type Solicitud = { notaId: string; titulo: string };

/**
 * Estado del diálogo de exportación a PDF (DEF-024). `solicitud` (transitoria)
 * abre el diálogo para una nota; `opts`/`pageSize` se recuerdan entre exportaciones.
 */
type PdfExportState = {
  solicitud: Solicitud | null;
  pageSize: "A4" | "Letter";
  opts: PdfPrintOpts;
  abrir: (s: Solicitud) => void;
  cerrar: () => void;
  setPageSize: (p: "A4" | "Letter") => void;
  setOpts: (patch: Partial<PdfPrintOpts>) => void;
};

export const usePdfExportStore = create<PdfExportState>()(
  persist(
    (set) => ({
      solicitud: null,
      pageSize: "A4",
      opts: PDF_OPTS_DEFAULT,
      abrir: (solicitud) => set({ solicitud }),
      cerrar: () => set({ solicitud: null }),
      setPageSize: (pageSize) => set({ pageSize }),
      setOpts: (patch) => set((s) => ({ opts: { ...s.opts, ...patch } })),
    }),
    {
      name: "mic-pdf-export",
      // Solo se recuerdan las preferencias, no la solicitud puntual.
      partialize: (s) => ({ pageSize: s.pageSize, opts: s.opts }),
    },
  ),
);
