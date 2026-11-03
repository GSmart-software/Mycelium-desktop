"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { MiniGraph, type GraphEdge, type GraphNode } from "@/components/graph/MiniGraph";
import { api } from "@/lib/api";
import { CacheLru } from "@/lib/cacheLru";
import { mismoGrafo } from "@/lib/grafoEquivalente";
import { folderPath } from "@/lib/search";
import { useAuthStore } from "@/stores/authStore";
import { usePanelLayoutStore } from "@/stores/panelLayoutStore";
import { useTabsStore } from "@/stores/tabsStore";
import { useVaultStore } from "@/stores/vaultStore";
import { EVENTO_NOTA_GUARDADA, EVENTO_RECARGA, type DetalleNotaGuardada } from "@/lib/eventos";
import { PropiedadesTab } from "./PropiedadesTab";
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

type Tab = "propiedades" | "grafo" | "salientes" | "retro";

// Cache en memoria por nota (stale-while-revalidate): al volver a una nota ya
// vista, el panel aparece al instante mientras se refresca en segundo plano.
//
// Con tope (`FUN-M-58`): antes crecía con cada nota visitada en la sesión, y
// cada entrada lleva el vecindario del mini-grafo y los fragmentos de los
// retroenlaces (en una nota muy citada, cientos de filas). 50 alcanza para ir y
// volver entre las notas de un tema; la que se cae solo pierde el «al
// instante»: se pide como la primera vez.
const MAX_CONEXIONES_RECORDADAS = 50;
const conexionesCache = new CacheLru<string, Conexiones>(MAX_CONEXIONES_RECORDADAS);

// Al cambiar de vault, lo recordado es de otro vault: los ids son rutas, y una
// misma ruta (`README.md`) en el vault nuevo mostraría por un momento las
// conexiones del anterior.
if (typeof window !== "undefined") {
  useVaultStore.subscribe((s, previo) => {
    if (s.vaultId !== previo.vaultId) conexionesCache.clear();
  });
}

/**
 * Las conexiones nuevas, pero con el `grafo` de las anteriores si dibuja lo
 * mismo: así el mini-grafo recibe los MISMOS arrays y no se reinicia, aunque la
 * lista de retroenlaces (sus fragmentos) o los metadatos sí cambien.
 */
function conservarGrafo(previas: Conexiones | null | undefined, nuevas: Conexiones): Conexiones {
  if (!previas || previas.nota.id !== nuevas.nota.id || !mismoGrafo(previas.grafo, nuevas.grafo)) return nuevas;
  return { ...nuevas, grafo: previas.grafo };
}

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
export function NotePanel({ notaId, paneId }: { notaId: string; paneId: string }) {
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

  /**
   * Se incrementa para volver a pedir las conexiones sin cambiar de nota. Hace
   * falta porque el caché es por nota y este panel puede quedarse montado
   * mientras el vault cambia por fuera (`DEF-054`): un documento nuevo que
   * enlace a esta nota no aparecería en RETROENLACES hasta cambiar de nota.
   */
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    function onRecarga() {
      conexionesCache.delete(notaId);
      setRevision((r) => r + 1);
    }
    // Guardar ESTA nota también cambia sus salientes. Antes llegaba solo, por el
    // watcher; ahora el watcher ignora lo que escribe la app (`FUN-M-38`).
    //
    // Pero casi ningún guardado (uno cada 10 s mientras se escribe) cambia los
    // enlaces, y volver a pedir las conexiones lee el texto de cada nota que
    // cita (hasta 1,7 MB en una nota muy citada). Si el guardado dice que no
    // cambiaron, solo se actualizan «Modificada» y «Tamaño», con lo que trae
    // el evento (`FUN-M-58`). Los retroenlaces no pueden haber cambiado: salen
    // del texto de OTRAS notas.
    function onGuardada(e: Event) {
      const detalle = (e as CustomEvent<Partial<DetalleNotaGuardada>>).detail;
      if (detalle?.notaId !== notaId) return;
      const { enlacesCambiaron, actualizadoEn, tamanoBytes } = detalle;
      if (enlacesCambiaron !== false || actualizadoEn === undefined || tamanoBytes === undefined) {
        onRecarga();
        return;
      }
      const parchar = (c: Conexiones): Conexiones => ({ ...c, nota: { ...c.nota, actualizadoEn, tamanoBytes } });
      const enCache = conexionesCache.get(notaId);
      if (enCache) conexionesCache.set(notaId, parchar(enCache));
      setData((d) => (d && d.nota.id === notaId ? parchar(d) : d));
    }
    window.addEventListener(EVENTO_RECARGA, onRecarga);
    window.addEventListener(EVENTO_NOTA_GUARDADA, onGuardada);
    return () => {
      window.removeEventListener(EVENTO_RECARGA, onRecarga);
      window.removeEventListener(EVENTO_NOTA_GUARDADA, onGuardada);
    };
  }, [notaId]);

  useEffect(() => {
    let cancelled = false;
    const cached = conexionesCache.get(notaId);
    // Al refrescar la MISMA nota (una recarga) lo que ya se ve se conserva: el
    // caché se vació, pero el panel sigue mostrando lo de antes hasta que llegue
    // lo nuevo, y su grafo, si no cambió, sigue siendo el mismo objeto.
    setData((d) => cached ?? (d && d.nota.id === notaId ? d : null));
    void api<Conexiones>(`/notas/${encodeURIComponent(notaId)}/conexiones`, {
      token: useAuthStore.getState().accessToken,
    })
      .then((res) => {
        const nuevas = conservarGrafo(conexionesCache.get(notaId), res);
        conexionesCache.set(notaId, nuevas);
        if (!cancelled) setData((d) => conservarGrafo(d, nuevas));
      })
      .catch(() => {
        if (!cancelled && !cached) setData(null);
      });
    return () => {
      cancelled = true;
    };
  }, [notaId, revision]);

  // Grafo filtrado por dirección según los dos toggles. Depende del `grafo` y
  // del centro, NO de `data` entero: un guardado cambia la fecha y el tamaño de
  // la nota, y con `data` como dependencia salían arrays nuevos y el mini-grafo
  // se reiniciaba cada 10 s (`FUN-M-58`).
  const centro = data?.nota.id ?? null;
  const grafoDatos = data?.grafo ?? null;
  const grafo = useMemo(() => {
    if (!grafoDatos || !centro) return { nodos: [] as GraphNode[], aristas: [] as GraphEdge[] };
    const aristas = grafoDatos.aristas.filter(
      (a) => (showSalientes && a.source === centro) || (showRetro && a.target === centro),
    );
    const ids = new Set<string>([centro]);
    for (const e of aristas) {
      ids.add(e.source);
      ids.add(e.target);
    }
    return { nodos: grafoDatos.nodos.filter((n) => ids.has(n.id)), aristas };
  }, [grafoDatos, centro, showSalientes, showRetro]);

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
        <TabButton active={tab === "propiedades"} onClick={() => setTab("propiedades")}>
          PROPIEDADES
        </TabButton>
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
        {tab === "propiedades" && <PropiedadesTab notaId={notaId} paneId={paneId} />}

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
                animarSoloConPuntero
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
