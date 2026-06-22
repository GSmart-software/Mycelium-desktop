"use client";

import { useEffect, useRef } from "react";
import { usePreferencesStore } from "@/stores/preferencesStore";

export type GraphNode = { id: string; titulo: string; conexiones: number };
export type GraphEdge = { source: string; target: string };

type SimNode = GraphNode & { x: number; y: number; vx: number; vy: number };
type SimEdge = { s: SimNode; t: SimNode };

/**
 * Mini-grafo force-directed en canvas (HU-30 CA2-CA5), portado de
 * `legacy/js/graph.js`. El nodo central (`centerId`) se resalta; el radio de
 * cada nodo es proporcional a su total de conexiones en el vault (CA3) y las
 * aristas usan curvas bezier suaves estilo Obsidian (CA4). Clic en un nodo →
 * `onOpen(id)` (CA5). Reutilizado por el grafo global del rail.
 */
export type GraphView = { scale: number; ox: number; oy: number };

export function MiniGraph({
  nodes,
  edges,
  centerId,
  onOpen,
  initialPositions,
  onPositions,
  getInitialView,
  onView,
}: {
  nodes: GraphNode[];
  edges: GraphEdge[];
  centerId: string | null;
  onOpen: (id: string) => void;
  /** Posiciones cacheadas por id: arrancar asentado en vez de re-simular desde cero. */
  initialPositions?: Record<string, { x: number; y: number }>;
  /** Devuelve las posiciones actuales al desmontar/recalcular, para cachearlas. */
  onPositions?: (positions: Record<string, { x: number; y: number }>) => void;
  /** Getter de la vista (zoom/pan) cacheada — se lee al (re)iniciar la simulación. */
  getInitialView?: () => GraphView;
  /** Guarda la vista actual al desmontar/recalcular, para conservar el zoom. */
  onView?: (view: GraphView) => void;
}) {
  // Si está activo, la simulación corre en cada frame de forma continua (sin
  // reposo). Por defecto false: el grafo se bloquea al asentarse (ahorra CPU).
  const continuousSim = usePreferencesStore((s) => s.prefs.graphContinuousSim);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Las callbacks/datos viven en refs para no reiniciar la simulación en cada render.
  const onOpenRef = useRef(onOpen);
  onOpenRef.current = onOpen;
  const initialPosRef = useRef(initialPositions);
  initialPosRef.current = initialPositions;
  const onPositionsRef = useRef(onPositions);
  onPositionsRef.current = onPositions;
  const getInitialViewRef = useRef(getInitialView);
  getInitialViewRef.current = getInitialView;
  const onViewRef = useRef(onView);
  onViewRef.current = onView;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // El grafo se dibuja sobre un lienzo oscuro (estilo Obsidian) en cualquier
    // tema; los nodos usan el glow del tema y las etiquetas un gris claro.
    const styles = getComputedStyle(canvas);
    const colGlow = styles.getPropertyValue("--mic-glow").trim() || "#5DCAA5";
    const colNode = colGlow;
    const colCenter = "#eafff8";
    // Segundo color: nodos que REFERENCIAN al nodo en foco (centro u hover).
    const colAccent = styles.getPropertyValue("--mic-accent").trim() || "#19E6FF";
    const colEdge = "rgba(160, 224, 208, 0.22)";
    const colEdgeLit = colGlow;
    const colText = "rgba(206, 232, 224, 0.82)";
    const colText2 = "rgba(245, 255, 252, 0.96)";

    const N = nodes.length;
    const saved = initialPosRef.current;
    let savedCount = 0;
    const sim: SimNode[] = nodes.map((n, i) => {
      const cached = saved?.[n.id];
      if (cached && n.id !== centerId) {
        savedCount++;
        return { ...n, x: cached.x, y: cached.y, vx: 0, vy: 0 };
      }
      const a = (i / Math.max(N, 1)) * Math.PI * 2;
      const r = n.id === centerId ? 0 : 50 + Math.random() * 90;
      return { ...n, x: Math.cos(a) * r, y: Math.sin(a) * r, vx: 0, vy: 0 };
    });
    // Si casi todos los nodos vienen del cache, arrancar con poca energía para
    // que el grafo aparezca ya asentado; si hay nodos nuevos, algo más para
    // integrarlos suavemente; si todo es nuevo, simulación completa.
    const cachedRatio = N > 0 ? savedCount / N : 0;
    const initialAlpha = cachedRatio >= 0.999 ? 0.05 : cachedRatio > 0 ? 0.4 : 1;
    const byId = new Map(sim.map((n) => [n.id, n]));
    const simEdges: SimEdge[] = [];
    for (const e of edges) {
      const s = byId.get(e.source);
      const t = byId.get(e.target);
      if (s && t) simEdges.push({ s, t });
    }

    // Nodo en foco (centro fijo del panel, o el que está bajo el cursor) y el
    // conjunto de nodos que LO referencian (aristas nodo→foco), para pintarlos
    // con --mic-accent. Se recalcula solo al cambiar el foco (no por frame).
    const centerNode = centerId ? byId.get(centerId) ?? null : null;
    let focusRefs = new Set<string>();
    const computeRefs = (focus: SimNode | null) => {
      const next = new Set<string>();
      if (focus) for (const e of simEdges) if (e.t === focus) next.add(e.s.id);
      focusRefs = next;
    };
    computeRefs(centerNode);

    // Zoom/pan restaurados de la cache (se leen aquí, tras el cleanup previo que
    // los guardó), para que agregar un nodo no resetee la vista a la de por defecto.
    const v0 = getInitialViewRef.current?.();
    let scale = v0?.scale ?? 1;
    let ox = v0?.ox ?? 0;
    let oy = v0?.oy ?? 0;
    let hover: SimNode | null = null;
    let dragNode: SimNode | null = null;
    let panning = false;
    let downAt: { x: number; y: number } | null = null;
    let alpha = initialAlpha;
    let dpr = window.devicePixelRatio || 1;
    let running = true;
    // Reposo: cuando el grafo se asienta (alpha bajo y sin interacción) se deja
    // de simular/redibujar para no consumir CPU con muchos nodos. Cualquier
    // interacción (drag, hover, zoom, resize) lo despierta. `frame` = rAF pendiente.
    // Si `continuousSim`, nunca se bloquea (corre en cada frame). Tras asentarse
    // sigue simulando IDLE_GRACE_MS antes de bloquearse.
    const REST = 0.03;
    const IDLE_GRACE_MS = 5000;
    let frame = 0;
    let lastEnergetic = performance.now();
    const wake = () => {
      if (running && frame === 0) frame = requestAnimationFrame(tick);
    };

    const radius = (n: SimNode) => {
      const base = Math.min(4 + n.conexiones * 1.6, 15);
      return n.id === centerId ? base + 3 : base;
    };

    const resize = () => {
      const parent = canvas.parentElement;
      if (!parent) return;
      dpr = window.devicePixelRatio || 1;
      canvas.width = parent.clientWidth * dpr;
      canvas.height = parent.clientHeight * dpr;
      canvas.style.width = `${parent.clientWidth}px`;
      canvas.style.height = `${parent.clientHeight}px`;
      alpha = Math.max(alpha, 0.3);
      wake();
    };

    const toWorld = (ev: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      return {
        x: (ev.clientX - rect.left - rect.width / 2 - ox) / scale,
        y: (ev.clientY - rect.top - rect.height / 2 - oy) / scale,
      };
    };

    const pick = (ev: MouseEvent) => {
      const p = toWorld(ev);
      let best: SimNode | null = null;
      let bestD = 14 / scale;
      for (const n of sim) {
        const d = Math.hypot(n.x - p.x, n.y - p.y);
        if (d < bestD + radius(n)) {
          best = n;
          bestD = d;
        }
      }
      return best;
    };

    const onMouseDown = (ev: MouseEvent) => {
      const n = pick(ev);
      downAt = { x: ev.clientX, y: ev.clientY };
      if (n) {
        dragNode = n;
        alpha = Math.max(alpha, 0.4);
      } else {
        panning = true;
      }
      wake();
    };
    const onMouseMove = (ev: MouseEvent) => {
      if (dragNode) {
        const p = toWorld(ev);
        dragNode.x = p.x;
        dragNode.y = p.y;
        dragNode.vx = 0;
        dragNode.vy = 0;
        alpha = Math.max(alpha, 0.4);
        wake();
      } else if (panning) {
        ox += ev.movementX;
        oy += ev.movementY;
        wake();
      } else {
        const n = pick(ev);
        if (n !== hover) {
          hover = n;
          computeRefs(hover ?? centerNode); // foco = hover, o el centro si no hay
          canvas.style.cursor = n ? "pointer" : "grab";
          wake(); // un redibujo para el resaltado de hover
        }
      }
    };
    const onMouseUp = (ev: MouseEvent) => {
      const moved =
        downAt && Math.hypot(ev.clientX - downAt.x, ev.clientY - downAt.y) > 4;
      if (dragNode && !moved) onOpenRef.current(dragNode.id);
      dragNode = null;
      panning = false;
      downAt = null;
    };
    const onWheel = (ev: WheelEvent) => {
      ev.preventDefault();
      const factor = ev.deltaY < 0 ? 1.12 : 1 / 1.12;
      const rect = canvas.getBoundingClientRect();
      const mx = ev.clientX - rect.left - rect.width / 2;
      const my = ev.clientY - rect.top - rect.height / 2;
      ox = mx - (mx - ox) * factor;
      oy = my - (my - oy) * factor;
      scale = Math.min(Math.max(scale * factor, 0.3), 4);
      wake(); // un redibujo para reflejar el zoom
    };

    canvas.addEventListener("mousedown", onMouseDown);
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    canvas.addEventListener("wheel", onWheel, { passive: false });
    const ro = new ResizeObserver(resize);
    ro.observe(canvas.parentElement ?? canvas);

    const simulate = () => {
      const k = 80;
      for (let i = 0; i < sim.length; i++) {
        const a = sim[i];
        for (let j = i + 1; j < sim.length; j++) {
          const b = sim[j];
          let dx = a.x - b.x;
          let dy = a.y - b.y;
          let d2 = dx * dx + dy * dy;
          if (d2 < 1) {
            dx = Math.random() - 0.5;
            dy = Math.random() - 0.5;
            d2 = 1;
          }
          const d = Math.sqrt(d2);
          const f = Math.min((k * k) / d2, 8) * alpha;
          a.vx += (dx / d) * f;
          a.vy += (dy / d) * f;
          b.vx -= (dx / d) * f;
          b.vy -= (dy / d) * f;
        }
      }
      for (const e of simEdges) {
        const dx = e.t.x - e.s.x;
        const dy = e.t.y - e.s.y;
        const d = Math.max(Math.hypot(dx, dy), 1);
        const f = ((d - k) / d) * 0.02 * alpha * 10;
        e.s.vx += dx * f * 0.05;
        e.s.vy += dy * f * 0.05;
        e.t.vx -= dx * f * 0.05;
        e.t.vy -= dy * f * 0.05;
      }
      for (const n of sim) {
        n.vx -= n.x * 0.004 * alpha;
        n.vy -= n.y * 0.004 * alpha;
        if (n === dragNode) continue;
        // El nodo central tira hacia el origen para quedar al medio.
        if (n.id === centerId) {
          n.vx -= n.x * 0.05;
          n.vy -= n.y * 0.05;
        }
        n.vx *= 0.85;
        n.vy *= 0.85;
        n.x += n.vx;
        n.y += n.vy;
      }
      alpha = Math.max(alpha * 0.995, 0.02);
    };

    const draw = () => {
      const w = canvas.width;
      const h = canvas.height;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, w, h);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.translate(w / (2 * dpr) + ox, h / (2 * dpr) + oy);
      ctx.scale(scale, scale);

      // Aristas con curva bezier suave (CA4)
      for (const e of simEdges) {
        const lit = hover && (e.s === hover || e.t === hover);
        ctx.strokeStyle = lit ? colEdgeLit : colEdge;
        ctx.globalAlpha = 1;
        ctx.lineWidth = (lit ? 1.8 : 1.1) / scale;
        const mx = (e.s.x + e.t.x) / 2;
        const my = (e.s.y + e.t.y) / 2;
        // Desplazamiento perpendicular para curvar la línea
        const nx = -(e.t.y - e.s.y);
        const ny = e.t.x - e.s.x;
        const len = Math.max(Math.hypot(nx, ny), 1);
        const bend = 0.12;
        const cx = mx + (nx / len) * len * bend;
        const cy = my + (ny / len) * len * bend;
        ctx.beginPath();
        ctx.moveTo(e.s.x, e.s.y);
        ctx.quadraticCurveTo(cx, cy, e.t.x, e.t.y);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;

      for (const n of sim) {
        const r = radius(n);
        // Blanco: el nodo central y el que está bajo el cursor. Accent: los que
        // referencian al nodo en foco (foco = hover, o el centro si no hay hover).
        const isWhite = n.id === centerId || n === hover;
        const refsFocus = !isWhite && focusRefs.has(n.id);
        ctx.shadowColor = refsFocus ? colAccent : colGlow;
        ctx.shadowBlur = isWhite ? 22 : refsFocus ? 16 : 12;
        ctx.fillStyle = isWhite ? colCenter : refsFocus ? colAccent : colNode;
        ctx.beginPath();
        ctx.arc(n.x, n.y, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
      }

      const showAll = scale > 0.5;
      ctx.textAlign = "center";
      ctx.font = `${12 / scale}px var(--mic-font-sans, sans-serif)`;
      for (const n of sim) {
        if (!showAll && n !== hover && n.id !== centerId) continue;
        ctx.fillStyle = n === hover || n.id === centerId ? colText2 : colText;
        ctx.fillText(n.titulo, n.x, n.y + radius(n) + 13 / scale);
      }
    };

    const tick = () => {
      frame = 0;
      if (!running || !canvas.isConnected) return;
      const now = performance.now();
      const interacting = !!dragNode || panning;
      // Mientras haya energía o interacción, se reinicia el contador de reposo.
      if (interacting || alpha > REST) lastEnergetic = now;
      // Bloqueo (por defecto): tras asentarse y pasar el período de gracia, se
      // detiene. Con `continuousSim` el bloqueo está desactivado: nunca para.
      const idle = !continuousSim && now - lastEnergetic > IDLE_GRACE_MS;
      const active = !idle;
      if (active) simulate();
      draw();
      // Sigue animando salvo que esté en reposo; entonces queda detenido (sin
      // rAF) hasta que algo lo despierte con wake().
      if (active) frame = requestAnimationFrame(tick);
    };
    resize(); // dimensiona el canvas antes del primer frame
    wake();

    return () => {
      running = false;
      if (frame) cancelAnimationFrame(frame);
      // Guardar el layout actual para que el próximo montaje (cambio de pestaña)
      // o recálculo (datos nuevos) arranque asentado, sin re-simular desde cero.
      const positions: Record<string, { x: number; y: number }> = {};
      for (const n of sim) positions[n.id] = { x: n.x, y: n.y };
      onPositionsRef.current?.(positions);
      // Conservar el zoom/pan para el próximo (re)montaje o recálculo.
      onViewRef.current?.({ scale, ox, oy });

      canvas.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
      canvas.removeEventListener("wheel", onWheel);
      ro.disconnect();
    };
  }, [nodes, edges, centerId, continuousSim]);

  return <canvas ref={canvasRef} style={{ display: "block", width: "100%", height: "100%" }} />;
}
