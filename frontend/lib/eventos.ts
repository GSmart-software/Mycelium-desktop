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

/**
 * Una nota se acaba de GUARDAR desde la app, y el índice ya tiene su contenido y
 * sus propiedades nuevas (`DEF-086`). `detail.notaId` dice cuál.
 *
 * No es lo mismo que `EVENTO_RECARGA`, y por eso son dos: aquél dice «el vault
 * cambió por fuera, editores: recarguen su nota», y emitirlo en cada guardado
 * haría que TODOS los editores abiertos se releyeran cada diez segundos. Éste
 * solo dice «esto cambió»: lo escucha quien muestre algo derivado de muchas notas
 * a la vez, como un archivo tabla.
 *
 * Lo emite el editor tras cada guardado que sale bien, en las dos ramas. En
 * desktop llega ANTES que el watcher —que igual dispara, porque la app escribe a
 * disco—, y en web es la única señal que existe: allá no hay carpeta que vigilar.
 */
export const EVENTO_NOTA_GUARDADA = "micelio:nota-guardada";
