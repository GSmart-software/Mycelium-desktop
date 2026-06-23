"use client";

import { History, Square } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { folderPath } from "@/lib/search";
import { useAuthStore } from "@/stores/authStore";
import { useGraphStore, type NodePos } from "@/stores/graphStore";
import { usePreferencesStore } from "@/stores/preferencesStore";
import { useTabsStore } from "@/stores/tabsStore";
import { useVaultStore } from "@/stores/vaultStore";
import { GraphOptionsMenu } from "./GraphOptionsMenu";
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

  const colorGroups = usePreferencesStore((s) => s.prefs.graphColorGroups);
  const excludeRules = usePreferencesStore((s) => s.prefs.graphExcludeRules);
  const notas = useVaultStore((s) => s.notas);
  const carpetas = useVaultStore((s) => s.carpetas);
  const carpetaById = useMemo(() => new Map(notas.map((n) => [n.id, n.carpetaId])), [notas]);

  // Reglas de exclusión → ids a ocultar. name = el nombre contiene `value`;
  // tag = tiene esa etiqueta; path = ruta EXACTA de archivo o de directorio (en
  // este último caso oculta también su contenido).
  const excludedIds = useMemo(() => {
    const reglas = excludeRules.filter((r) => r.value.trim());
    if (reglas.length === 0 || !data) return null;
    const set = new Set<string>();
    for (const node of data.nodos) {
      const fp = folderPath(carpetaById.get(node.id) ?? null, carpetas).toLowerCase();
      const full = fp ? `${fp}/${node.titulo.toLowerCase()}` : node.titulo.toLowerCase();
      for (const r of reglas) {
        const v = r.value.trim().toLowerCase().replace(/\/+$/, "");
        let hit = false;
        if (r.type === "name") hit = node.titulo.toLowerCase().includes(v);
        else if (r.type === "tag") hit = (node.tags ?? []).some((t) => t.toLowerCase() === v);
        else hit = full === v || fp === v || fp.startsWith(`${v}/`);
        if (hit) {
          set.add(node.id);
          break;
        }
      }
    }
    return set;
  }, [excludeRules, data, carpetaById, carpetas]);

  // Grafo visible tras aplicar las exclusiones (se quitan nodos y sus aristas).
  const visible = useMemo(() => {
    if (!data) return { nodos: [], aristas: [] };
    if (!excludedIds || excludedIds.size === 0) return data;
    return {
      nodos: data.nodos.filter((n) => !excludedIds.has(n.id)),
      aristas: data.aristas.filter(
        (a) => !excludedIds.has(a.source) && !excludedIds.has(a.target),
      ),
    };
  }, [data, excludedIds]);

  // Color por nodo (sobre el grafo visible): gana el primer grupo que coincide.
  const nodeColors = useMemo(() => {
    const grupos = colorGroups.filter((g) => g.value.trim());
    if (grupos.length === 0) return undefined;
    const m = new Map<string, string>();
    for (const node of visible.nodos) {
      for (const g of grupos) {
        const v = g.value.trim().toLowerCase();
        let match = false;
        if (g.type === "name") match = node.titulo.toLowerCase().includes(v);
        else if (g.type === "tag") match = (node.tags ?? []).some((t) => t.toLowerCase() === v);
        else match = folderPath(carpetaById.get(node.id) ?? null, carpetas).toLowerCase().includes(v);
        if (match) {
          m.set(node.id, g.color);
          break;
        }
      }
    }
    return m;
  }, [colorGroups, visible, carpetaById, carpetas]);

  // ── Construcción temporal (timelapse): los nodos aparecen por fecha de
  //    creación; la fecha avanza día a día sin saltear los días sin nodos. ──
  const [timelapse, setTimelapse] = useState<{ cutoff: number; label: string } | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const DAY = 86_400_000;
  const fmtDay = (ms: number) => {
    const d = new Date(ms);
    const mes = d.toLocaleDateString(undefined, { month: "short" }).replace(".", "");
    return `${d.getDate()} ${mes} ${d.getFullYear()}`; // p. ej. "10 jun 2026"
  };

  const stopTimelapse = useCallback(() => {
    if (timer.current) {
      clearInterval(timer.current);
      timer.current = null;
    }
    setTimelapse(null);
  }, []);
  useEffect(() => stopTimelapse, [stopTimelapse]); // detener al desmontar

  const startTimelapse = () => {
    if (timer.current) {
      stopTimelapse();
      return;
    }
    const times = visible.nodos
      .map((n) => (n.creadoEn ? Date.parse(n.creadoEn) : NaN))
      .filter((t) => !Number.isNaN(t));
    if (times.length === 0) return;
    const startDay = Math.floor(Math.min(...times) / DAY) * DAY;
    const endDay = Math.floor(Math.max(...times) / DAY) * DAY;
    const days = Math.round((endDay - startDay) / DAY) + 1;
    const interval = Math.min(260, Math.max(25, Math.round(16_000 / days))); // ~16 s total
    let cur = startDay;
    const stepDay = () => {
      setTimelapse({ cutoff: cur + DAY - 1, label: fmtDay(cur) });
      if (cur >= endDay) {
        if (timer.current) {
          clearInterval(timer.current);
          timer.current = null;
        }
        window.setTimeout(() => setTimelapse(null), 1200); // al terminar, mostrar todo
        return;
      }
      cur += DAY;
    };
    stepDay();
    timer.current = setInterval(stepDay, interval);
  };

  const hasNotes = !!data && data.nodos.length > 0;

  return (
    <div className={styles.view}>
      {/* Controles siempre disponibles mientras haya notas. */}
      {hasNotes && (
        <>
          <button
            type="button"
            className={timelapse ? `${styles.controlBtn} ${styles.controlActive}` : styles.controlBtn}
            title={timelapse ? "Detener construcción" : "Construcción temporal (cronológica)"}
            aria-label="Construcción temporal del grafo"
            aria-pressed={!!timelapse}
            onClick={startTimelapse}
          >
            {timelapse ? <Square size={15} aria-hidden /> : <History size={16} aria-hidden />}
          </button>
          <GraphOptionsMenu />
        </>
      )}
      {timelapse?.label && <div className={styles.timelapseDate}>{timelapse.label}</div>}
      {visible.nodos.length > 0 ? (
        <MiniGraph
          nodes={visible.nodos}
          edges={visible.aristas}
          centerId={null}
          onOpen={open}
          initialPositions={useGraphStore.getState().positions}
          onPositions={savePositions}
          getInitialView={() => useGraphStore.getState().view}
          onView={(v) => useGraphStore.getState().saveView(v)}
          nodeColors={nodeColors}
          revealCutoff={timelapse?.cutoff ?? null}
        />
      ) : (
        <div className={styles.empty}>
          {status === "loading" ? (
            <p>Cargando grafo…</p>
          ) : hasNotes ? (
            <>
              <p>Las reglas de exclusión ocultan todos los nodos.</p>
              <p className={styles.hint}>Quitá alguna regla desde el menú de opciones.</p>
            </>
          ) : (
            <>
              <p>Aún no hay notas en el grafo.</p>
              <p className={styles.hint}>
                Enlazá notas con <code>[[nombre]]</code> para tejer tu red.
              </p>
            </>
          )}
        </div>
      )}
    </div>
  );
}
