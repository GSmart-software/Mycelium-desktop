import { create } from "zustand";
import { persist } from "zustand/middleware";
import { GRAPH_TAB_ID } from "@/stores/tabsStore";

/** Id de la pestaña permanente del árbol de archivos (no se puede cerrar). */
export const EXPLORER_TAB = "explorer";

/**
 * Pestañas del explorador como visor (DEF-023 P3, estilo Obsidian): además del
 * árbol (pestaña permanente `EXPLORER_TAB`), la barra lateral puede alojar
 * documentos anclados (arrastrando una pestaña del área de trabajo). Cada
 * documento se ve en solo lectura por defecto, con opción de editar.
 */
type SidebarViewerState = {
  /** notaIds anclados como pestañas del explorador. */
  tabs: string[];
  /** Pestaña activa: `EXPLORER_TAB` o un notaId anclado. */
  activeTab: string;
  /** Por notaId: true si está en modo edición (por defecto solo lectura). */
  editing: Record<string, boolean>;

  /** Ancla un documento (si no estaba) y lo activa. */
  dock: (notaId: string) => void;
  /** Cierra una pestaña de documento; si era la activa vuelve al árbol. */
  cerrar: (notaId: string) => void;
  /** Activa una pestaña (árbol o documento). */
  activar: (tab: string) => void;
  /** Alterna ver/editar de un documento anclado. */
  toggleEdit: (notaId: string) => void;
  /** Descarta documentos anclados cuyas notas ya no existen. */
  reconcile: (validIds: Set<string>) => void;
};

export const useSidebarViewerStore = create<SidebarViewerState>()(
  persist(
    (set, get) => ({
      tabs: [],
      activeTab: EXPLORER_TAB,
      editing: {},

      dock(notaId) {
        const { tabs } = get();
        set({
          tabs: tabs.includes(notaId) ? tabs : [...tabs, notaId],
          activeTab: notaId,
        });
      },

      cerrar(notaId) {
        const { tabs, activeTab, editing } = get();
        const editingRest = { ...editing };
        delete editingRest[notaId];
        set({
          tabs: tabs.filter((id) => id !== notaId),
          editing: editingRest,
          activeTab: activeTab === notaId ? EXPLORER_TAB : activeTab,
        });
      },

      activar(tab) {
        set({ activeTab: tab });
      },

      toggleEdit(notaId) {
        set({ editing: { ...get().editing, [notaId]: !get().editing[notaId] } });
      },

      reconcile(validIds) {
        const { tabs, activeTab } = get();
        // El grafo no es una nota real: nunca se descarta por reconciliación.
        const rest = tabs.filter((id) => id === GRAPH_TAB_ID || validIds.has(id));
        if (rest.length === tabs.length) return;
        set({
          tabs: rest,
          activeTab: rest.includes(activeTab) ? activeTab : EXPLORER_TAB,
        });
      },
    }),
    {
      name: "mic-sidebar-viewer",
      version: 1,
      partialize: (state) => ({
        tabs: state.tabs,
        activeTab: state.activeTab,
        editing: state.editing,
      }),
    },
  ),
);
