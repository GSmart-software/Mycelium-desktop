import { create } from "zustand";
import { persist } from "zustand/middleware";
import { GRAPH_TAB_ID } from "@/stores/tabsStore";

/**
 * Valor de `activeTab` que representa la pestaña del árbol de archivos. Solo se usa
 * en modo `full` (en `split` el árbol está siempre arriba, no como pestaña).
 */
export const EXPLORER_TAB = "explorer";

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
  /** Alto (px) de la región de documentos (divisor arrastrable, solo en `split`). */
  docsHeight: number;
  /**
   * Disposición del visor: `split` = árbol arriba + documento abajo (redimensionable);
   * `full` = el documento ocupa todo el explorador (el árbol queda oculto). El usuario
   * alterna con el botón de maximizar/restaurar.
   */
  mode: "split" | "full";

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
  /** Alterna entre documento dividido (`split`) y a pantalla completa (`full`). */
  toggleMode: () => void;
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
      mode: "split",

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

      toggleMode() {
        set({ mode: get().mode === "split" ? "full" : "split" });
      },

      reconcile(validIds) {
        const { tabs, activeTab } = get();
        // El grafo, las consolas (FUN-L-07) y los visores de archivos que no se
        // indexan (FUN-L-11) no son notas reales: nunca se descartan por esta
        // reconciliación, que solo conoce las notas del índice.
        const rest = tabs.filter(
          (id) =>
            id === GRAPH_TAB_ID ||
            id.startsWith("terminal:") ||
            id.startsWith("archivo:") ||
            validIds.has(id),
        );
        if (rest.length === tabs.length) return;
        // `EXPLORER_TAB` (árbol) siempre es un activeTab válido.
        const activaOk = activeTab === EXPLORER_TAB || rest.includes(activeTab);
        set({
          tabs: rest,
          activeTab: activaOk ? activeTab : rest[rest.length - 1] ?? "",
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
        mode: state.mode,
      }),
    },
  ),
);
