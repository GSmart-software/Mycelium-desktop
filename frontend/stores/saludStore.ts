import { create } from "zustand";
import type { InformeSalud } from "@/lib/salud";
import { useVaultStore } from "@/stores/vaultStore";

/**
 * El informe de salud del vault que muestra el panel (`FUN-L-30`). Solo
 * desktop. Lo calcula `lib/saludVault.ts` sobre el índice —el mismo informe
 * que reciben `mycelium_salud` y `mycelium_validar_nota`— y se recalcula:
 *
 * - al abrir el panel;
 * - cuando el índice cambia: un guardado (`EVENTO_NOTA_GUARDADA`), un cambio
 *   por fuera (`EVENTO_RECARGA`) o el árbol (crear, renombrar, mover, borrar).
 *
 * **Nunca en cada tecla**: el editor guarda con su propio retardo, y acá cada
 * pedido espera `ESPERA_MS` sin otro antes de calcular. Si llega uno mientras
 * calcula, se hace una sola vuelta más al terminar. Con el panel cerrado no se
 * escucha nada (`SaludPanel` se suscribe al montarse).
 */

/** Cuánto se espera sin cambios nuevos antes de recalcular. */
export const ESPERA_MS = 1200;

type SaludState = {
  informe: InformeSalud | null;
  /** De qué vault es el informe: al cambiar de vault, no se muestra el del anterior. */
  vaultId: string | null;
  cargando: boolean;
  error: string | null;
  /** Cuándo se calculó el informe que se ve (ms). */
  calculadoEn: number | null;
  /** Calcula ya (el botón «Actualizar» y la apertura del panel). */
  recalcular: () => Promise<void>;
  /** Pide un recálculo con espera: lo llaman los eventos del índice. */
  pedir: () => void;
  /** Olvida el informe (al cambiar de vault). */
  vaciar: () => void;
};

let temporizador: ReturnType<typeof setTimeout> | null = null;
let enCurso: Promise<void> | null = null;
let otraVuelta = false;

export const useSaludStore = create<SaludState>()((set, get) => ({
  informe: null,
  vaultId: null,
  cargando: false,
  error: null,
  calculadoEn: null,

  async recalcular() {
    if (temporizador) {
      clearTimeout(temporizador);
      temporizador = null;
    }
    if (enCurso) {
      otraVuelta = true;
      return enCurso;
    }
    set({ cargando: true });
    enCurso = (async () => {
      try {
        do {
          otraVuelta = false;
          const { informeDeSalud } = await import("@/lib/saludVault");
          const vaultId = useVaultStore.getState().vaultId;
          const informe = await informeDeSalud();
          set({ informe, vaultId, error: null, calculadoEn: Date.now() });
        } while (otraVuelta);
      } catch (e) {
        set({ error: String((e as Error)?.message ?? e) });
      } finally {
        set({ cargando: false });
        enCurso = null;
      }
    })();
    return enCurso;
  },

  pedir() {
    if (temporizador) clearTimeout(temporizador);
    temporizador = setTimeout(() => {
      temporizador = null;
      void get().recalcular();
    }, ESPERA_MS);
  },

  vaciar() {
    if (temporizador) clearTimeout(temporizador);
    temporizador = null;
    set({ informe: null, vaultId: null, error: null, calculadoEn: null });
  },
}));
