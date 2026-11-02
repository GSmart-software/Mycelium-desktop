import { create } from "zustand";
import type { RevisionVault } from "@/lib/estadisticasVault";
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
 *
 * **La revisión completa** (`FUN-L-32`): el informe más las estadísticas del
 * dashboard (`revisarVault`). La piden la pestaña «Salud del vault» al abrirse
 * y con «Volver a revisar», y el panel nuevo (parte D); nunca un guardado ni
 * nada de fondo. Es UNA para las dos vistas: si el panel y la pestaña están
 * abiertos a la vez, muestran la misma, y al terminar también actualiza
 * `informe`, así el panel de hoy ve lo mismo que la pestaña.
 */

/**
 * Cuánto vale una revisión al abrir la pestaña: si la última de este vault es
 * más nueva, se muestra esa en vez de recorrer el vault otra vez. Es lo que
 * pasa al abrir la pestaña desde el panel, que acaba de revisar, o al volver a
 * la pestaña después de mirar una nota (la pestaña se vuelve a montar).
 */
export const VIGENCIA_REVISION_MS = 60_000;

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

  /** La última revisión completa (informe + estadísticas), o `null`. */
  revision: RevisionVault | null;
  /** De qué vault es `revision`. */
  revisionVaultId: string | null;
  revisando: boolean;
  errorRevision: string | null;
  /** Revisa el vault ya (dos pedidos a la vez comparten la misma revisión). */
  revisar: () => Promise<void>;
  /** Revisa solo si no hay una revisión de este vault de hace menos de `VIGENCIA_REVISION_MS`. */
  revisarSiHaceFalta: () => Promise<void>;
};

let temporizador: ReturnType<typeof setTimeout> | null = null;
let enCurso: Promise<void> | null = null;
let otraVuelta = false;
let revisionEnCurso: Promise<void> | null = null;

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
    set({
      informe: null,
      vaultId: null,
      error: null,
      calculadoEn: null,
      revision: null,
      revisionVaultId: null,
      errorRevision: null,
    });
  },

  revision: null,
  revisionVaultId: null,
  revisando: false,
  errorRevision: null,

  revisar() {
    if (revisionEnCurso) return revisionEnCurso;
    set({ revisando: true });
    revisionEnCurso = (async () => {
      const vaultId = useVaultStore.getState().vaultId;
      try {
        const { revisarVault } = await import("@/lib/estadisticasVault");
        const revision = await revisarVault();
        // Si el vault cambió mientras se revisaba, la revisión es del anterior.
        if (useVaultStore.getState().vaultId !== vaultId) return;
        set({
          revision,
          revisionVaultId: vaultId,
          errorRevision: null,
          informe: revision.informe,
          vaultId,
          error: null,
          calculadoEn: Date.parse(revision.revisadoEn),
        });
      } catch (e) {
        set({ errorRevision: String((e as Error)?.message ?? e) });
      } finally {
        set({ revisando: false });
        revisionEnCurso = null;
      }
    })();
    return revisionEnCurso;
  },

  revisarSiHaceFalta() {
    const { revision, revisionVaultId } = get();
    const vaultId = useVaultStore.getState().vaultId;
    const vigente =
      revision !== null &&
      revisionVaultId === vaultId &&
      Date.now() - Date.parse(revision.revisadoEn) < VIGENCIA_REVISION_MS;
    return vigente ? Promise.resolve() : get().revisar();
  },
}));
