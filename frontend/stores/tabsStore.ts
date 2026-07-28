import { create } from "zustand";
import { persist } from "zustand/middleware";
import { usePreferencesStore } from "@/stores/preferencesStore";

/**
 * Id sentinela para la pestaña del grafo global: se abre como una ventana más
 * en el área de panes (estilo Obsidian), no en el panel de archivos.
 */
export const GRAPH_TAB_ID = "graph:global";

/**
 * Pestaña: instancia de una nota abierta en un pane (HU-25). `preview` marca
 * la pestaña efímera (estilo Obsidian/VSCode): si solo se está viendo el
 * archivo, abrir otro la reemplaza; al editarla o fijarla pasa a permanente.
 */
export type Tab = { id: string; notaId: string; preview?: boolean };

export type LeafPane = {
  id: string;
  type: "leaf";
  tabs: Tab[];
  activeTabId: string | null;
  /** HU-27: pane vinculado como preview del pane origen. */
  linkedTo: string | null;
  /** HU-27 CA4: scroll sincronizado con el origen. */
  linkedScrollSync: boolean;
};

export type SplitPane = {
  id: string;
  type: "split";
  direction: "row" | "column";
  children: PaneNode[];
  /** Fracciones de espacio por hijo (suman 1) — divisor arrastrable (HU-26 CA4). */
  sizes: number[];
};

export type PaneNode = LeafPane | SplitPane;

export type SplitEdge = "top" | "bottom" | "left" | "right";

const newId = () => Math.random().toString(36).slice(2, 10);

const makeLeaf = (tabs: Tab[] = [], activeTabId: string | null = null): LeafPane => ({
  id: newId(),
  type: "leaf",
  tabs,
  activeTabId,
  linkedTo: null,
  linkedScrollSync: false,
});

type TabsState = {
  root: PaneNode;
  activePaneId: string;
  /** Historial de notas cerradas para Ctrl+Shift+T (máx 10, HU-25 CA7). */
  closedHistory: string[];
  /** Tab en drag activo (para mostrar las zonas de split). */
  dragging: { srcPaneId: string; tabId: string } | null;
  /**
   * Nota en drag DESDE el explorador (DEF-023 P2): mientras está activa, los panes
   * muestran sus zonas de drop (bordes = dividir, barra de pestañas = abrir). El
   * drop real lo resuelve el explorador por hit-test (dnd-kit no llega a los panes).
   */
  draggingNota: string | null;

  openNote: (notaId: string) => void;
  /** Abre la nota en una pestaña nueva sin robar el foco (clic con la rueda). */
  openNoteBackground: (notaId: string) => void;
  /** Fija una pestaña de preview como permanente (al editar o doble-clic). */
  pinTab: (paneId: string, tabId: string) => void;
  activateTab: (paneId: string, tabId: string) => void;
  closeTab: (paneId: string, tabId: string) => void;
  closeActiveTab: () => void;
  reopenLastClosed: () => void;
  reorderTab: (paneId: string, fromIndex: number, toIndex: number) => void;
  moveTabToPane: (srcPaneId: string, tabId: string, dstPaneId: string) => void;
  splitWithTab: (srcPaneId: string, tabId: string, dstPaneId: string, edge: SplitEdge) => void;
  /** Divide el pane abriendo la nota activa en un pane nuevo (menú "Dividir"). */
  splitActivePane: (paneId: string, edge: SplitEdge) => void;
  setSizes: (splitId: string, sizes: number[]) => void;
  setActivePane: (paneId: string) => void;
  linkPane: (paneId: string, sourcePaneId: string | null) => void;
  toggleLinkedScrollSync: (paneId: string) => void;
  setDragging: (dragging: TabsState["dragging"]) => void;
  setDraggingNota: (notaId: string | null) => void;
  /** Abre una nota como pestaña en un pane concreto (drop en su barra de pestañas). */
  openNotaInPane: (notaId: string, paneId: string) => void;
  /** Divide un pane abriendo una nota en un pane nuevo a un lado (drop en un borde). */
  splitPaneWithNota: (notaId: string, dstPaneId: string, edge: SplitEdge) => void;
  /** Nota activa del pane activo (para sincronizar la URL). */
  activeNotaId: () => string | null;
  /** Cierra las pestañas de una nota en todos los panes (al ir a papelera). */
  closeNotaEverywhere: (notaId: string) => void;
  /**
   * Reapunta las pestañas (y el historial de cerradas) de una nota a su id nuevo.
   * En modo carpeta la identidad es la ruta, así que renombrar/mover una nota
   * cambia su id: la pestaña abierta debe seguir a la nota, no quedar huérfana.
   */
  remapNota: (oldId: string, newId: string) => void;
  /**
   * Reapunta las pestañas cuyo id cuelga de una carpeta renombrada/movida
   * (prefijo `oldPrefix` → `newPrefix`): al cambiar la ruta de la carpeta cambian
   * los ids (=ruta) de todas las notas de su subárbol.
   */
  remapCarpeta: (oldPrefix: string, newPrefix: string) => void;
  /**
   * Tras restaurar el layout persistido, descarta las pestañas cuyas notas ya
   * no existen en el vault (borradas mientras estaba cerrado). Se llama una vez
   * cuando el árbol del vault termina de cargar.
   */
  reconcileNotes: (validIds: Set<string>) => void;
};

// ── Helpers de árbol ──────────────────────────────────────────────

function findLeaf(node: PaneNode, paneId: string): LeafPane | null {
  if (node.type === "leaf") return node.id === paneId ? node : null;
  for (const child of node.children) {
    const found = findLeaf(child, paneId);
    if (found) return found;
  }
  return null;
}

function firstLeaf(node: PaneNode): LeafPane {
  return node.type === "leaf" ? node : firstLeaf(node.children[0]);
}

function allLeaves(node: PaneNode): LeafPane[] {
  return node.type === "leaf"
    ? [node]
    : node.children.flatMap((child) => allLeaves(child));
}

function mapTree(node: PaneNode, fn: (leaf: LeafPane) => PaneNode): PaneNode {
  if (node.type === "leaf") return fn(node);
  return { ...node, children: node.children.map((child) => mapTree(child, fn)) };
}

/**
 * Elimina panes hoja vacíos (HU-26 CA7): el espacio se redistribuye y los
 * splits con un solo hijo se aplanan. El root nunca se elimina.
 */
function pruneEmpty(node: PaneNode): PaneNode {
  if (node.type === "leaf") return node;
  const kept: PaneNode[] = [];
  const sizes: number[] = [];
  node.children.forEach((child, index) => {
    const pruned = pruneEmpty(child);
    if (pruned.type === "leaf" && pruned.tabs.length === 0) return;
    kept.push(pruned);
    sizes.push(node.sizes[index] ?? 1 / node.children.length);
  });
  if (kept.length === 0) return makeLeaf();
  if (kept.length === 1) return kept[0];
  const total = sizes.reduce((a, b) => a + b, 0);
  return { ...node, children: kept, sizes: sizes.map((s) => s / total) };
}

/** Rompe vínculos de preview hacia panes que ya no existen (HU-27 CA5). */
function cleanLinks(node: PaneNode): PaneNode {
  const ids = new Set(allLeaves(node).map((leaf) => leaf.id));
  return mapTree(node, (leaf) =>
    leaf.linkedTo !== null && !ids.has(leaf.linkedTo)
      ? { ...leaf, linkedTo: null }
      : leaf,
  );
}

const initialRoot = makeLeaf();

export const useTabsStore = create<TabsState>()(
  persist(
    (set, get) => ({
  root: initialRoot,
  activePaneId: initialRoot.id,
  closedHistory: [],
  dragging: null,
  draggingNota: null,

  openNote(notaId) {
    const { root, activePaneId } = get();
    let targetLeaf = findLeaf(root, activePaneId) ?? firstLeaf(root);
    // Si el pane activo es un preview vinculado, abrir en otro pane editable
    if (targetLeaf.linkedTo !== null) {
      targetLeaf =
        allLeaves(root).find((l) => l.linkedTo === null) ?? targetLeaf;
    }
    const existing = targetLeaf.tabs.find((t) => t.notaId === notaId);
    if (existing) {
      if (targetLeaf.activeTabId === existing.id) return;
      set({
        root: mapTree(root, (leaf) =>
          leaf.id === targetLeaf.id ? { ...leaf, activeTabId: existing.id } : leaf,
        ),
        activePaneId: targetLeaf.id,
      });
      return;
    }

    // Pestañas de preview (estilo Obsidian): si la pestaña activa solo se está
    // viendo (preview) y el grafo no, se reemplaza en vez de abrir una nueva.
    const previewEnabled = usePreferencesStore.getState().prefs.previewTabs;
    const isPreview = notaId !== GRAPH_TAB_ID && previewEnabled;
    const activeTab = targetLeaf.tabs.find((t) => t.id === targetLeaf.activeTabId);
    const replace =
      previewEnabled &&
      activeTab?.preview === true &&
      activeTab.notaId !== GRAPH_TAB_ID;

    // Id nuevo siempre (el editor se monta por instancia de pestaña): al
    // reemplazar, ocupa el lugar de la pestaña de preview sin arrastrar estado.
    const newTab: Tab = { id: newId(), notaId, preview: isPreview };
    set({
      root: mapTree(root, (leaf) =>
        leaf.id === targetLeaf.id
          ? {
              ...leaf,
              tabs: replace
                ? leaf.tabs.map((t) => (t.id === activeTab!.id ? newTab : t))
                : [...leaf.tabs, newTab],
              activeTabId: newTab.id,
            }
          : leaf,
      ),
      activePaneId: targetLeaf.id,
    });
  },

  openNoteBackground(notaId) {
    const { root, activePaneId } = get();
    let targetLeaf = findLeaf(root, activePaneId) ?? firstLeaf(root);
    if (targetLeaf.linkedTo !== null) {
      targetLeaf = allLeaves(root).find((l) => l.linkedTo === null) ?? targetLeaf;
    }
    // Si no hay ningún archivo visible, abrir normal (con foco).
    if (targetLeaf.activeTabId === null || targetLeaf.tabs.length === 0) {
      get().openNote(notaId);
      return;
    }
    // Si ya está abierta, no robar el foco ni duplicar.
    if (targetLeaf.tabs.some((t) => t.notaId === notaId)) return;

    // Pestaña permanente en segundo plano: se conserva el foco actual.
    const newTab: Tab = { id: newId(), notaId, preview: false };
    set({
      root: mapTree(root, (leaf) =>
        leaf.id === targetLeaf.id ? { ...leaf, tabs: [...leaf.tabs, newTab] } : leaf,
      ),
    });
  },

  pinTab(paneId, tabId) {
    const leaf = findLeaf(get().root, paneId);
    const tab = leaf?.tabs.find((t) => t.id === tabId);
    if (!tab || !tab.preview) return; // ya es permanente: nada que hacer
    set({
      root: mapTree(get().root, (l) =>
        l.id === paneId
          ? { ...l, tabs: l.tabs.map((t) => (t.id === tabId ? { ...t, preview: false } : t)) }
          : l,
      ),
    });
  },

  activateTab(paneId, tabId) {
    set({
      root: mapTree(get().root, (leaf) =>
        leaf.id === paneId ? { ...leaf, activeTabId: tabId } : leaf,
      ),
      activePaneId: paneId,
    });
  },

  closeTab(paneId, tabId) {
    const leaf = findLeaf(get().root, paneId);
    const closed = leaf?.tabs.find((t) => t.id === tabId);
    if (!leaf || !closed) return;

    const remaining = leaf.tabs.filter((t) => t.id !== tabId);
    const closedIndex = leaf.tabs.findIndex((t) => t.id === tabId);
    const nextActive =
      leaf.activeTabId === tabId
        ? remaining[Math.min(closedIndex, remaining.length - 1)]?.id ?? null
        : leaf.activeTabId;

    let root = mapTree(get().root, (l) =>
      l.id === paneId ? { ...l, tabs: remaining, activeTabId: nextActive } : l,
    );
    root = cleanLinks(pruneEmpty(root));

    const activeStillExists = findLeaf(root, get().activePaneId) !== null;
    set({
      root,
      activePaneId: activeStillExists ? get().activePaneId : firstLeaf(root).id,
      closedHistory: [closed.notaId, ...get().closedHistory].slice(0, 10),
    });
  },

  closeActiveTab() {
    const { activePaneId, root } = get();
    const leaf = findLeaf(root, activePaneId);
    if (leaf?.activeTabId) get().closeTab(activePaneId, leaf.activeTabId);
  },

  reopenLastClosed() {
    const [last, ...rest] = get().closedHistory;
    if (!last) return;
    set({ closedHistory: rest });
    get().openNote(last);
  },

  reorderTab(paneId, fromIndex, toIndex) {
    set({
      root: mapTree(get().root, (leaf) => {
        if (leaf.id !== paneId) return leaf;
        const tabs = [...leaf.tabs];
        const [moved] = tabs.splice(fromIndex, 1);
        tabs.splice(toIndex, 0, moved);
        return { ...leaf, tabs };
      }),
    });
  },

  moveTabToPane(srcPaneId, tabId, dstPaneId) {
    if (srcPaneId === dstPaneId) return;
    const src = findLeaf(get().root, srcPaneId);
    const tab = src?.tabs.find((t) => t.id === tabId);
    if (!tab) return;

    let root = mapTree(get().root, (leaf) => {
      if (leaf.id === srcPaneId) {
        const tabs = leaf.tabs.filter((t) => t.id !== tabId);
        return {
          ...leaf,
          tabs,
          activeTabId:
            leaf.activeTabId === tabId ? tabs[0]?.id ?? null : leaf.activeTabId,
        };
      }
      if (leaf.id === dstPaneId) {
        const existing = leaf.tabs.find((t) => t.notaId === tab.notaId);
        if (existing) return { ...leaf, activeTabId: existing.id };
        return { ...leaf, tabs: [...leaf.tabs, tab], activeTabId: tab.id };
      }
      return leaf;
    });
    root = cleanLinks(pruneEmpty(root));
    set({ root, activePaneId: dstPaneId });
  },

  splitWithTab(srcPaneId, tabId, dstPaneId, edge) {
    const src = findLeaf(get().root, srcPaneId);
    const tab = src?.tabs.find((t) => t.id === tabId);
    if (!tab) return;

    // Si es la única pestaña y se divide sobre su propio pane, se DUPLICA la
    // nota en el nuevo pane (si se moviera, el origen quedaría vacío y el split
    // se aplanaría). Así "dividir" con una sola pestaña funciona como Obsidian.
    const duplicate = srcPaneId === dstPaneId && src!.tabs.length === 1;
    const newTab: Tab = duplicate ? { id: newId(), notaId: tab.notaId } : tab;
    const newLeaf = makeLeaf([newTab], newTab.id);
    const direction: SplitPane["direction"] =
      edge === "left" || edge === "right" ? "row" : "column";
    const before = edge === "left" || edge === "top";

    function insert(node: PaneNode): PaneNode {
      if (node.type === "leaf") {
        // Quitar el tab del pane origen (salvo cuando se duplica)
        let leaf = node;
        if (!duplicate && leaf.id === srcPaneId) {
          const tabs = leaf.tabs.filter((t) => t.id !== tabId);
          leaf = {
            ...leaf,
            tabs,
            activeTabId:
              leaf.activeTabId === tabId ? tabs[0]?.id ?? null : leaf.activeTabId,
          };
        }
        if (leaf.id !== dstPaneId) return leaf;
        const split: SplitPane = {
          id: newId(),
          type: "split",
          direction,
          children: before ? [newLeaf, leaf] : [leaf, newLeaf],
          sizes: [0.5, 0.5],
        };
        return split;
      }
      return { ...node, children: node.children.map(insert) };
    }

    const root = cleanLinks(pruneEmpty(insert(get().root)));
    set({ root, activePaneId: newLeaf.id, dragging: null });
  },

  splitActivePane(paneId, edge) {
    const leaf = findLeaf(get().root, paneId);
    if (leaf?.activeTabId) get().splitWithTab(paneId, leaf.activeTabId, paneId, edge);
  },

  setSizes(splitId, sizes) {
    function update(node: PaneNode): PaneNode {
      if (node.type === "leaf") return node;
      if (node.id === splitId) return { ...node, sizes };
      return { ...node, children: node.children.map(update) };
    }
    set({ root: update(get().root) });
  },

  setActivePane(paneId) {
    set({ activePaneId: paneId });
  },

  linkPane(paneId, sourcePaneId) {
    set({
      root: mapTree(get().root, (leaf) =>
        leaf.id === paneId ? { ...leaf, linkedTo: sourcePaneId } : leaf,
      ),
    });
  },

  toggleLinkedScrollSync(paneId) {
    set({
      root: mapTree(get().root, (leaf) =>
        leaf.id === paneId
          ? { ...leaf, linkedScrollSync: !leaf.linkedScrollSync }
          : leaf,
      ),
    });
  },

  setDragging(dragging) {
    set({ dragging });
  },

  setDraggingNota(notaId) {
    set({ draggingNota: notaId });
  },

  openNotaInPane(notaId, paneId) {
    const { root } = get();
    const target = findLeaf(root, paneId);
    if (!target) return;
    const existing = target.tabs.find((t) => t.notaId === notaId);
    // Pestaña permanente (arrastrar es una acción deliberada, no un preview).
    const newTab: Tab = existing ?? { id: newId(), notaId, preview: false };
    set({
      root: mapTree(root, (leaf) =>
        leaf.id === paneId
          ? {
              ...leaf,
              tabs: existing ? leaf.tabs : [...leaf.tabs, newTab],
              activeTabId: newTab.id,
            }
          : leaf,
      ),
      activePaneId: paneId,
      draggingNota: null,
    });
  },

  splitPaneWithNota(notaId, dstPaneId, edge) {
    const newTab: Tab = { id: newId(), notaId, preview: false };
    const newLeaf = makeLeaf([newTab], newTab.id);
    const direction: SplitPane["direction"] =
      edge === "left" || edge === "right" ? "row" : "column";
    const before = edge === "left" || edge === "top";

    function insert(node: PaneNode): PaneNode {
      if (node.type === "leaf") {
        if (node.id !== dstPaneId) return node;
        const split: SplitPane = {
          id: newId(),
          type: "split",
          direction,
          children: before ? [newLeaf, node] : [node, newLeaf],
          sizes: [0.5, 0.5],
        };
        return split;
      }
      return { ...node, children: node.children.map(insert) };
    }

    const root = cleanLinks(pruneEmpty(insert(get().root)));
    set({ root, activePaneId: newLeaf.id, draggingNota: null });
  },

  activeNotaId() {
    const leaf = findLeaf(get().root, get().activePaneId);
    if (!leaf || !leaf.activeTabId) return null;
    return leaf.tabs.find((t) => t.id === leaf.activeTabId)?.notaId ?? null;
  },

  closeNotaEverywhere(notaId) {
    let root = mapTree(get().root, (leaf) => {
      const tabs = leaf.tabs.filter((t) => t.notaId !== notaId);
      if (tabs.length === leaf.tabs.length) return leaf;
      const activeStill = tabs.some((t) => t.id === leaf.activeTabId);
      return {
        ...leaf,
        tabs,
        activeTabId: activeStill ? leaf.activeTabId : tabs[0]?.id ?? null,
      };
    });
    root = cleanLinks(pruneEmpty(root));
    const activeStillExists = findLeaf(root, get().activePaneId) !== null;
    set({
      root,
      activePaneId: activeStillExists ? get().activePaneId : firstLeaf(root).id,
    });
  },

  remapNota(oldId, newId) {
    if (oldId === newId) return;
    const map = (id: string) => (id === oldId ? newId : id);
    set({
      root: mapTree(get().root, (leaf) => ({
        ...leaf,
        tabs: leaf.tabs.map((t) => (t.notaId === oldId ? { ...t, notaId: newId } : t)),
      })),
      closedHistory: get().closedHistory.map(map),
    });
  },

  remapCarpeta(oldPrefix, newPrefix) {
    if (oldPrefix === newPrefix) return;
    const map = (id: string) =>
      id === oldPrefix
        ? newPrefix
        : id.startsWith(`${oldPrefix}/`)
          ? newPrefix + id.slice(oldPrefix.length)
          : id;
    set({
      root: mapTree(get().root, (leaf) => ({
        ...leaf,
        tabs: leaf.tabs.map((t) => ({ ...t, notaId: map(t.notaId) })),
      })),
      closedHistory: get().closedHistory.map(map),
    });
  },

  reconcileNotes(validIds) {
    const keep = (notaId: string) => notaId === GRAPH_TAB_ID || validIds.has(notaId);
    let changed = false;
    let root = mapTree(get().root, (leaf) => {
      const tabs = leaf.tabs.filter((t) => keep(t.notaId));
      if (tabs.length === leaf.tabs.length) return leaf;
      changed = true;
      const activeStill = tabs.some((t) => t.id === leaf.activeTabId);
      return { ...leaf, tabs, activeTabId: activeStill ? leaf.activeTabId : tabs[0]?.id ?? null };
    });
    const closedHistory = get().closedHistory.filter((id) => validIds.has(id));
    if (!changed && closedHistory.length === get().closedHistory.length) return;
    root = cleanLinks(pruneEmpty(root));
    const activeStillExists = findLeaf(root, get().activePaneId) !== null;
    set({
      root,
      activePaneId: activeStillExists ? get().activePaneId : firstLeaf(root).id,
      closedHistory,
    });
  },
    }),
    {
      name: "micelio-tabs",
      version: 1,
      // No persistir el estado transitorio de arrastre.
      partialize: (state) => ({
        root: state.root,
        activePaneId: state.activePaneId,
        closedHistory: state.closedHistory,
      }),
    },
  ),
);

export { allLeaves, findLeaf };
