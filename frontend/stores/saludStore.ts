import { create } from "zustand";
import type { RevisionVault } from "@/lib/estadisticasVault";
import { useVaultStore } from "@/stores/vaultStore";

/**
 * La revisión de salud del vault (`FUN-L-30`, `FUN-L-32`). Solo desktop. Es
 * UNA para el panel lateral y la pestaña «Salud del vault»: el informe de
 * `lib/saludVault.ts` —el mismo que reciben `mycelium_salud` y
 * `mycelium_validar_nota`— más las estadísticas del tablero (`revisarVault`).
 *
 * Se revisa al abrir el panel o la pestaña (si la última revisión de este
 * vault ya venció: `revisarSiHaceFalta`) y con «Volver a revisar». **Nunca**
 * al guardar ni de fondo: el costo estaba en el reparto por evento (auditoría
 * de eficiencia del 2026-11-01). Si el panel y la pestaña están abiertos a la
 * vez, muestran la misma.
 */

/**
 * Cuánto vale una revisión al abrir el panel o la pestaña: si la última de
 * este vault es más nueva, se muestra esa en vez de recorrer el vault otra vez.
 * Es lo que pasa al abrir la pestaña desde el panel, que acaba de revisar, o
 * al volver a la pestaña después de mirar una nota (se vuelve a montar).
 */
export const VIGENCIA_REVISION_MS = 60_000;

type SaludState = {
  /** La última revisión completa (informe + estadísticas), o `null`. */
  revision: RevisionVault | null;
  /** De qué vault es `revision`: al cambiar de vault, no se muestra la del anterior. */
  revisionVaultId: string | null;
  revisando: boolean;
  errorRevision: string | null;
  /** Revisa el vault ya (dos pedidos a la vez comparten la misma revisión). */
  revisar: () => Promise<void>;
  /** Revisa solo si no hay una revisión de este vault de hace menos de `VIGENCIA_REVISION_MS`. */
  revisarSiHaceFalta: () => Promise<void>;
};

let revisionEnCurso: Promise<void> | null = null;

export const useSaludStore = create<SaludState>()((set, get) => ({
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
        set({ revision, revisionVaultId: vaultId, errorRevision: null });
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
