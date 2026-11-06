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
  /**
   * La cajita de la captura rápida (`FUN-L-33`, Ctrl+Shift+Espacio). No es una
   * ventana modal como las de arriba: flota sobre lo que esté abierto y se
   * cierra sola con Esc o un clic afuera. Abrirla cierra la paleta.
   */
  capturaAbierta: boolean;
  /** La hoja de atajos (`FUN-XL-04`, Parte 3, Ctrl+Shift+/). Ventana modal. */
  hojaAtajos: boolean;
  /** La categoría de Configuración que se pidió al abrirla; `null` = la última. */
  ajustesCategoria: string | null;
  setHojaAtajos: (abierta: boolean) => void;
  /** Abre Configuración en una categoría («atajos»). */
  abrirAjustes: (categoria?: string) => void;
  setCaptura: (abierta: boolean) => void;
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
  capturaAbierta: false,
  hojaAtajos: false,
  ajustesCategoria: null,
  setHojaAtajos: (abierta) =>
    set(
      abierta
        ? { hojaAtajos: true, paleta: null, settingsOpen: false, ayudaAbierta: false, capturaAbierta: false }
        : { hojaAtajos: false },
    ),
  abrirAjustes: (categoria) =>
    set({ settingsOpen: true, ajustesCategoria: categoria ?? null, ayudaAbierta: false, paleta: null, hojaAtajos: false }),
  setCaptura: (abierta) => set(abierta ? { capturaAbierta: true, paleta: null } : { capturaAbierta: false }),
  setSettingsOpen: (open) =>
    set(open ? { settingsOpen: true, ayudaAbierta: false, hojaAtajos: false } : { settingsOpen: false }),
  setSearchInNoteOpen: (open) => set({ searchInNoteOpen: open }),
  setLiveTables: (on) => {
    if (typeof window !== "undefined") localStorage.setItem("mic-live-tables", on ? "1" : "0");
    set({ liveTables: on });
  },
  setPaleta: (modo) =>
    set(modo ? { paleta: modo, ayudaAbierta: false, capturaAbierta: false, hojaAtajos: false } : { paleta: null }),
  abrirAyuda: (pagina) =>
    set({ ayudaAbierta: true, ayudaPagina: pagina ?? null, settingsOpen: false, paleta: null, hojaAtajos: false }),
  cerrarAyuda: () => set({ ayudaAbierta: false, ayudaPagina: null }),
}));
