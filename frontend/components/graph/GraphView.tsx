"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useAuthStore } from "@/stores/authStore";
import { useTabsStore } from "@/stores/tabsStore";
import { MiniGraph, type GraphEdge, type GraphNode } from "./MiniGraph";
import styles from "./GraphView.module.css";

/**
 * Vista del grafo global como ventana del área de panes (estilo Obsidian):
 * ocupa toda la pestaña, fondo oscuro, todos los nodos del vault. Clic en un
 * nodo abre la nota en una pestaña.
 */
export function GraphView() {
  const router = useRouter();
  const vaultId = useAuthStore((s) => s.vaults[0]?.id) ?? null;
  const [graph, setGraph] = useState<{ nodos: GraphNode[]; aristas: GraphEdge[] } | null>(null);

  useEffect(() => {
    if (!vaultId) return;
    let cancelled = false;
    void api<{ nodos: GraphNode[]; aristas: GraphEdge[] }>(`/vaults/${vaultId}/grafo`, {
      token: useAuthStore.getState().accessToken,
    })
      .then((res) => !cancelled && setGraph(res))
      .catch(() => !cancelled && setGraph(null));
    return () => {
      cancelled = true;
    };
  }, [vaultId]);

  const open = (notaId: string) => {
    useTabsStore.getState().openNote(notaId);
    router.push(`/workspace?note=${notaId}`);
  };

  return (
    <div className={styles.view}>
      {graph && graph.nodos.length > 0 ? (
        <MiniGraph nodes={graph.nodos} edges={graph.aristas} centerId={null} onOpen={open} />
      ) : (
        <div className={styles.empty}>
          <p>Aún no hay notas en el grafo.</p>
          <p className={styles.hint}>
            Enlazá notas con <code>[[nombre]]</code> para tejer tu red.
          </p>
        </div>
      )}
    </div>
  );
}
