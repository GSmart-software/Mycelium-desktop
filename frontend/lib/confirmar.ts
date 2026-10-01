import { useConfirmarStore } from "@/stores/confirmarStore";

/**
 * Pregunta al usuario y espera su respuesta (`DEF-051`, `FUN-M-33`).
 *
 * **No usar `window.confirm` en esta app.** Tauri lo sustituye por el diálogo
 * nativo, que es **asíncrono**: devuelve una promesa, no un booleano. Y una
 * promesa siempre es *truthy*, así que un `if (window.confirm(…))` se cumple
 * SIEMPRE — la pregunta no se ve y la acción se ejecuta igual. Es exactamente lo
 * que pasaba al borrar una carpeta: se borraba sin preguntar.
 *
 * Desde la crítica del cascarón (2026-09-20) la pregunta **la dibuja Mycelium**
 * (`DialogoConfirmar`) y no el sistema operativo: la app se sacó la barra de
 * título de Windows para tener marco propio, y el momento de más tensión no
 * puede ser el único que se resuelve con chrome ajeno.
 *
 * @param confirmarTexto  Qué dice el botón que ejecuta la acción. Un verbo
 *                        concreto («Eliminar») dice más que «Aceptar».
 * @returns `true` si el usuario aceptó. Si no hay interfaz montada para
 *          preguntar, devuelve `false`: ante la duda, **no** se ejecuta la
 *          acción destructiva.
 */
export async function confirmar(mensaje: string, confirmarTexto = "Aceptar"): Promise<boolean> {
  const store = useConfirmarStore.getState();
  if (!store.montado) return false;
  return store.preguntar(mensaje, confirmarTexto);
}

/**
 * Una pregunta que pide **la IA** por el MCP de control (`FUN-L-09`, Parte 3):
 * se encola detrás de las del usuario —nunca las desplaza ni las cancela— y el
 * diálogo dice que la pide Claude Code. Devuelve su id, para retirarla si nadie
 * contesta a tiempo, y la respuesta. Sin interfaz montada, `null`: ante la
 * duda, no se hace (el MCP lo contesta como `RECHAZADO`).
 */
export function confirmarIa(mensaje: string, confirmarTexto: string): { id: number; respuesta: Promise<boolean> } | null {
  const store = useConfirmarStore.getState();
  if (!store.montado) return null;
  return store.encolar(mensaje, confirmarTexto, "ia");
}

/** Retira una pregunta de la IA que quedó sin contestar (cuenta como «no»). */
export function retirarConfirmacion(id: number): void {
  useConfirmarStore.getState().retirar(id);
}
