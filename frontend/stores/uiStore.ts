import { create } from "zustand";

type UiState = {
  /** Settings drawer deslizable desde la derecha (HU-28 CA4, HU-38 CA6). */
  settingsOpen: boolean;
  /** Barra de búsqueda en la nota activa (HU-31, entry points en HU-38). */
  searchInNoteOpen: boolean;
  /** Carpeta a compartir/gestionar; abre el ShareModal (HU-35/36). */
  shareTarget: { id: string; nombre: string } | null;
  /** Renderizar tablas en la edición en vivo (toggle del menú "…"). */
  liveTables: boolean;
  setSettingsOpen: (open: boolean) => void;
  setSearchInNoteOpen: (open: boolean) => void;
  setShareTarget: (target: { id: string; nombre: string } | null) => void;
  setLiveTables: (on: boolean) => void;
};

const initialLiveTables =
  typeof window === "undefined" || localStorage.getItem("mic-live-tables") !== "0";

export const useUiStore = create<UiState>((set) => ({
  settingsOpen: false,
  searchInNoteOpen: false,
  shareTarget: null,
  liveTables: initialLiveTables,
  setSettingsOpen: (open) => set({ settingsOpen: open }),
  setSearchInNoteOpen: (open) => set({ searchInNoteOpen: open }),
  setShareTarget: (target) => set({ shareTarget: target }),
  setLiveTables: (on) => {
    if (typeof window !== "undefined") localStorage.setItem("mic-live-tables", on ? "1" : "0");
    set({ liveTables: on });
  },
}));
