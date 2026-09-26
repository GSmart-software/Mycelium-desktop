import { create } from "zustand";

type UiState = {
  /** Settings drawer deslizable desde la derecha (HU-28 CA4, HU-38 CA6). */
  settingsOpen: boolean;
  /** Barra de búsqueda en la nota activa (HU-31, entry points en HU-38). */
  searchInNoteOpen: boolean;
  /** Renderizar tablas en la edición en vivo (toggle del menú "…"). */
  liveTables: boolean;
  /** Paleta de la barra superior: ir a una nota (Ctrl+O) o ejecutar un comando
   *  (Ctrl+P). `null` = cerrada. */
  paleta: "notas" | "comandos" | null;
  setSettingsOpen: (open: boolean) => void;
  setSearchInNoteOpen: (open: boolean) => void;
  setLiveTables: (on: boolean) => void;
  setPaleta: (modo: "notas" | "comandos" | null) => void;
};

const initialLiveTables =
  typeof window === "undefined" || localStorage.getItem("mic-live-tables") !== "0";

export const useUiStore = create<UiState>((set) => ({
  settingsOpen: false,
  searchInNoteOpen: false,
  liveTables: initialLiveTables,
  paleta: null,
  setSettingsOpen: (open) => set({ settingsOpen: open }),
  setSearchInNoteOpen: (open) => set({ searchInNoteOpen: open }),
  setLiveTables: (on) => {
    if (typeof window !== "undefined") localStorage.setItem("mic-live-tables", on ? "1" : "0");
    set({ liveTables: on });
  },
  setPaleta: (modo) => set({ paleta: modo }),
}));
