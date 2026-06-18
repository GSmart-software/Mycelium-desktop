import { create } from "zustand";
import type { GraphEdge, GraphNode } from "@/components/graph/MiniGraph";
import { api } from "@/lib/api";
import { useAuthStore } from "@/stores/authStore";

export type GraphData = { nodos: GraphNode[]; aristas: GraphEdge[] };
export type NodePos = { x: number; y: number };

type GraphState = {
  vaultId: string | null;
  data: GraphData | null;
  /** Posiciones asentadas por nodo: cache del layout para no re-simular desde cero. */
  positions: Record<string, NodePos>;
  status: "idle" | "loading" | "ready" | "error";
  /** Algo cambió (nota creada/renombrada/borrada o contenido guardado) → refrescar. */
  stale: boolean;
  fetch: (vaultId: string, opts?: { force?: boolean }) => Promise<void>;
  markStale: () => void;
  savePositions: (positions: Record<string, NodePos>) => void;
};

// Dedupe de peticiones concurrentes (p. ej. montaje + refresh por stale a la vez).
let inflight: Promise<void> | null = null;
let inflightKey = "";

/**
 * Cache en memoria del grafo global. Sobrevive a montajes/desmontajes de la
 * pestaña del grafo, así que volver a ella muestra los datos y el layout al
 * instante en vez de recargar y re-simular desde posiciones aleatorias.
 */
export const useGraphStore = create<GraphState>((set, get) => ({
  vaultId: null,
  data: null,
  positions: {},
  status: "idle",
  stale: false,

  async fetch(vaultId, opts) {
    const s = get();
    // Ya tenemos datos frescos de este vault: no recargar (cache hit).
    if (!opts?.force && s.vaultId === vaultId && s.data && !s.stale) return;
    if (inflight && inflightKey === vaultId) return inflight;

    // Si cambia el vault, las posiciones cacheadas ya no aplican.
    const resetPositions = s.vaultId !== null && s.vaultId !== vaultId;
    set({ status: s.data && s.vaultId === vaultId ? s.status : "loading" });

    inflightKey = vaultId;
    inflight = (async () => {
      try {
        const res = await api<GraphData>(`/vaults/${vaultId}/grafo`, {
          token: useAuthStore.getState().accessToken,
        });
        set({
          vaultId,
          data: res,
          status: "ready",
          stale: false,
          ...(resetPositions ? { positions: {} } : {}),
        });
      } catch {
        set({ status: "error", stale: false });
      } finally {
        inflight = null;
        inflightKey = "";
      }
    })();

    return inflight;
  },

  markStale() {
    if (get().vaultId) set({ stale: true });
  },

  savePositions(positions) {
    set({ positions });
  },
}));
