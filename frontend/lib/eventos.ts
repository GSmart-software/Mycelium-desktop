/**
 * Eventos de DOM propios de Mycelium.
 *
 * Viven acá, sueltos y sin dependencias, porque los **emite** una parte de la app
 * y los **escucha** otra, y esas dos partes no siempre están en la misma rama: el
 * watcher del vault en carpeta es solo-desktop (`lib/vaultWatch.ts`), pero el
 * panel de la nota que reacciona al evento es compartido. Si la constante viviera
 * en el emisor, el componente compartido arrastraría a web un módulo que allá no
 * existe.
 */

/**
 * El vault cambió por FUERA de la app y el índice ya se puso al día: quien
 * muestre algo derivado del contenido debería releerlo.
 *
 * Lo emite el watcher (solo-desktop). Lo escuchan los editores abiertos —para
 * recargar su nota si no tienen cambios sin guardar— y el panel de conexiones.
 */
export const EVENTO_RECARGA = "micelio:vault-recargar";
