import { create } from "zustand";
import { persist } from "zustand/middleware";
import { api } from "@/lib/api";
import { useAuthStore } from "@/stores/authStore";
import { useGraphStore } from "@/stores/graphStore";

/** Marca el grafo como desactualizado tras un cambio que altera nodos/enlaces. */
const markGraphStale = () => useGraphStore.getState().markStale();

export type TreeCarpeta = { id: string; padreId: string | null; nombre: string };
export type NotaTipo = "markdown" | "excalidraw";
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
  createNota: (carpetaId: string | null, tipo?: NotaTipo) => Promise<string>;
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
};

const token = () => useAuthStore.getState().accessToken;

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
        const data = await api<{ carpetas: RawCarpeta[]; notas: RawNota[] }>(
          `/vaults/${vaultId}/tree`,
          { token: token() },
        );
        set({
          vaultId,
          carpetas: data.carpetas.map((c) => ({
            id: c.id,
            padreId: c.padre_id,
            nombre: c.nombre,
          })),
          notas: data.notas.map((n) => ({
            id: n.id,
            carpetaId: n.carpeta_id,
            titulo: n.titulo,
            tipo: n.tipo === "excalidraw" ? "excalidraw" : "markdown",
            actualizadoEn: n.actualizado_en,
          })),
        });
        // Marcador de carpetas compartidas para el árbol general (HU-35 CA5)
        try {
          const shared = await api<{ ids: string[] }>(
            `/vaults/${vaultId}/carpetas-compartidas`,
            { token: token() },
          );
          set({ sharedCarpetaIds: shared.ids });
        } catch {
          set({ sharedCarpetaIds: [] });
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
        await api(`/carpetas/${id}`, { method: "PATCH", token: token(), body: { nombre } });
        await get().loadTree(get().vaultId!);
      },

      async deleteCarpeta(id) {
        await api(`/carpetas/${id}`, { method: "DELETE", token: token() });
        await get().loadTree(get().vaultId!);
      },

      async moveCarpeta(id, destinoId) {
        const prev = get().carpetas.find((c) => c.id === id)?.padreId ?? null;
        await api(`/carpetas/${id}/mover`, {
          method: "POST",
          token: token(),
          body: { destinoId },
        });
        set({ lastMove: { type: "carpeta", id, prevParentId: prev } });
        await get().loadTree(get().vaultId!);
      },

      async createNota(carpetaId, tipo = "markdown") {
        const { vaultId } = get();
        if (!vaultId) throw new Error("Sin vault activo");
        const result = await api<{ id: string }>(`/vaults/${vaultId}/notas`, {
          method: "POST",
          token: token(),
          body: {
            titulo: tipo === "excalidraw" ? "Dibujo sin título" : "Sin título",
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
        await api(`/notas/${id}`, { method: "PATCH", token: token(), body: { titulo } });
        await get().loadTree(get().vaultId!);
        markGraphStale();
      },

      async deleteNota(id) {
        await api(`/notas/${id}`, { method: "DELETE", token: token() });
        await get().loadTree(get().vaultId!);
        markGraphStale();
      },

      async duplicateNota(id) {
        await api(`/notas/${id}/duplicar`, { method: "POST", token: token() });
        await get().loadTree(get().vaultId!);
        markGraphStale();
      },

      async moveNota(id, destinoId) {
        const prev = get().notas.find((n) => n.id === id)?.carpetaId ?? null;
        await api(`/notas/${id}/mover`, {
          method: "POST",
          token: token(),
          body: { destinoId },
        });
        set({ lastMove: { type: "nota", id, prevParentId: prev } });
        await get().loadTree(get().vaultId!);
      },

      async restoreNota(id) {
        await api(`/notas/${id}/recuperar`, { method: "POST", token: token() });
        await Promise.all([get().loadPapelera(), get().loadTree(get().vaultId!)]);
        markGraphStale();
      },

      async deleteNotaForever(id) {
        await api(`/notas/${id}/permanente`, { method: "DELETE", token: token() });
        await get().loadPapelera();
      },

      async undoLastMove() {
        const move = get().lastMove;
        if (!move) return;
        set({ lastMove: null });
        if (move.type === "nota") {
          await api(`/notas/${move.id}/mover`, {
            method: "POST",
            token: token(),
            body: { destinoId: move.prevParentId },
          });
        } else {
          await api(`/carpetas/${move.id}/mover`, {
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
