import { create } from "zustand";

/**
 * Progreso de exportación del vault, GLOBAL (DEF-018). Vive fuera de la sección
 * de ajustes para que la barra de progreso NO se pierda al cerrar el menú de
 * opciones (la exportación puede tardar y el componente de ajustes se desmonta).
 * Lo renderiza un indicador a nivel de app (ver `ImportDialogs`), igual que el
 * progreso de importación.
 */
export type ExportProgreso = { done: number; total: number; titulo: string };

type ExportState = {
  progreso: ExportProgreso | null;
  setProgreso: (p: ExportProgreso | null) => void;
};

export const useExportStore = create<ExportState>((set) => ({
  progreso: null,
  setProgreso: (progreso) => set({ progreso }),
}));
