import { create } from "zustand";
import { persist } from "zustand/middleware";
import { api } from "@/lib/api";
import { useAuthStore } from "@/stores/authStore";
import { useGraphStore } from "@/stores/graphStore";
import { useTabsStore } from "@/stores/tabsStore";
import { refreshAllLiveViews } from "@/lib/editor/livePreview";

/**
 * Marca el grafo como desactualizado y redispara el live preview tras un cambio
 * que altera nodos/enlaces (también afecta el feedback de wikilinks rotos).
 */
const markGraphStale = () => {
  useGraphStore.getState().markStale();
  refreshAllLiveViews();
};

export type TreeCarpeta = { id: string; padreId: string | null; nombre: string };
export type NotaTipo = "markdown" | "excalidraw" | "base" | "canvas";
export type TreeNota = {
  id: string;
  carpetaId: string | null;
  titulo: string;
  tipo: NotaTipo;
  actualizadoEn: string;
};
export type PapeleraItem = {
  notaId: string;
  titulo: string;
  rutaOriginal: string;
  eliminadoEn: string;
};

type RawCarpeta = { id: string; padre_id: string | null; nombre: string };
type RawNota = {
  id: string;
  carpeta_id: string | null;
  titulo: string;
  tipo?: string;
  actualizado_en: string;
};
type RawPapeleraItem = {
  nota_id: string;
  titulo: string;
  ruta_original: string;
  eliminado_en: string;
};

type LastMove =
  | { type: "nota"; id: string; prevParentId: string | null }
  | { type: "carpeta"; id: string; prevParentId: string | null };

type VaultState = {
  vaultId: string | null;
  carpetas: TreeCarpeta[];
  notas: TreeNota[];
  papelera: PapeleraItem[];
  /** Ids de carpetas compartidas (con membresías) para marcarlas en el árbol (HU-35 CA5). */
  sharedCarpetaIds: string[];
  /** Estado expandido/colapsado por carpeta — persiste en localStorage (HU-22 CA5). */
  expanded: Record<string, boolean>;
  /** Carpeta activa: destino de "Nueva nota"/importaciones (HU-23 CA1). */
  activeFolderId: string | null;
  /** Último movimiento, para deshacer con Ctrl+Z (HU-24 CA7). */
  lastMove: LastMove | null;
  loadTree: (vaultId: string) => Promise<void>;
  loadPapelera: () => Promise<void>;
  createCarpeta: (nombre: string, padreId: string | null) => Promise<void>;
  renameCarpeta: (id: string, nombre: string) => Promise<void>;
  deleteCarpeta: (id: string) => Promise<void>;
  moveCarpeta: (id: string, destinoId: string | null) => Promise<void>;
  /** `titulo` solo lo usan las Esporas (`FUN-M-03`): la nota nueva se llama como
   *  la plantilla. Sin él, el nombre por defecto de siempre. */
  createNota: (carpetaId: string | null, tipo?: NotaTipo, titulo?: string) => Promise<string>;
  renameNota: (id: string, titulo: string) => Promise<void>;
  deleteNota: (id: string) => Promise<void>;
  duplicateNota: (id: string) => Promise<void>;
  moveNota: (id: string, destinoId: string | null) => Promise<void>;
  restoreNota: (id: string) => Promise<void>;
  deleteNotaForever: (id: string) => Promise<void>;
  undoLastMove: () => Promise<void>;
  toggleExpanded: (id: string) => void;
  setActiveFolder: (id: string | null) => void;
  /** Carpetas descendientes de una carpeta (incluida ella) — para validar D&D. */
  subtreeIds: (id: string) => Set<string>;
  /**
   * Vacía el árbol al cambiar de vault (`DEF-044`). Mismo motivo que el `reset()`
   * del grafo: en modo carpeta todos los vaults comparten `LOCAL_VAULT_ID`, así
   * que el store no detecta el cambio por sí solo y se queda con las notas del
   * vault anterior hasta que `loadTree` termine.
   */
  reset: () => void;
};

const token = () => useAuthStore.getState().accessToken;

// Guard de generación para loadTree: si varias recargas se solapan (red lenta),
// solo la última iniciada puede escribir el estado. Evita que una recarga vieja
// (que leyó antes de un move) resuelva última y revierta el árbol.
let treeSeq = 0;

// Movimientos recientes (id de nota/carpeta → carpeta/padre destino) para que una
// lectura del árbol que aún NO refleja el cambio (réplica/caché del backend que
// va por detrás del UPDATE) no revierta visualmente un archivo recién movido.
// Cada entrada se confirma y limpia en cuanto el servidor refleja el destino;
// expira por seguridad pasado el período (si el servidor nunca confirma).
const pendingMoves = new Map<string, { parent: string | null; ts: number }>();
const MOVE_GRACE_MS = 60_000;

export const useVaultStore = create<VaultState>()(
  persist(
    (set, get) => ({
      vaultId: null,
      carpetas: [],
      notas: [],
      papelera: [],
      sharedCarpetaIds: [],
      expanded: {},
      activeFolderId: null,
      lastMove: null,

      async loadTree(vaultId) {
        const seq = ++treeSeq;
        const data = await api<{ carpetas: RawCarpeta[]; notas: RawNota[] }>(
          `/vaults/${vaultId}/tree`,
          { token: token() },
        );
        // Si ya se inició una recarga más nueva, descartar este resultado viejo.
        if (seq !== treeSeq) return;

        const carpetas: TreeCarpeta[] = data.carpetas.map((c) => ({
          id: c.id,
          padreId: c.padre_id,
          nombre: c.nombre,
        }));
        const notas: TreeNota[] = data.notas.map((n) => ({
          id: n.id,
          carpetaId: n.carpeta_id,
          titulo: n.titulo,
          tipo:
            n.tipo === "excalidraw" || n.tipo === "base" || n.tipo === "canvas"
              ? n.tipo
              : "markdown",
          actualizadoEn: n.actualizado_en,
        }));

        // Reconciliar con los movimientos recientes: si el árbol recibido todavía
        // no refleja un move (lectura atrasada del backend), mantener la posición
        // local; si ya lo refleja, dar el move por confirmado y olvidarlo.
        const now = Date.now();
        for (const [id, m] of pendingMoves) {
          if (now - m.ts > MOVE_GRACE_MS) pendingMoves.delete(id);
        }
        for (const c of carpetas) {
          const m = pendingMoves.get(c.id);
          if (!m) continue;
          if (c.padreId === m.parent) pendingMoves.delete(c.id);
          else c.padreId = m.parent;
        }
        for (const n of notas) {
          const m = pendingMoves.get(n.id);
          if (!m) continue;
          if (n.carpetaId === m.parent) pendingMoves.delete(n.id);
          else n.carpetaId = m.parent;
        }

        set({ vaultId, carpetas, notas });
        // Marcador de carpetas compartidas para el árbol general (HU-35 CA5)
        try {
          const shared = await api<{ ids: string[] }>(
            `/vaults/${vaultId}/carpetas-compartidas`,
            { token: token() },
          );
          if (seq !== treeSeq) return;
          set({ sharedCarpetaIds: shared.ids });
        } catch {
          if (seq === treeSeq) set({ sharedCarpetaIds: [] });
        }
      },

      async loadPapelera() {
        const { vaultId } = get();
        if (!vaultId) return;
        const data = await api<{ items: RawPapeleraItem[] }>(
          `/vaults/${vaultId}/papelera`,
          { token: token() },
        );
        set({
          papelera: data.items.map((i) => ({
            notaId: i.nota_id,
            titulo: i.titulo,
            rutaOriginal: i.ruta_original,
            eliminadoEn: i.eliminado_en,
          })),
        });
      },

      async createCarpeta(nombre, padreId) {
        const { vaultId } = get();
        if (!vaultId) return;
        await api(`/vaults/${vaultId}/carpetas`, {
          method: "POST",
          token: token(),
          body: { nombre, padreId },
        });
        if (padreId) set((s) => ({ expanded: { ...s.expanded, [padreId]: true } }));
        await get().loadTree(vaultId);
      },

      async renameCarpeta(id, nombre) {
        const res = await api<{ id: string }>(`/carpetas/${encodeURIComponent(id)}`, {
          method: "PATCH",
          token: token(),
          body: { nombre },
        });
        // Modo carpeta: renombrar la carpeta cambia su ruta y la de todo su
        // subárbol; reapuntar las pestañas de las notas que colgaban de ella.
        if (res.id !== id) useTabsStore.getState().remapCarpeta(id, res.id);
        await get().loadTree(get().vaultId!);
      },

      async deleteCarpeta(id) {
        await api(`/carpetas/${encodeURIComponent(id)}`, { method: "DELETE", token: token() });
        await get().loadTree(get().vaultId!);
      },

      async moveCarpeta(id, destinoId) {
        const prev = get().carpetas.find((c) => c.id === id)?.padreId ?? null;
        // Optimista: mover la carpeta en el árbol al instante (no esperar la red).
        set((s) => ({
          carpetas: s.carpetas.map((c) => (c.id === id ? { ...c, padreId: destinoId } : c)),
          lastMove: { type: "carpeta", id, prevParentId: prev },
          expanded: destinoId ? { ...s.expanded, [destinoId]: true } : s.expanded,
        }));
        pendingMoves.set(id, { parent: destinoId, ts: Date.now() });
        let res: { id: string };
        try {
          res = await api<{ id: string }>(`/carpetas/${encodeURIComponent(id)}/mover`, {
            method: "POST",
            token: token(),
            body: { destinoId },
          });
        } catch (err) {
          // Revertir si el backend rechazó el movimiento.
          console.error("[vault] fallo al mover carpeta:", err);
          pendingMoves.delete(id);
          set((s) => ({
            carpetas: s.carpetas.map((c) => (c.id === id ? { ...c, padreId: prev } : c)),
          }));
          return;
        }
        // Modo carpeta: mover la carpeta cambia su ruta (id) y la de su subárbol.
        if (res.id !== id) {
          useTabsStore.getState().remapCarpeta(id, res.id);
          pendingMoves.delete(id);
          pendingMoves.set(res.id, { parent: destinoId, ts: Date.now() });
          set((s) => ({
            lastMove:
              s.lastMove && s.lastMove.type === "carpeta" && s.lastMove.id === id
                ? { ...s.lastMove, id: res.id }
                : s.lastMove,
          }));
        }
        await get().loadTree(get().vaultId!);
        refreshAllLiveViews(); // la ruta cambió: refrescar wikilinks por ruta
      },

      async createNota(carpetaId, tipo = "markdown", titulo) {
        const { vaultId } = get();
        if (!vaultId) throw new Error("Sin vault activo");
        const porDefecto =
          tipo === "excalidraw"
            ? "Dibujo sin título"
            : tipo === "base"
              ? "Base sin título"
              : tipo === "canvas"
                ? "Lienzo sin título"
                : "Sin título";
        const result = await api<{ id: string }>(`/vaults/${vaultId}/notas`, {
          method: "POST",
          token: token(),
          body: {
            titulo: titulo && titulo.trim() !== "" ? titulo.trim() : porDefecto,
            carpetaId,
            tipo,
          },
        });
        if (carpetaId) set((s) => ({ expanded: { ...s.expanded, [carpetaId]: true } }));
        await get().loadTree(vaultId);
        markGraphStale();
        return result.id;
      },

      async renameNota(id, titulo) {
        const res = await api<{ id: string }>(`/notas/${encodeURIComponent(id)}`, {
          method: "PATCH",
          token: token(),
          body: { titulo },
        });
        // Modo carpeta: renombrar cambia el id (=ruta). La pestaña abierta debe
        // seguir a la nota con su id nuevo antes de reconciliar el árbol.
        if (res.id !== id) useTabsStore.getState().remapNota(id, res.id);
        await get().loadTree(get().vaultId!);
        markGraphStale();
      },

      async deleteNota(id) {
        await api(`/notas/${encodeURIComponent(id)}`, { method: "DELETE", token: token() });
        await get().loadTree(get().vaultId!);
        markGraphStale();
      },

      async duplicateNota(id) {
        await api(`/notas/${encodeURIComponent(id)}/duplicar`, { method: "POST", token: token() });
        await get().loadTree(get().vaultId!);
        markGraphStale();
      },

      async moveNota(id, destinoId) {
        const prev = get().notas.find((n) => n.id === id)?.carpetaId ?? null;
        // Optimista: mover la nota en el árbol al instante (no esperar la red).
        set((s) => ({
          notas: s.notas.map((n) => (n.id === id ? { ...n, carpetaId: destinoId } : n)),
          lastMove: { type: "nota", id, prevParentId: prev },
          expanded: destinoId ? { ...s.expanded, [destinoId]: true } : s.expanded,
        }));
        pendingMoves.set(id, { parent: destinoId, ts: Date.now() });
        let res: { id: string };
        try {
          res = await api<{ id: string }>(`/notas/${encodeURIComponent(id)}/mover`, {
            method: "POST",
            token: token(),
            body: { destinoId },
          });
        } catch (err) {
          // Revertir si el backend rechazó el movimiento.
          console.error("[vault] fallo al mover nota:", err);
          pendingMoves.delete(id);
          set((s) => ({
            notas: s.notas.map((n) => (n.id === id ? { ...n, carpetaId: prev } : n)),
          }));
          return;
        }
        // Modo carpeta: mover cambia el id (=ruta). Seguir la pestaña abierta y
        // apuntar deshacer/pendientes al id nuevo.
        if (res.id !== id) {
          useTabsStore.getState().remapNota(id, res.id);
          pendingMoves.delete(id);
          pendingMoves.set(res.id, { parent: destinoId, ts: Date.now() });
          set((s) => ({
            lastMove:
              s.lastMove && s.lastMove.type === "nota" && s.lastMove.id === id
                ? { ...s.lastMove, id: res.id }
                : s.lastMove,
          }));
        }
        await get().loadTree(get().vaultId!);
        refreshAllLiveViews(); // la ruta cambió: refrescar wikilinks por ruta
      },

      async restoreNota(id) {
        await api(`/notas/${encodeURIComponent(id)}/recuperar`, { method: "POST", token: token() });
        await Promise.all([get().loadPapelera(), get().loadTree(get().vaultId!)]);
        markGraphStale();
      },

      async deleteNotaForever(id) {
        await api(`/notas/${encodeURIComponent(id)}/permanente`, { method: "DELETE", token: token() });
        await get().loadPapelera();
      },

      async undoLastMove() {
        const move = get().lastMove;
        if (!move) return;
        set({ lastMove: null });
        pendingMoves.set(move.id, { parent: move.prevParentId, ts: Date.now() });
        if (move.type === "nota") {
          await api(`/notas/${encodeURIComponent(move.id)}/mover`, {
            method: "POST",
            token: token(),
            body: { destinoId: move.prevParentId },
          });
        } else {
          await api(`/carpetas/${encodeURIComponent(move.id)}/mover`, {
            method: "POST",
            token: token(),
            body: { destinoId: move.prevParentId },
          });
        }
        await get().loadTree(get().vaultId!);
      },

      toggleExpanded(id) {
        set((s) => ({ expanded: { ...s.expanded, [id]: !s.expanded[id] } }));
      },

      reset() {
        // `expanded` NO se toca: está persistido y es una preferencia de
        // visualización, no datos del vault.
        set({
          vaultId: null,
          carpetas: [],
          notas: [],
          papelera: [],
          sharedCarpetaIds: [],
          activeFolderId: null,
          lastMove: null,
        });
      },

      setActiveFolder(id) {
        set({ activeFolderId: id });
      },

      subtreeIds(id) {
        const { carpetas } = get();
        const result = new Set<string>([id]);
        let changed = true;
        while (changed) {
          changed = false;
          for (const carpeta of carpetas) {
            if (
              carpeta.padreId !== null &&
              result.has(carpeta.padreId) &&
              !result.has(carpeta.id)
            ) {
              result.add(carpeta.id);
              changed = true;
            }
          }
        }
        return result;
      },
    }),
    {
      name: "micelio-explorer",
      partialize: (state) => ({ expanded: state.expanded }),
    },
  ),
);
