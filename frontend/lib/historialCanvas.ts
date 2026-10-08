/**
 * Historial de deshacer/rehacer del lienzo (`DEF-137`). Lógica pura, sin
 * imports: la prueba `scripts/test-historial-canvas.mjs` la transpila y la
 * importa sin navegador.
 *
 * > [!note] Snapshots inmutables, no comandos inversos
 * > El lienzo ya se modifica siempre de forma inmutable (cada cambio devuelve un
 * > `Canvas` nuevo y comparte lo que no tocó), así que guardar el documento
 * > entero ANTES de cada paso cuesta una referencia y no una copia. Deshacer es
 * > volver a esa referencia: no hay inversos que escribir por operación ni forma
 * > de que uno quede mal y deje un documento que nunca existió.
 *
 * **Pasos agrupados.** Un arrastre o la edición de un texto son muchos cambios
 * seguidos que el usuario vive como uno. Se abren con `abrir(clave)` —que anota
 * cómo estaba el documento— y se cierran con `cerrar(clave)`: si al cerrar el
 * documento cambió, entra UN paso. La clave evita que el cierre de un gesto
 * («terminó la edición del texto», que llega por el `blur`) cierre otro que
 * empezó en el medio (el arrastre que provocó ese `blur`). Abrir un gesto con
 * otro abierto cierra primero el anterior: nunca hay dos a la vez.
 *
 * Es genérico en `T` para no depender de `lib/canvas.ts`: lo único que hace con
 * los documentos es guardarlos y compararlos por referencia.
 */

/** Pasos que se recuerdan como máximo; los más viejos se olvidan. */
export const LIMITE_HISTORIAL = 100;

export type Historial<T> = {
  /** Estados anteriores a cada paso, del más viejo al más reciente. */
  readonly pasado: readonly T[];
  /** Estados deshechos, del más cercano al más lejano (para rehacer). */
  readonly futuro: readonly T[];
  /** Gesto abierto: cómo estaba el documento al empezar. */
  readonly pendiente: { readonly clave: string; readonly antes: T } | null;
};

export function historialVacio<T>(): Historial<T> {
  return { pasado: [], futuro: [], pendiente: null };
}

/** Agrega `antes` como paso, olvida lo deshecho y respeta el límite. */
function empujar<T>(h: Historial<T>, antes: T, limite: number): Historial<T> {
  const pasado = [...h.pasado, antes];
  if (pasado.length > limite) pasado.splice(0, pasado.length - limite);
  return { pasado, futuro: [], pendiente: h.pendiente };
}

/** Cierra el gesto abierto (sea cual sea) contra el documento `actual`. */
function cerrarPendiente<T>(h: Historial<T>, actual: T, limite: number): Historial<T> {
  if (h.pendiente === null) return h;
  const sinPendiente = { ...h, pendiente: null };
  return h.pendiente.antes === actual ? sinPendiente : empujar(sinPendiente, h.pendiente.antes, limite);
}

/**
 * Un cambio de una sola vez (borrar, pintar, crear una flecha): `antes` pasa a
 * ser un paso si `despues` es distinto. Si había un gesto abierto, se cierra
 * primero contra `antes`, que es como lo dejó ese gesto.
 */
export function registrar<T>(
  h: Historial<T>,
  antes: T,
  despues: T,
  limite = LIMITE_HISTORIAL,
): Historial<T> {
  const cerrado = cerrarPendiente(h, antes, limite);
  return antes === despues ? cerrado : empujar(cerrado, antes, limite);
}

/**
 * Empieza un gesto. Con otro gesto abierto de distinta clave, ese se cierra
 * primero; con uno de la misma clave no pasa nada (se conserva el «antes» más
 * viejo, que es donde empezó de verdad).
 */
export function abrir<T>(
  h: Historial<T>,
  clave: string,
  actual: T,
  limite = LIMITE_HISTORIAL,
): Historial<T> {
  if (h.pendiente?.clave === clave) return h;
  const cerrado = cerrarPendiente(h, actual, limite);
  return { ...cerrado, pendiente: { clave, antes: actual } };
}

/** Termina el gesto `clave`; si el que está abierto es otro, no hace nada. */
export function cerrar<T>(
  h: Historial<T>,
  clave: string,
  actual: T,
  limite = LIMITE_HISTORIAL,
): Historial<T> {
  if (h.pendiente?.clave !== clave) return h;
  return cerrarPendiente(h, actual, limite);
}

/**
 * Vuelve al estado anterior al último paso. Devuelve `null` si no hay nada que
 * deshacer. Un gesto abierto se cierra antes, así que también se deshace.
 */
export function deshacer<T>(
  h: Historial<T>,
  actual: T,
  limite = LIMITE_HISTORIAL,
): { historial: Historial<T>; documento: T } | null {
  const cerrado = cerrarPendiente(h, actual, limite);
  if (cerrado.pasado.length === 0) return null;
  const documento = cerrado.pasado[cerrado.pasado.length - 1];
  return {
    documento,
    historial: {
      pasado: cerrado.pasado.slice(0, -1),
      futuro: [actual, ...cerrado.futuro],
      pendiente: null,
    },
  };
}

/** Rehace lo último deshecho. `null` si no hay nada (o si hubo un paso nuevo). */
export function rehacer<T>(
  h: Historial<T>,
  actual: T,
  limite = LIMITE_HISTORIAL,
): { historial: Historial<T>; documento: T } | null {
  const cerrado = cerrarPendiente(h, actual, limite);
  // Un gesto que cambió algo acaba de entrar como paso y vació el futuro.
  if (cerrado.futuro.length === 0) return null;
  const [documento, ...resto] = cerrado.futuro;
  const pasado = [...cerrado.pasado, actual];
  if (pasado.length > limite) pasado.splice(0, pasado.length - limite);
  return { documento, historial: { pasado, futuro: resto, pendiente: null } };
}

export function puedeDeshacer<T>(h: Historial<T>, actual: T): boolean {
  return h.pasado.length > 0 || (h.pendiente !== null && h.pendiente.antes !== actual);
}

export function puedeRehacer<T>(h: Historial<T>, actual: T): boolean {
  return h.futuro.length > 0 && (h.pendiente === null || h.pendiente.antes === actual);
}

/**
 * ¿Qué hace esta tecla con el historial? Ctrl+Z deshace; Ctrl+Y y Ctrl+Shift+Z
 * rehacen (Cmd en macOS). Se mira `key` en minúscula para que Shift no la
 * cambie, y `code` como respaldo para los teclados que no son QWERTY.
 */
export function accionDeTecla(e: {
  key: string;
  code?: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}): "deshacer" | "rehacer" | null {
  if (!(e.ctrlKey || e.metaKey) || e.altKey) return null;
  const k = e.key.toLowerCase();
  if (k === "z" || (k.length !== 1 && e.code === "KeyZ")) return e.shiftKey ? "rehacer" : "deshacer";
  if ((k === "y" || (k.length !== 1 && e.code === "KeyY")) && !e.shiftKey) return "rehacer";
  return null;
}
