"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { MiniGraph, type GraphEdge, type GraphNode } from "@/components/graph/MiniGraph";
import { api } from "@/lib/api";
import { folderPath } from "@/lib/search";
import { useAuthStore } from "@/stores/authStore";
import { usePanelLayoutStore } from "@/stores/panelLayoutStore";
import { findLeaf, useTabsStore } from "@/stores/tabsStore";
import { useVaultStore } from "@/stores/vaultStore";
import { ResizeHandle } from "./ResizeHandle";
import panels from "./Panels.module.css";
import styles from "./RightPanel.module.css";

type Conexiones = {
  nota: {
    id: string;
    titulo: string;
    carpetaId: string | null;
    creadoEn: string;
    actualizadoEn: string;
    tamanoBytes: number;
  };
  salientes: { id: string; titulo: string }[];
  retro: { id: string; titulo: string; fragmento: string }[];
  grafo: { nodos: GraphNode[]; aristas: GraphEdge[] };
};

type Tab = "grafo" | "salientes" | "retro";

const fmtFecha = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
};

const fmtTamano = (bytes: number) =>
  bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`;

/**
 * Panel derecho del workspace (HU-30): tabs GRAFO / SALIENTES / RETRO con las
 * conexiones de la nota activa y una sección de metadatos siempre visible.
 */
export function RightPanel() {
  const router = useRouter();
  const rightOpen = usePanelLayoutStore((s) => s.rightOpen);
  const setRightWidth = usePanelLayoutStore((s) => s.setRightWidth);

  const activeNotaId = useTabsStore((s) => {
    const leaf = findLeaf(s.root, s.activePaneId);
    if (!leaf?.activeTabId) return null;
    return leaf.tabs.find((t) => t.id === leaf.activeTabId)?.notaId ?? null;
  });

  const carpetas = useVaultStore((s) => s.carpetas);
  const vaultId = useVaultStore((s) => s.vaultId);
  const vaultNombre = useAuthStore(
    (s) => s.vaults.find((v) => v.id === vaultId)?.nombre ?? "vault",
  );

  const [tab, setTab] = useState<Tab>("grafo");
  const [data, setData] = useState<Conexiones | null>(null);
  // Dos opciones del grafo, combinables: mostrar las que esta nota referencia
  // (salientes) y/o las que la referencian (retro). Por defecto ambas activas.
  const [showSalientes, setShowSalientes] = useState(true);
  const [showRetro, setShowRetro] = useState(true);

  // Grafo filtrado por dirección según los dos toggles.
  const grafo = useMemo(() => {
    if (!data) return { nodos: [] as GraphNode[], aristas: [] as GraphEdge[] };
    const centro = data.nota.id;
    const aristas = data.grafo.aristas.filter(
      (a) =>
        (showSalientes && a.source === centro) || (showRetro && a.target === centro),
    );
    const ids = new Set<string>([centro]);
    for (const e of aristas) {
      ids.add(e.source);
      ids.add(e.target);
    }
    return { nodos: data.grafo.nodos.filter((n) => ids.has(n.id)), aristas };
  }, [data, showSalientes, showRetro]);

  useEffect(() => {
    if (!rightOpen || !activeNotaId) {
      setData(null);
      return;
    }
    let cancelled = false;
    void api<Conexiones>(`/notas/${activeNotaId}/conexiones`, {
      token: useAuthStore.getState().accessToken,
    })
      .then((res) => {
        if (!cancelled) setData(res);
      })
      .catch(() => {
        if (!cancelled) setData(null);
      });
    return () => {
      cancelled = true;
    };
  }, [rightOpen, activeNotaId]);

  const open = (notaId: string) => {
    useTabsStore.getState().openNote(notaId);
    router.push(`/workspace?note=${notaId}`);
  };

  return (
    <aside
      className={`${panels.panel} ${panels.panelRight}`}
      aria-hidden={!rightOpen}
    >
      {rightOpen && (
        <>
          <div className={panels.panelContent}>
            {!activeNotaId || !data ? (
              <p className={panels.placeholder}>
                Abrí una nota para ver sus conexiones.
              </p>
            ) : (
              <>
                <div className={styles.tabs} role="tablist">
                  <TabButton active={tab === "grafo"} onClick={() => setTab("grafo")}>
                    GRAFO
                  </TabButton>
                  <TabButton active={tab === "salientes"} onClick={() => setTab("salientes")}>
                    SALIENTES ({data.salientes.length})
                  </TabButton>
                  <TabButton active={tab === "retro"} onClick={() => setTab("retro")}>
                    RETRO ({data.retro.length})
                  </TabButton>
                </div>

                <div className={styles.tabBody}>
                  {tab === "grafo" && (
                    <>
                      <div className={styles.graphFilters}>
                        <button
                          type="button"
                          className={
                            showSalientes ? `${styles.chip} ${styles.chipActive}` : styles.chip
                          }
                          aria-pressed={showSalientes}
                          title="Archivos que esta nota referencia"
                          onClick={() => setShowSalientes((v) => !v)}
                        >
                          Referencia ({data.salientes.length})
                        </button>
                        <button
                          type="button"
                          className={showRetro ? `${styles.chip} ${styles.chipActive}` : styles.chip}
                          aria-pressed={showRetro}
                          title="Archivos que referencian a esta nota"
                          onClick={() => setShowRetro((v) => !v)}
                        >
                          Lo referencian ({data.retro.length})
                        </button>
                      </div>
                      <div className={styles.graphBox}>
                        <MiniGraph
                          nodes={grafo.nodos}
                          edges={grafo.aristas}
                          centerId={data.nota.id}
                          onOpen={open}
                        />
                      </div>
                    </>
                  )}

                  {tab === "salientes" && (
                    <ul className={styles.list}>
                      {data.salientes.length === 0 && (
                        <li className={styles.empty}>Esta nota no enlaza a otras.</li>
                      )}
                      {data.salientes.map((s) => (
                        <li key={s.id}>
                          <button className={styles.link} onClick={() => open(s.id)}>
                            {s.titulo}
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}

                  {tab === "retro" && (
                    <ul className={styles.list}>
                      {data.retro.length === 0 && (
                        <li className={styles.empty}>Ninguna nota enlaza a esta.</li>
                      )}
                      {data.retro.map((r) => (
                        <li key={r.id}>
                          <button className={styles.linkBlock} onClick={() => open(r.id)}>
                            <span className={styles.link}>{r.titulo}</span>
                            <span className={styles.fragment}>{r.fragmento}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                <dl className={styles.meta}>
                  <div>
                    <dt>Creada</dt>
                    <dd>{fmtFecha(data.nota.creadoEn)}</dd>
                  </div>
                  <div>
                    <dt>Modificada</dt>
                    <dd>{fmtFecha(data.nota.actualizadoEn)}</dd>
                  </div>
                  <div>
                    <dt>Ruta</dt>
                    <dd>
                      {[vaultNombre, folderPath(data.nota.carpetaId, carpetas), data.nota.titulo]
                        .filter(Boolean)
                        .join(" / ")}
                    </dd>
                  </div>
                  <div>
                    <dt>Tamaño</dt>
                    <dd>{fmtTamano(data.nota.tamanoBytes)}</dd>
                  </div>
                </dl>
              </>
            )}
          </div>
          <ResizeHandle side="right" onResize={setRightWidth} />
        </>
      )}
    </aside>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      className={`${styles.tab} ${active ? styles.tabActive : ""}`}
      onClick={onClick}
    >
      {children}
    </button>
  );
}
