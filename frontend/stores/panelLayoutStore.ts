import { create } from "zustand";
import { persist } from "zustand/middleware";

/** Secciones del panel izquierdo activadas desde el rail (HU-28). El grafo ya
 * no es una sección: se abre como ventana en el área de panes. */
export type RailSection = "explorer" | "search" | "tags" | "trash";

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

export const usePanelLayoutStore = create<PanelLayoutState>()(
  persist(
    (set, get) => ({
      activeSection: "explorer",
      lastSection: "explorer",
      leftWidth: 240,
      rightWidth: 280,
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
        set({ rightWidth: clamp(width) });
      },
    }),
    { name: "micelio-panel-layout" },
  ),
);
