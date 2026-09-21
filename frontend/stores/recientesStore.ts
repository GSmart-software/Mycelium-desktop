import { create } from "zustand";
import { persist } from "zustand/middleware";

/**
 * Las últimas notas que se miraron, para que la paleta abra con algo útil
 * (`FUN-M-33`). Sin esto, abrirla sin escribir listaba el vault entero en orden
 * alfabético —incluida la chatarra de herramientas— cuando lo que casi siempre
 * se busca es volver a una de las dos o tres notas de la sesión (crítica del
 * cascarón, 2026-09-20).
 *
 * Se persiste: al reabrir Mycelium, «lo de ayer» sigue siendo lo reciente.
 */
const MAX = 20;

type RecientesState = {
  recientes: string[];
  recordar: (notaId: string) => void;
  olvidar: (notaId: string) => void;
};

export const useRecientesStore = create<RecientesState>()(
  persist(
    (set) => ({
      recientes: [],
      recordar: (notaId) =>
        set((s) => ({ recientes: [notaId, ...s.recientes.filter((id) => id !== notaId)].slice(0, MAX) })),
      olvidar: (notaId) => set((s) => ({ recientes: s.recientes.filter((id) => id !== notaId) })),
    }),
    { name: "mic-recientes" },
  ),
);
