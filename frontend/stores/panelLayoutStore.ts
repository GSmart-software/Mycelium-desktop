import { create } from "zustand";
import { persist } from "zustand/middleware";

/** Secciones del panel izquierdo activadas desde el rail (HU-28). El grafo ya
 * no es una sección: se abre como ventana en el área de panes. `terminal` es el
 * panel de consolas (FUN-L-07, solo-desktop) y `esporas` el de plantillas
 * (FUN-M-03). */
export type RailSection = "explorer" | "search" | "tags" | "esporas" | "trash" | "terminal";

export const PANEL_MIN_WIDTH = 160;
export const PANEL_MAX_WIDTH = 480;

type PanelLayoutState = {
  /** Sección activa del panel izquierdo; null = colapsado. */
  activeSection: RailSection | null;
  /** Última sección activa, para restaurar con Ctrl+\ . */
  lastSection: RailSection;
  leftWidth: number;
  rightWidth: number;
  rightOpen: boolean;
  /** Toggle desde el rail: clic en ícono activo colapsa el panel (HU-28 CA8). */
  toggleSection: (section: RailSection) => void;
  /** Ctrl+\ : colapsa/restaura el panel izquierdo (HU-29 CA2). */
  toggleLeft: () => void;
  /** Ctrl+Shift+\ : colapsa/expande el panel derecho (HU-29 CA3). */
  toggleRight: () => void;
  setLeftWidth: (width: number) => void;
  setRightWidth: (width: number) => void;
};

const clamp = (width: number) =>
  Math.min(PANEL_MAX_WIDTH, Math.max(PANEL_MIN_WIDTH, width));

// El panel derecho (metadatos/conexiones) admite más ancho: tiene grafo, listas
// y metadatos que necesitan espacio para no recortarse.
const RIGHT_MIN_WIDTH = 240;
const RIGHT_MAX_WIDTH = 680;
const clampRight = (width: number) =>
  Math.min(RIGHT_MAX_WIDTH, Math.max(RIGHT_MIN_WIDTH, width));

export const usePanelLayoutStore = create<PanelLayoutState>()(
  persist(
    (set, get) => ({
      activeSection: "explorer",
      lastSection: "explorer",
      leftWidth: 240,
      rightWidth: 340,
      rightOpen: false,

      toggleSection(section) {
        const { activeSection } = get();
        if (activeSection === section) {
          set({ activeSection: null });
        } else {
          set({ activeSection: section, lastSection: section });
        }
      },

      toggleLeft() {
        const { activeSection, lastSection } = get();
        set({ activeSection: activeSection === null ? lastSection : null });
      },

      toggleRight() {
        set((state) => ({ rightOpen: !state.rightOpen }));
      },

      setLeftWidth(width) {
        set({ leftWidth: clamp(width) });
      },

      setRightWidth(width) {
        set({ rightWidth: clampRight(width) });
      },
    }),
    {
      name: "micelio-panel-layout",
      version: 1,
      // v1: el panel derecho se embebió en el editor y se agrandó; descartar el
      // ancho viejo (280, muy chico) para que tome el nuevo default cómodo.
      migrate: (persisted, version) => {
        const s = (persisted ?? {}) as Partial<PanelLayoutState>;
        if (version < 1) return { ...s, rightWidth: 340 } as PanelLayoutState;
        return s as PanelLayoutState;
      },
    },
  ),
);
