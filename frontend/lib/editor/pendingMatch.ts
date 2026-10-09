/**
 * Salto pendiente para posicionar el cursor al abrir una nota: a la primera
 * coincidencia de un término —desde la búsqueda global (HU-21 CA8)—, a una
 * línea —desde el MCP de control (`FUN-L-09`), que resuelve encabezados y
 * textos a su línea antes de pedir el salto— o a un ancla —desde un
 * `[[Nota#Encabezado]]` o `[[Nota#^bloque]]` (`DEF-141`), que el editor
 * resuelve contra el contenido al llegar—. Quien navega registra el salto
 * antes de abrir; el editor lo consume cuando la vista está lista (o al vuelo,
 * con el evento `micelio:goto-match`, si la nota ya estaba abierta en un pane).
 */
export type Salto = string | { linea: number } | { ancla: string };

const pending = new Map<string, Salto>();

export function setPendingMatch(notaId: string, salto: Salto): void {
  if (typeof salto !== "string" || salto.trim().length > 0) pending.set(notaId, salto);
}

export function takePendingMatch(notaId: string): Salto | undefined {
  const salto = pending.get(notaId);
  pending.delete(notaId);
  return salto;
}

/**
 * Pide ir a un ancla de una nota que se está por abrir (`DEF-141`): la deja
 * pendiente para el editor que la monte y avisa al que ya la tenga montada.
 * Llamarla DESPUÉS de abrir la pestaña: el evento lo atiende un editor vivo.
 */
export function pedirSaltoAAncla(notaId: string, ancla: string): void {
  setPendingMatch(notaId, { ancla });
  window.dispatchEvent(new CustomEvent("micelio:goto-match", { detail: { notaId, ancla } }));
}
