"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { MiniGraph, type GraphEdge, type GraphNode } from "@/components/graph/MiniGraph";
import { api } from "@/lib/api";
import { folderPath } from "@/lib/search";
import { useAuthStore } from "@/stores/authStore";
import { usePanelLayoutStore } from "@/stores/panelLayoutStore";
import { useTabsStore } from "@/stores/tabsStore";
import { useVaultStore } from "@/stores/vaultStore";
import styles from "./NotePanel.module.css";

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

// Cache en memoria por nota (stale-while-revalidate): al volver a una nota ya
// vista, el panel aparece al instante mientras se refresca en segundo plano.
const conexionesCache = new Map<string, Conexiones>();

const fmtFecha = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
};

const fmtTamano = (bytes: number) =>
  bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`;

/**
 * Panel de metadatos/conexiones de UNA nota, embebido dentro de su editor (a la
 * derecha). Así cada archivo abierto —incluso en pantalla dividida— tiene su
 * propio panel, y no existe en la vista de grafo ni cuando no hay archivo.
 */
export function NotePanel({ notaId }: { notaId: string }) {
  const router = useRouter();
  const width = usePanelLayoutStore((s) => s.rightWidth);
  const panelRef = useRef<HTMLDivElement>(null);
  // Borde derecho del panel (fijo) capturado al iniciar el arrastre; el ancho
  // nuevo = borde derecho - x del puntero. Es un handle por-pane (no anclado a
  // la ventana como el de los paneles laterales).
  const resizeEdge = useRef<number | null>(null);
  const carpetas = useVaultStore((s) => s.carpetas);
  const vaultId = useVaultStore((s) => s.vaultId);
  const vaultNombre = useAuthStore(
    (s) => s.vaults.find((v) => v.id === vaultId)?.nombre ?? "vault",
  );

  const [tab, setTab] = useState<Tab>("grafo");
  const [data, setData] = useState<Conexiones | null>(null);
  const [showSalientes, setShowSalientes] = useState(true);
  const [showRetro, setShowRetro] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const cached = conexionesCache.get(notaId);
    setData(cached ?? null);
    void api<Conexiones>(`/notas/${encodeURIComponent(notaId)}/conexiones`, {
      token: useAuthStore.getState().accessToken,
    })
      .then((res) => {
        conexionesCache.set(notaId, res);
        if (!cancelled) setData(res);
      })
      .catch(() => {
        if (!cancelled && !cached) setData(null);
      });
    return () => {
      cancelled = true;
    };
  }, [notaId]);

  // Grafo filtrado por dirección según los dos toggles.
  const grafo = useMemo(() => {
    if (!data) return { nodos: [] as GraphNode[], aristas: [] as GraphEdge[] };
    const centro = data.nota.id;
    const aristas = data.grafo.aristas.filter(
      (a) => (showSalientes && a.source === centro) || (showRetro && a.target === centro),
    );
    const ids = new Set<string>([centro]);
    for (const e of aristas) {
      ids.add(e.source);
      ids.add(e.target);
    }
    return { nodos: data.grafo.nodos.filter((n) => ids.has(n.id)), aristas };
  }, [data, showSalientes, showRetro]);

  const open = (id: string) => {
    useTabsStore.getState().openNote(id);
    router.replace(`/workspace?note=${id}`);
  };

  const resizeHandle = (
    <div
      className={styles.resize}
      role="separator"
      aria-orientation="vertical"
      aria-label="Redimensionar panel"
      onPointerDown={(e) => {
        resizeEdge.current = panelRef.current?.getBoundingClientRect().right ?? window.innerWidth;
        e.currentTarget.setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => {
        if (resizeEdge.current == null) return;
        usePanelLayoutStore.getState().setRightWidth(resizeEdge.current - e.clientX);
      }}
      onPointerUp={(e) => {
        resizeEdge.current = null;
        e.currentTarget.releasePointerCapture(e.pointerId);
      }}
    />
  );

  if (!data) {
    return (
      <div className={styles.panel} ref={panelRef} style={{ width }}>
        {resizeHandle}
        <p className={styles.empty}>Cargando conexiones…</p>
      </div>
    );
  }

  return (
    <div className={styles.panel} ref={panelRef} style={{ width }}>
      {resizeHandle}
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
                className={showSalientes ? `${styles.chip} ${styles.chipActive}` : styles.chip}
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
    </div>
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
