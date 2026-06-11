import { create } from "zustand";

/** Pestaña: instancia de una nota abierta en un pane (HU-25). */
export type Tab = { id: string; notaId: string };

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

  openNote: (notaId: string) => void;
  activateTab: (paneId: string, tabId: string) => void;
  closeTab: (paneId: string, tabId: string) => void;
  closeActiveTab: () => void;
  reopenLastClosed: () => void;
  reorderTab: (paneId: string, fromIndex: number, toIndex: number) => void;
  moveTabToPane: (srcPaneId: string, tabId: string, dstPaneId: string) => void;
  splitWithTab: (srcPaneId: string, tabId: string, dstPaneId: string, edge: SplitEdge) => void;
  setSizes: (splitId: string, sizes: number[]) => void;
  setActivePane: (paneId: string) => void;
  linkPane: (paneId: string, sourcePaneId: string | null) => void;
  toggleLinkedScrollSync: (paneId: string) => void;
  setDragging: (dragging: TabsState["dragging"]) => void;
  /** Nota activa del pane activo (para sincronizar la URL). */
  activeNotaId: () => string | null;
  /** Cierra las pestañas de una nota en todos los panes (al ir a papelera). */
  closeNotaEverywhere: (notaId: string) => void;
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

export const useTabsStore = create<TabsState>((set, get) => ({
  root: initialRoot,
  activePaneId: initialRoot.id,
  closedHistory: [],
  dragging: null,

  openNote(notaId) {
    const { root, activePaneId } = get();
    let targetLeaf = findLeaf(root, activePaneId) ?? firstLeaf(root);
    // Si el pane activo es un preview vinculado, abrir en otro pane editable
    if (targetLeaf.linkedTo !== null) {
      targetLeaf =
        allLeaves(root).find((l) => l.linkedTo === null) ?? targetLeaf;
    }
    const existing = targetLeaf.tabs.find((t) => t.notaId === notaId);
    if (existing && targetLeaf.activeTabId === existing.id) return;

    const newTab: Tab = existing ?? { id: newId(), notaId };
    set({
      root: mapTree(get().root, (leaf) =>
        leaf.id === targetLeaf.id
          ? {
              ...leaf,
              tabs: existing ? leaf.tabs : [...leaf.tabs, newTab],
              activeTabId: newTab.id,
            }
          : leaf,
      ),
      activePaneId: targetLeaf.id,
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
    // Un pane con una sola pestaña no puede splitearse a sí mismo
    if (srcPaneId === dstPaneId && src!.tabs.length === 1) return;

    const newLeaf = makeLeaf([tab], tab.id);
    const direction: SplitPane["direction"] =
      edge === "left" || edge === "right" ? "row" : "column";
    const before = edge === "left" || edge === "top";

    function insert(node: PaneNode): PaneNode {
      if (node.type === "leaf") {
        // Primero quitar el tab del pane origen
        let leaf = node;
        if (leaf.id === srcPaneId) {
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
}));

export { allLeaves, findLeaf };
