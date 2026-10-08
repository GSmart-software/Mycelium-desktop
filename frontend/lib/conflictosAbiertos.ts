import { confirmar } from "@/lib/confirmar";
import { useTabsStore } from "@/stores/tabsStore";
import { useVaultStore } from "@/stores/vaultStore";

/**
 * Pestañas con un conflicto pendiente con el disco (`DEF-138`) y el cierre que
 * no las pierde.
 *
 * Una nota en conflicto tiene lo del usuario **solo en memoria**: el guardado
 * está en pausa hasta que elija en la barra. Cerrar la pestaña así tiraba lo
 * suyo, así que cerrar pregunta y, si acepta, guarda lo suyo como copia antes
 * de cerrar —lo de afuera queda en el archivo, como lo dejaron—.
 *
 * El editor registra acá su conflicto al entrar y lo da de baja al resolverlo
 * (no al desmontarse: una pestaña que no se ve también puede estar en
 * conflicto, y su texto sigue en la caché de la pestaña). Es la misma idea que
 * `lib/guardadoPendiente.ts`, para lo que no se puede guardar solo.
 */

type GuardarCopia = () => Promise<boolean>;

const abiertos = new Map<string, { notaId: string; guardarCopia: GuardarCopia }>();

/** El editor de la pestaña `instanceId` entró en conflicto. */
export function registrarConflicto(instanceId: string, notaId: string, guardarCopia: GuardarCopia): void {
  abiertos.set(instanceId, { notaId, guardarCopia });
}

/** El conflicto de la pestaña se resolvió (o la pestaña se cerró). */
export function olvidarConflicto(instanceId: string): void {
  abiertos.delete(instanceId);
}

/** ¿La pestaña tiene un conflicto pendiente? */
export function hayConflicto(instanceId: string): boolean {
  return abiertos.has(instanceId);
}

/**
 * Cierra la pestaña `tabId` del panel `paneId`, salvo que tenga un conflicto
 * pendiente y el usuario no quiera guardar lo suyo como copia. Devuelve si se
 * cerró. Quien cierra una pestaña por acción del usuario (la X, Supr, Ctrl+W,
 * anclarla al panel lateral) pasa por acá y no por `closeTab` directo.
 */
export async function cerrarPestanaSinPerder(paneId: string, tabId: string): Promise<boolean> {
  const conflicto = abiertos.get(tabId);
  if (conflicto) {
    const titulo =
      useVaultStore.getState().notas.find((n) => n.id === conflicto.notaId)?.titulo ?? "la nota";
    const acepta = await confirmar(
      `«${titulo}» tiene cambios tuyos sin guardar y el archivo cambió fuera de Mycelium. ` +
        "Para cerrarla, lo tuyo se guarda como una copia aparte y la nota queda como la dejaron afuera.",
      "Guardar copia y cerrar",
    );
    if (!acepta) return false;
    if (!(await conflicto.guardarCopia())) return false;
    olvidarConflicto(tabId);
  }
  useTabsStore.getState().closeTab(paneId, tabId);
  return true;
}
