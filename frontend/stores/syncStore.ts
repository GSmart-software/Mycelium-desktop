import { create } from "zustand";
import type { SyncState } from "@/components/editor/EditorToolbar";

/**
 * Estado de sync por nota (HU-04 CA3): lo escribe el motor de autoguardado
 * del editor y lo leen el dot de la toolbar y los dots de las pestañas.
 */
type SyncStoreState = {
  byNota: Record<string, SyncState>;
  setSyncState: (notaId: string, state: SyncState) => void;
};

export const useSyncStore = create<SyncStoreState>((set) => ({
  byNota: {},
  setSyncState: (notaId, state) =>
    set((s) => ({ byNota: { ...s.byNota, [notaId]: state } })),
}));
