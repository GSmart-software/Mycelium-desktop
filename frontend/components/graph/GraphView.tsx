"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect } from "react";
import { useAuthStore } from "@/stores/authStore";
import { useGraphStore, type NodePos } from "@/stores/graphStore";
import { useTabsStore } from "@/stores/tabsStore";
import { MiniGraph } from "./MiniGraph";
import styles from "./GraphView.module.css";

/**
 * Vista del grafo global como ventana del área de panes (estilo Obsidian):
 * ocupa toda la pestaña, fondo oscuro, todos los nodos del vault. Clic en un
 * nodo abre la nota en una pestaña.
 *
 * Los datos y el layout viven en `useGraphStore` (cache en memoria): volver a
 * esta pestaña los muestra al instante y solo refresca en segundo plano. Si se
 * crea/edita/borra una nota, el grafo se marca `stale` y se actualiza solo.
 */
export function GraphView() {
  const router = useRouter();
  const vaultId = useAuthStore((s) => s.vaults[0]?.id) ?? null;
  const data = useGraphStore((s) => s.data);
  const status = useGraphStore((s) => s.status);
  const stale = useGraphStore((s) => s.stale);

  // Carga inicial / cambio de vault (usa cache si ya hay datos frescos).
  useEffect(() => {
    if (vaultId) void useGraphStore.getState().fetch(vaultId);
  }, [vaultId]);

  // Refresco en vivo: si algo marcó el grafo como stale mientras está abierto.
  useEffect(() => {
    if (stale && vaultId) void useGraphStore.getState().fetch(vaultId, { force: true });
  }, [stale, vaultId]);

  const open = (notaId: string) => {
    useTabsStore.getState().openNote(notaId);
    router.push(`/workspace?note=${notaId}`);
  };

  const savePositions = useCallback(
    (positions: Record<string, NodePos>) => useGraphStore.getState().savePositions(positions),
    [],
  );

  if (data && data.nodos.length > 0) {
    return (
      <div className={styles.view}>
        <MiniGraph
          nodes={data.nodos}
          edges={data.aristas}
          centerId={null}
          onOpen={open}
          initialPositions={useGraphStore.getState().positions}
          onPositions={savePositions}
          getInitialView={() => useGraphStore.getState().view}
          onView={(v) => useGraphStore.getState().saveView(v)}
        />
      </div>
    );
  }

  return (
    <div className={styles.view}>
      <div className={styles.empty}>
        {status === "loading" ? (
          <p>Cargando grafo…</p>
        ) : (
          <>
            <p>Aún no hay notas en el grafo.</p>
            <p className={styles.hint}>
              Enlazá notas con <code>[[nombre]]</code> para tejer tu red.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
