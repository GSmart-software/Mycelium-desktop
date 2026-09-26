import { create } from "zustand";
import {
  importarArchivos,
  importarCarpeta,
  type CollectedFile,
  type ConflictChoice,
  type ImportSummary,
} from "@/lib/import";

type ConflictPrompt = { nombre: string; resolve: (choice: ConflictChoice) => void };

/**
 * De dónde sale lo que se importa: una carpeta del disco (su ruta) o archivos
 * sueltos —un .zip ya abierto, lo soltado, lo elegido—. Los dos terminan en la
 * misma copia de árbol (`lib/import.ts`, `FUN-M-40`).
 */
export type FuenteImportacion = { carpeta: string } | { archivos: CollectedFile[] };

type ImportState = {
  /** Progreso visible solo con más de 3 archivos (HU-07 CA7). */
  progress: { done: number; total: number } | null;
  conflict: ConflictPrompt | null;
  summary: ImportSummary | null;
  /** Etiqueta de la fuente para el resumen ("Importación", "Vault de Obsidian"). */
  titulo: string;

  run: (fuente: FuenteImportacion, destFolderId: string | null, titulo?: string) => Promise<void>;
  answerConflict: (choice: ConflictChoice) => void;
  clearSummary: () => void;
};

export const useImportStore = create<ImportState>((set, get) => ({
  progress: null,
  conflict: null,
  summary: null,
  titulo: "Importación",

  async run(fuente, destFolderId, titulo = "Importación") {
    set({ summary: null, titulo, progress: null });
    const opts = {
      onProgress: (done: number, total: number) => {
        // Solo mostramos barra para lotes grandes (CA7)
        set({ progress: total > 3 && done < total ? { done, total } : null });
      },
      resolveConflict: (nombre: string) =>
        new Promise<ConflictChoice>((resolve) => {
          set({ conflict: { nombre, resolve } });
        }),
    };
    try {
      const summary =
        "carpeta" in fuente
          ? await importarCarpeta(fuente.carpeta, destFolderId, opts)
          : await importarArchivos(fuente.archivos, destFolderId, opts);
      set({ summary, progress: null });
    } catch (error) {
      set({
        progress: null,
        summary: { notas: 0, adjuntos: 0, omitidos: [(error as Error).message ?? String(error)] },
      });
    }
  },

  answerConflict(choice) {
    const { conflict } = get();
    if (conflict) {
      conflict.resolve(choice);
      set({ conflict: null });
    }
  },

  clearSummary() {
    set({ summary: null });
  },
}));
