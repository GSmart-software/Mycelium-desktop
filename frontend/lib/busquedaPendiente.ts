/**
 * Abrir la búsqueda global con un texto ya escrito, desde fuera del panel (las
 * etiquetas de la pestaña «Salud del vault», `FUN-L-32`). El panel de búsqueda
 * guarda su texto en estado local y se desmonta al cambiar de sección del
 * rail: si está cerrado, lo toma al montarse (`tomarBusquedaPendiente`); si ya
 * está abierto, lo recibe por el evento.
 */
export const EVENTO_BUSCAR = "micelio:buscar";

let pendiente: string | null = null;

/** Deja el texto para el panel de búsqueda y avisa al que esté montado. */
export function pedirBusqueda(texto: string): void {
  pendiente = texto;
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(EVENTO_BUSCAR, { detail: texto }));
}

/** El texto pedido, sin consumirlo (el inicializador de estado puede correr dos veces). */
export const verBusquedaPendiente = (): string | null => pendiente;

/** El texto pedido antes de que el panel se montara (una sola vez). */
export function tomarBusquedaPendiente(): string | null {
  const t = pendiente;
  pendiente = null;
  return t;
}
