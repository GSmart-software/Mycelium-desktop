import { create } from "zustand";
import { persist } from "zustand/middleware";
import { GRAPH_TAB_ID } from "@/stores/tabsStore";

/**
 * Documentos anclados en el explorador (DEF-023 P3, estilo Obsidian). El árbol de
 * archivos SIEMPRE está arriba; debajo, en una región redimensionable, se muestran
 * los documentos anclados (arrastrando una pestaña del área de trabajo), con su
 * propia barra de pestañas. Cada documento se ve en solo lectura por defecto, con
 * opción de editar. Se pueden devolver al área de trabajo arrastrándolos.
 */
type SidebarViewerState = {
  /** Documentos anclados (notaIds o `GRAPH_TAB_ID`). */
  tabs: string[];
  /** Documento activo en la región inferior; "" si no hay ninguno. */
  activeTab: string;
  /** Por documento: true si está en modo edición (por defecto solo lectura). */
  editing: Record<string, boolean>;
  /** Alto (px) de la región de documentos (divisor arrastrable). */
  docsHeight: number;

  /** Ancla un documento (si no estaba) y lo activa. */
  dock: (notaId: string) => void;
  /** Cierra un documento; si era el activo, pasa a otro (o a ninguno). */
  cerrar: (notaId: string) => void;
  /** Activa un documento anclado. */
  activar: (notaId: string) => void;
  /** Alterna ver/editar de un documento anclado. */
  toggleEdit: (notaId: string) => void;
  /** Ajusta el alto de la región de documentos (min 120px). */
  setDocsHeight: (px: number) => void;
  /** Descarta documentos anclados cuyas notas ya no existen. */
  reconcile: (validIds: Set<string>) => void;
};

export const useSidebarViewerStore = create<SidebarViewerState>()(
  persist(
    (set, get) => ({
      tabs: [],
      activeTab: "",
      editing: {},
      docsHeight: 300,

      dock(notaId) {
        const { tabs } = get();
        set({
          tabs: tabs.includes(notaId) ? tabs : [...tabs, notaId],
          activeTab: notaId,
        });
      },

      cerrar(notaId) {
        const { tabs, activeTab, editing } = get();
        const rest = tabs.filter((id) => id !== notaId);
        const editingRest = { ...editing };
        delete editingRest[notaId];
        set({
          tabs: rest,
          editing: editingRest,
          activeTab: activeTab === notaId ? rest[rest.length - 1] ?? "" : activeTab,
        });
      },

      activar(notaId) {
        set({ activeTab: notaId });
      },

      toggleEdit(notaId) {
        set({ editing: { ...get().editing, [notaId]: !get().editing[notaId] } });
      },

      setDocsHeight(px) {
        set({ docsHeight: Math.max(120, px) });
      },

      reconcile(validIds) {
        const { tabs, activeTab } = get();
        // El grafo no es una nota real: nunca se descarta por reconciliación.
        const rest = tabs.filter((id) => id === GRAPH_TAB_ID || validIds.has(id));
        if (rest.length === tabs.length) return;
        set({
          tabs: rest,
          activeTab: rest.includes(activeTab) ? activeTab : rest[rest.length - 1] ?? "",
        });
      },
    }),
    {
      name: "mic-sidebar-viewer",
      version: 2,
      partialize: (state) => ({
        tabs: state.tabs,
        activeTab: state.activeTab,
        editing: state.editing,
        docsHeight: state.docsHeight,
      }),
    },
  ),
);
