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
  /** La ventana de ayuda (`FUN-L-27`, F1). */
  ayudaAbierta: boolean;
  /** La página que se pidió al abrirla (`escribir-notas/tareas`); `null` = la
   *  última que se leyó. */
  ayudaPagina: string | null;
  setSettingsOpen: (open: boolean) => void;
  setSearchInNoteOpen: (open: boolean) => void;
  setLiveTables: (on: boolean) => void;
  setPaleta: (modo: "notas" | "comandos" | null) => void;
  abrirAyuda: (pagina?: string) => void;
  cerrarAyuda: () => void;
};

const initialLiveTables =
  typeof window === "undefined" || localStorage.getItem("mic-live-tables") !== "0";

/**
 * Configuración, la paleta y la ayuda son ventanas modales, cada una con su
 * Escape y su trampa de foco (`useDialogoModal`): dos abiertas a la vez se
 * pelearían el teclado. Abrir una cierra las otras.
 */
export const useUiStore = create<UiState>((set) => ({
  settingsOpen: false,
  searchInNoteOpen: false,
  liveTables: initialLiveTables,
  paleta: null,
  ayudaAbierta: false,
  ayudaPagina: null,
  setSettingsOpen: (open) => set(open ? { settingsOpen: true, ayudaAbierta: false } : { settingsOpen: false }),
  setSearchInNoteOpen: (open) => set({ searchInNoteOpen: open }),
  setLiveTables: (on) => {
    if (typeof window !== "undefined") localStorage.setItem("mic-live-tables", on ? "1" : "0");
    set({ liveTables: on });
  },
  setPaleta: (modo) => set(modo ? { paleta: modo, ayudaAbierta: false } : { paleta: null }),
  abrirAyuda: (pagina) =>
    set({ ayudaAbierta: true, ayudaPagina: pagina ?? null, settingsOpen: false, paleta: null }),
  cerrarAyuda: () => set({ ayudaAbierta: false, ayudaPagina: null }),
}));
