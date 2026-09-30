/**
 * Recargar desde disco lo que cambió por FUERA de la app (`FUN-L-26`, parte A).
 *
 * El editor de notas ya se recargaba solo (`DEF-117` le dio el criterio fino);
 * los lienzos (`.canvas`), los diagramas de draw.io (`.drawio`) y los dibujos
 * (`.excalidraw`) no: seguían mostrando lo viejo, y el próximo guardado pisaba lo
 * que había escrito una IA desde la terminal. Las tres vistas guardan distinto,
 * pero la pregunta es la misma —¿traigo lo del disco o no?— y vive acá, pura y
 * sin imports, para que `scripts/test-recarga-externa.mjs` la pruebe sin
 * navegador (igual que `lib/drawio.ts` o `lib/canvas.ts`).
 */

/**
 * `detail` de `EVENTO_RECARGA` cuando lo emite el watcher: las rutas relativas
 * (POSIX, las mismas que son el id de cada nota) que traía la ráfaga.
 *
 * Es **opcional**: quien emite el evento sin saber qué cambió (el re-enlazado
 * tras un renombrado, por ejemplo) lo emite sin detalle, y eso significa
 * «cualquier cosa pudo cambiar».
 */
export type DetalleRecarga = { rutas?: readonly string[] };

/**
 * ¿Este aviso de recarga puede tocar al archivo `ruta`?
 *
 * Sin lista de rutas, sí: es mejor releer de más que quedarse con lo viejo. Con
 * lista, solo si la ruta está — así un lienzo abierto no se relee cada vez que la
 * IA escribe una nota que no tiene nada que ver.
 */
export function avisoTocaA(evento: object | null | undefined, ruta: string): boolean {
  // Un `Event` a secas no tiene `detail`; un `CustomEvent` del watcher, sí.
  const detalle = (evento as { detail?: DetalleRecarga | null } | null | undefined)?.detail;
  const rutas = detalle?.rutas;
  if (!Array.isArray(rutas)) return true;
  return rutas.includes(ruta);
}

/**
 * ¿Hay que reemplazar lo que muestra la vista por lo que hay en disco?
 *
 * - `sucio`: la vista tiene cambios propios sin escribir. No se recarga: se
 *   pisaría una edición en curso (el mismo criterio que `dirtyRef` en
 *   `NoteEditor`).
 * - `conocido`: lo último que la vista sabe que está en disco —lo que leyó o lo
 *   que mandó a guardar—. Si el disco tiene exactamente eso, es el **eco** del
 *   propio guardado (el watcher ve la escritura de la app como un cambio y, si
 *   en la misma ráfaga cambió otra cosa, avisa igual): no vino nada de afuera.
 * - `enPantalla` (opcional): el texto de lo que se está mostrando, si la vista
 *   lo tiene a mano. Si el disco ya dice eso, recargar no cambiaría nada.
 */
export function hayQueRecargar(estado: {
  disco: string;
  sucio: boolean;
  conocido: string | null;
  enPantalla?: string | null;
}): boolean {
  if (estado.sucio) return false;
  if (estado.disco === estado.conocido) return false;
  if (estado.enPantalla != null && estado.disco === estado.enPantalla) return false;
  return true;
}

/**
 * Huella de los cambios de una escena de Excalidraw: la suma de las `version`
 * de sus elementos (lo mismo que `getSceneVersion` de la librería, sin
 * importarla entera acá).
 *
 * Excalidraw sube la `version` de un elemento en **cada** cambio local, y borrar
 * es marcar `isDeleted` y subirla también, así que la suma solo crece mientras
 * se edita. Sirve para distinguir un cambio de verdad de los `onChange` que
 * dispara mover la cámara o seleccionar —que no tocan el archivo— y de la
 * escena que la propia vista acaba de cargar desde disco.
 */
export function versionDeEscena(elementos: readonly unknown[]): number {
  let suma = 0;
  for (const e of elementos) {
    const v = (e as { version?: unknown } | null)?.version;
    suma += typeof v === "number" && Number.isFinite(v) ? v : 1;
  }
  return suma;
}
