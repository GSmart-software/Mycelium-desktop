/**
 * Coincidencia pendiente para posicionar el cursor al abrir una nota desde la
 * búsqueda global (HU-21 CA8). El panel de búsqueda registra el término antes
 * de navegar; el editor lo consume cuando la vista está lista (o al vuelo si la
 * nota ya estaba abierta en un pane).
 */
const pending = new Map<string, string>();

export function setPendingMatch(notaId: string, term: string): void {
  if (term.trim().length > 0) pending.set(notaId, term);
}

export function takePendingMatch(notaId: string): string | undefined {
  const term = pending.get(notaId);
  pending.delete(notaId);
  return term;
}
