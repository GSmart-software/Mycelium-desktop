/**
 * Salto pendiente para posicionar el cursor al abrir una nota: a la primera
 * coincidencia de un término —desde la búsqueda global (HU-21 CA8)— o a una
 * línea —desde el MCP de control (`FUN-L-09`), que resuelve encabezados y
 * textos a su línea antes de pedir el salto—. Quien navega registra el salto
 * antes de abrir; el editor lo consume cuando la vista está lista (o al vuelo,
 * con el evento `micelio:goto-match`, si la nota ya estaba abierta en un pane).
 */
export type Salto = string | { linea: number };

const pending = new Map<string, Salto>();

export function setPendingMatch(notaId: string, salto: Salto): void {
  if (typeof salto !== "string" || salto.trim().length > 0) pending.set(notaId, salto);
}

export function takePendingMatch(notaId: string): Salto | undefined {
  const salto = pending.get(notaId);
  pending.delete(notaId);
  return salto;
}
