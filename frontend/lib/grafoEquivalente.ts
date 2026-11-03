import type { GraphEdge, GraphNode } from "@/components/graph/MiniGraph";

/**
 * ¿Dibujan lo mismo dos grafos? Mismos nodos —id, título, grado, etiquetas y
 * fecha de creación— y mismas aristas, en el mismo orden (`FUN-M-58`).
 *
 * `MiniGraph` depende de sus arrays: si le llegan arrays nuevos, rehace motor,
 * precálculo y fundido, y el lienzo queda vacío un instante (210–335 ms de JS
 * en el panel de una nota muy citada; cientos más en el grafo global). Tras
 * cada guardado —uno cada 10 s mientras se escribe— llegaban arrays nuevos con
 * lo mismo adentro. Quien refresca compara con esto y, si dibujan lo mismo,
 * conserva el objeto anterior. Es un recorrido sin armar nada: menos de un
 * milisegundo para los ~1.300 nodos de la Tesina.
 */
export function mismoGrafo(
  a: { nodos: GraphNode[]; aristas: GraphEdge[] },
  b: { nodos: GraphNode[]; aristas: GraphEdge[] },
): boolean {
  if (a.nodos.length !== b.nodos.length || a.aristas.length !== b.aristas.length) return false;
  for (let i = 0; i < a.nodos.length; i++) {
    const x = a.nodos[i];
    const y = b.nodos[i];
    if (x.id !== y.id || x.titulo !== y.titulo || x.conexiones !== y.conexiones || x.creadoEn !== y.creadoEn) {
      return false;
    }
    const tx = x.tags ?? [];
    const ty = y.tags ?? [];
    if (tx.length !== ty.length) return false;
    for (let j = 0; j < tx.length; j++) if (tx[j] !== ty[j]) return false;
  }
  for (let i = 0; i < a.aristas.length; i++) {
    if (a.aristas[i].source !== b.aristas[i].source || a.aristas[i].target !== b.aristas[i].target) return false;
  }
  return true;
}
