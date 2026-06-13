import { create } from "zustand";
import {
  importFiles,
  type CollectedFile,
  type ConflictChoice,
  type ImportSummary,
} from "@/lib/import";

type ConflictPrompt = { nombre: string; resolve: (choice: ConflictChoice) => void };

type ImportState = {
  /** Progreso visible solo con más de 3 archivos (HU-07 CA7). */
  progress: { done: number; total: number } | null;
  conflict: ConflictPrompt | null;
  summary: ImportSummary | null;
  /** Etiqueta de la fuente para el resumen ("Importación", "Vault de Obsidian"). */
  titulo: string;

  run: (files: CollectedFile[], destFolderId: string | null, titulo?: string) => Promise<void>;
  answerConflict: (choice: ConflictChoice) => void;
  clearSummary: () => void;
};

export const useImportStore = create<ImportState>((set, get) => ({
  progress: null,
  conflict: null,
  summary: null,
  titulo: "Importación",

  async run(files, destFolderId, titulo = "Importación") {
    set({ summary: null, titulo, progress: { done: 0, total: files.length } });
    try {
      const summary = await importFiles(files, destFolderId, {
        onProgress: (done, total) => {
          // Solo mostramos barra para lotes grandes (CA7)
          set({ progress: total > 3 ? { done, total } : null });
        },
        resolveConflict: (nombre) =>
          new Promise<ConflictChoice>((resolve) => {
            set({ conflict: { nombre, resolve } });
          }),
      });
      set({ summary, progress: null });
    } catch (error) {
      set({
        progress: null,
        summary: { notas: 0, adjuntos: 0, omitidos: [(error as Error).message] },
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
