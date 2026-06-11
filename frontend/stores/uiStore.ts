import { create } from "zustand";

type UiState = {
  /** Settings drawer deslizable desde la derecha (HU-28 CA4, HU-38 CA6). */
  settingsOpen: boolean;
  /** Barra de búsqueda en la nota activa (HU-31, entry points en HU-38). */
  searchInNoteOpen: boolean;
  setSettingsOpen: (open: boolean) => void;
  setSearchInNoteOpen: (open: boolean) => void;
};

export const useUiStore = create<UiState>((set) => ({
  settingsOpen: false,
  searchInNoteOpen: false,
  setSettingsOpen: (open) => set({ settingsOpen: open }),
  setSearchInNoteOpen: (open) => set({ searchInNoteOpen: open }),
}));
