/**
 * Broker de documentos en memoria: la misma nota abierta en varios panes
 * refleja los cambios en tiempo real (HU-25/HU-26 CA6). Será reemplazado
 * por la fuente Yjs local en la épica de colaboración (HU-05).
 */

type Listener = { instanceId: string; fn: (content: string) => void };

const listeners = new Map<string, Set<Listener>>();

export function subscribeDoc(
  notaId: string,
  instanceId: string,
  fn: (content: string) => void,
): () => void {
  const set = listeners.get(notaId) ?? new Set();
  const entry: Listener = { instanceId, fn };
  set.add(entry);
  listeners.set(notaId, set);
  return () => {
    set.delete(entry);
    if (set.size === 0) listeners.delete(notaId);
  };
}

export function publishDoc(notaId: string, sourceInstanceId: string, content: string) {
  const set = listeners.get(notaId);
  if (!set) return;
  for (const listener of set) {
    if (listener.instanceId !== sourceInstanceId) listener.fn(content);
  }
}
