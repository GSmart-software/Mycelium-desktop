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
 * Normaliza una ruta para comparar reglas: minúsculas y separador `/` sin
 * espacios. `folderPath` usa " / " como separador visual, así que sin esto las
 * reglas de ruta no detectaban subcarpetas (p. ej. "proyectos / sub").
 */
const normPath = (s: string) =>
  s.toLowerCase().trim().replace(/\s*\/\s*/g, "/").replace(/\/+$/, "");

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
    router.replace(`/workspace?note=${notaId}`);
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
  // este último caso oculta también su contenido, incluidas subcarpetas).
  const excludedIds = useMemo(() => {
    const reglas = excludeRules.filter((r) => r.value.trim() && r.enabled !== false);
    if (reglas.length === 0 || !data) return null;
    const set = new Set<string>();
    for (const node of data.nodos) {
      const fp = normPath(folderPath(carpetaById.get(node.id) ?? null, carpetas));
      const full = fp ? `${fp}/${normPath(node.titulo)}` : normPath(node.titulo);
      for (const r of reglas) {
        const raw = r.value.trim().toLowerCase();
        let hit = false;
        if (r.type === "name") hit = node.titulo.toLowerCase().includes(raw);
        else if (r.type === "tag") hit = (node.tags ?? []).some((t) => t.toLowerCase() === raw);
        else {
          // Ruta exacta del archivo, o de un directorio (oculta también todo lo
          // que contiene: archivos y subcarpetas).
          const v = normPath(r.value);
          hit = !!v && (full === v || fp === v || fp.startsWith(`${v}/`));
        }
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
    const grupos = colorGroups.filter((g) => g.value.trim() && g.enabled !== false);
    if (grupos.length === 0) return undefined;
    const m = new Map<string, string>();
    for (const node of visible.nodos) {
      for (const g of grupos) {
        const v = g.value.trim().toLowerCase();
        let match = false;
        if (g.type === "name") match = node.titulo.toLowerCase().includes(v);
        else if (g.type === "tag") match = (node.tags ?? []).some((t) => t.toLowerCase() === v);
        else match = normPath(folderPath(carpetaById.get(node.id) ?? null, carpetas)).includes(normPath(g.value));
        if (match) {
          m.set(node.id, g.color);
          break;
        }
      }
    }
    return m;
  }, [colorGroups, visible, carpetaById, carpetas]);

  // ── Construcción temporal (timelapse): los nodos aparecen de a uno en orden
  //    de creación; la fecha avanza día a día sin saltear los días sin nodos.
  //    `count` = cuántos nodos (en orden de creación) están revelados. ──
  const [timelapse, setTimelapse] = useState<{ count: number; label: string } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fmtDay = (ms: number) => {
    const d = new Date(ms);
    const mes = d.toLocaleDateString(undefined, { month: "short" }).replace(".", "");
    return `${d.getDate()} ${mes} ${d.getFullYear()}`; // p. ej. "10 jun 2026"
  };

  const stopTimelapse = useCallback(() => {
    if (timer.current) {
      clearTimeout(timer.current);
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
    // Orden de creación (desempate por id para coincidir con MiniGraph).
    const sorted = visible.nodos
      .map((n) => ({ id: n.id, t: n.creadoEn ? Date.parse(n.creadoEn) : NaN }))
      .filter((n) => !Number.isNaN(n.t))
      .sort((a, b) => a.t - b.t || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    if (sorted.length === 0) return;

    // Días en hora LOCAL (la etiqueta debe coincidir con la fecha que ve el
    // usuario; bucketizar en UTC mostraría la fecha corrida un día).
    const dayStart = (t: number) => {
      const d = new Date(t);
      d.setHours(0, 0, 0, 0);
      return d.getTime();
    };
    const nextDay = (ms: number) => {
      const d = new Date(ms);
      d.setDate(d.getDate() + 1);
      return d.getTime();
    };
    const lastDay = dayStart(sorted[sorted.length - 1].t);
    // Un nodo cada ~0.15 s (acotado por presupuesto en vaults grandes) y ~0.5 s
    // de pausa al cambiar de fecha o en una fecha sin nodos.
    const NODE_MS = Math.min(200, Math.max(80, Math.round(24_000 / sorted.length)));
    const DAY_PAUSE_MS = 500;

    // Secuencia de pasos {count,label,delay}: recorre día a día (sin saltear los
    // vacíos) y dentro de cada día revela los nodos de a uno.
    const steps: { count: number; label: string; delay: number }[] = [];
    let count = 0;
    let i = 0;
    for (let dayMs = dayStart(sorted[0].t); dayMs <= lastDay; dayMs = nextDay(dayMs)) {
      const label = fmtDay(dayMs);
      const limit = nextDay(dayMs);
      const firstOfDay = i;
      while (i < sorted.length && sorted[i].t < limit) i++;
      const inDay = i - firstOfDay;
      if (inDay === 0) {
        steps.push({ count, label, delay: DAY_PAUSE_MS }); // día vacío: solo etiqueta
      } else {
        for (let k = 0; k < inDay; k++) {
          count++;
          const isLast = k === inDay - 1;
          steps.push({ count, label, delay: isLast ? DAY_PAUSE_MS : NODE_MS });
        }
      }
    }

    let s = 0;
    const play = () => {
      if (s >= steps.length) {
        timer.current = setTimeout(() => setTimelapse(null), 1000); // al terminar, mostrar todo
        return;
      }
      const step = steps[s++];
      setTimelapse({ count: step.count, label: step.label });
      timer.current = setTimeout(play, step.delay);
    };
    play();
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
          revealCount={timelapse?.count ?? null}
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
