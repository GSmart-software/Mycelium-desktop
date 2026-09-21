import { create } from "zustand";

/**
 * Lo que el usuario está escribiendo en Configuración y todavía no guardó
 * (`FUN-M-34`). Vive fuera del componente por dos motivos, los dos medidos en
 * la crítica de esa ventana (2026-09-20):
 *
 * 1. El panel se **remonta** al cambiar de categoría (`key` por categoría), así
 *    que un borrador en estado local moría con solo ir a mirar otra cosa.
 * 2. Al cerrar la ventana no había forma de saber que había trabajo sin
 *    guardar, y se perdía en silencio con Escape o con un clic en el velo.
 */
type BorradoresState = {
  /** Texto del editor de `.mycignore`; `null` = el editor está cerrado. */
  mycignore: string | null;
  /** ¿Lo escrito difiere de lo que hay en disco? */
  mycignoreSucio: boolean;
  setMycignore: (texto: string | null, sucio?: boolean) => void;
  /** ¿Hay algo sin guardar en toda la ventana? */
  haySinGuardar: () => boolean;
};

export const useBorradoresStore = create<BorradoresState>((set, get) => ({
  mycignore: null,
  mycignoreSucio: false,
  setMycignore: (mycignore, sucio = false) => set({ mycignore, mycignoreSucio: sucio }),
  haySinGuardar: () => get().mycignoreSucio,
}));
