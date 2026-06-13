"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useAuthStore } from "@/stores/authStore";
import { useTabsStore } from "@/stores/tabsStore";
import { useVaultStore } from "@/stores/vaultStore";
import { MiniGraph, type GraphEdge, type GraphNode } from "./MiniGraph";
import styles from "./GlobalGraphPanel.module.css";

/**
 * Grafo global del vault en el panel izquierdo (rail). Reutiliza MiniGraph con
 * todos los nodos del vault; clic en un nodo abre la nota.
 */
export function GlobalGraphPanel() {
  const router = useRouter();
  const vaultId = useVaultStore((s) => s.vaultId);
  const [graph, setGraph] = useState<{ nodos: GraphNode[]; aristas: GraphEdge[] } | null>(null);

  useEffect(() => {
    if (!vaultId) return;
    let cancelled = false;
    void api<{ nodos: GraphNode[]; aristas: GraphEdge[] }>(`/vaults/${vaultId}/grafo`, {
      token: useAuthStore.getState().accessToken,
    })
      .then((res) => {
        if (!cancelled) setGraph(res);
      })
      .catch(() => {
        if (!cancelled) setGraph(null);
      });
    return () => {
      cancelled = true;
    };
  }, [vaultId]);

  const open = (notaId: string) => {
    useTabsStore.getState().openNote(notaId);
    router.push(`/workspace?note=${notaId}`);
  };

  if (!graph || graph.nodos.length === 0) {
    return (
      <p className={styles.empty}>
        Aún no hay notas conectadas. Enlazá notas con <code>[[nombre]]</code>.
      </p>
    );
  }

  return (
    <div className={styles.box}>
      <MiniGraph nodes={graph.nodos} edges={graph.aristas} centerId={null} onOpen={open} />
    </div>
  );
}
