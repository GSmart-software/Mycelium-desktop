"use client";

import { useEffect, useRef } from "react";
import { usePreferencesStore } from "@/stores/preferencesStore";
import { type DisposicionGrafo, usePrefVault } from "@/stores/prefsVaultStore";
import {
  type GrafoIndexado,
  type LayoutAnillo,
  hubsDe,
  indexarGrafo,
  layoutAnillo,
  layoutCrecimiento,
  limitesDe,
  siembraSustrato,
} from "./disposiciones";
import {
  type Camara,
  type EscenaMicelio,
  type FocoMicelio,
  type PaletaMicelio,
  conAlpha,
  dibujarCapaEstatica,
  dibujarSobrecapa,
} from "./hifas";

export type GraphNode = {
  id: string;
  titulo: string;
  conexiones: number;
  tags?: string[];
  creadoEn?: string;
  /** Ruta de la carpeta con `/` (vacía = raíz). La usa el anillo de colonias (`FUN-L-23`). */
  carpeta?: string;
};
export type GraphEdge = { source: string; target: string };

/** `r` = radio del nodo, precalculado (depende solo de `conexiones` y del centro). */
type SimNode = GraphNode & { x: number; y: number; vx: number; vy: number; r: number };
type SimEdge = { s: SimNode; t: SimNode };

/**
 * Caché de "sprites" de nodo: un canvas offscreen con el círculo y su glow ya
 * rasterizados. Dibujar `shadowBlur` por nodo y por frame es de lo más caro del
 * canvas 2D (cada `fill()` obliga a un blur gaussiano); con el sprite el blur se
 * calcula UNA vez por combinación y luego solo se hace `drawImage`.
 *
 * El sprite se genera en píxeles REALES de pantalla (radio × scale × dpr) porque
 * `shadowBlur` no se escala con la transformación del contexto: así el resultado
 * es visualmente idéntico al dibujo directo, a cualquier zoom, y sin resampleo.
 */
type SpriteKey = string;
const spriteCache = new Map<SpriteKey, HTMLCanvasElement>();
/** Techo del caché: el zoom continuo genera radios nuevos; evita crecer sin fin. */
const SPRITE_CACHE_MAX = 400;

function nodeSprite(
  fill: string,
  shadow: string,
  rPix: number,
  blurPix: number,
): HTMLCanvasElement {
  const key: SpriteKey = `${fill}|${shadow}|${rPix}|${blurPix}`;
  const hit = spriteCache.get(key);
  if (hit) return hit;
  if (spriteCache.size > SPRITE_CACHE_MAX) spriteCache.clear();

  const lado = Math.ceil(2 * (rPix + blurPix) + 2);
  const c = document.createElement("canvas");
  c.width = lado;
  c.height = lado;
  const cx = c.getContext("2d");
  if (cx) {
    const centro = lado / 2;
    cx.shadowColor = shadow;
    cx.shadowBlur = blurPix;
    cx.fillStyle = fill;
    cx.beginPath();
    cx.arc(centro, centro, rPix, 0, Math.PI * 2);
    cx.fill();
  }
  spriteCache.set(key, c);
  return c;
}

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
  nodeColors,
  revealCount,
  disposicion: disposicionProp,
}: {
  nodes: GraphNode[];
  edges: GraphEdge[];
  centerId: string | null;
  onOpen: (id: string) => void;
  /**
   * Cómo se disponen los nodos (`FUN-L-23`). Sin indicar = `cumulo`, la
   * simulación de fuerzas de siempre; es lo que usa el mini-grafo del panel.
   * Las otras tres se dibujan como micelio (`hifas.ts`) sobre una capa estática.
   */
  disposicion?: DisposicionGrafo;
  /** Color por id según los grupos de color del usuario (sobrescribe el glow). */
  nodeColors?: Map<string, string>;
  /** Construcción temporal: solo se dibujan los primeros `revealCount` nodos en
   *  orden de creación (y sus aristas). `null`/`undefined` = mostrar todo. */
  revealCount?: number | null;
  /** Posiciones cacheadas por id: arrancar asentado en vez de re-simular desde cero. */
  initialPositions?: Record<string, { x: number; y: number }>;
  /** Devuelve las posiciones actuales al desmontar/recalcular, para cachearlas. */
  onPositions?: (positions: Record<string, { x: number; y: number }>) => void;
  /** Getter de la vista (zoom/pan) cacheada — se lee al (re)iniciar la simulación.
   *  `undefined` = todavía no hay: las disposiciones micelio encuadran el grafo. */
  getInitialView?: () => GraphView | undefined;
  /** Guarda la vista actual al desmontar/recalcular, para conservar el zoom. */
  onView?: (view: GraphView) => void;
}) {
  // Si está activo, la simulación corre en cada frame de forma continua (sin
  // reposo). Por defecto false: el grafo se bloquea al asentarse (ahorra CPU).
  const continuousSim = usePreferencesStore((s) => s.prefs.graphContinuousSim);
  // Tema activo (DEF-030): los colores del grafo (--mic-glow/--mic-accent) se leen
  // con getComputedStyle dentro del efecto de simulación. Al cambiar el tema hay
  // que re-ejecutarlo para recolorear (reutiliza las posiciones cacheadas, así el
  // layout se conserva). Sin esto había que cerrar y reabrir el grafo.
  const tema = usePreferencesStore((s) => s.tema);
  const modoOscuro = usePreferencesStore((s) => s.modoOscuro);
  // Indicador de dirección y brillo de hover: en refs para NO reiniciar la
  // simulación (ni relayoutear) al cambiarlos. Un efecto aparte despierta el
  // bucle cuando cambian (para arrancar la animación o redibujar).
  const edgeDirection = usePreferencesStore((s) => s.prefs.graphEdgeDirection);
  const hoverGlow = usePreferencesStore((s) => s.prefs.graphHoverGlow);
  const edgeDirectionRef = useRef(edgeDirection);
  edgeDirectionRef.current = edgeDirection;
  const hoverGlowRef = useRef(hoverGlow);
  hoverGlowRef.current = hoverGlow;
  // Cuántos nombres se dibujan (`FUN-M-21`). Va por ref y no por dependencia del
  // efecto: cambiarlo tiene que repintar, no reconstruir la simulación —eso
  // reacomodaría todos los nodos y perdería el zoom y el desplazamiento—.
  const modoNombres = usePrefVault("nombresGrafo");
  const modoNombresRef = useRef(modoNombres);
  modoNombresRef.current = modoNombres;
  const nodeColorsRef = useRef(nodeColors);
  nodeColorsRef.current = nodeColors;
  const revealCountRef = useRef(revealCount);
  revealCountRef.current = revealCount;
  const wakeRef = useRef<(() => void) | null>(null);
  useEffect(() => {
    wakeRef.current?.();
  }, [edgeDirection, hoverGlow, nodeColors, revealCount, modoNombres]);
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
  const disposicion: DisposicionGrafo = disposicionProp ?? "cumulo";

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Las callbacks de guardado se capturan AHORA y no en el cleanup: al cambiar
    // de disposición, la ref ya apunta a la callback de la disposición nueva
    // cuando corre el cleanup de la vieja, y guardaría el layout del cúmulo
    // bajo la clave del anillo (y su vista, que entonces no se encuadraría).
    const guardarPosiciones = onPositionsRef.current;
    const guardarVista = onViewRef.current;

    // ── Disposición (`FUN-L-23`). `micelio` = las tres nuevas, que se dibujan
    //    con `hifas.ts` sobre una capa estática; `fisica` = las que simulan
    //    (cúmulo y sustrato). El cúmulo sigue su camino de siempre. ──
    const micelio = disposicion !== "cumulo";
    const fisica = disposicion === "cumulo" || disposicion === "sustrato";

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
    // La fuente de las etiquetas se lee COMPUTADA del canvas (hereda la de body,
    // `var(--mic-font-sans)`): `ctx.font` no resuelve variables CSS, así que
    // pasarle `var(--mic-font-sans)` hacía que cayera siempre al sans-serif del
    // sistema en vez de la tipografía de Mycelium.
    const fontFamily = styles.fontFamily || "system-ui, sans-serif";

    const N = nodes.length;
    const saved = initialPosRef.current;
    let savedCount = 0;
    // Radio del nodo: solo depende de sus conexiones y de si es el centro, así que
    // se calcula UNA vez aquí (antes se recalculaba en cada frame, dos veces por
    // nodo: en el dibujo de nodos y en el de etiquetas).
    const radioDe = (n: GraphNode) => {
      const base = Math.min(4 + n.conexiones * 1.6, 15);
      // En las disposiciones micelio hay muchos más nodos en pantalla que en el
      // mini-grafo para el que se calibró la fórmula: la mitad.
      if (micelio) return base / 2;
      return n.id === centerId ? base + 3 : base;
    };
    // Layout de las disposiciones micelio: el anillo y el crecimiento son
    // deterministas y se recalculan acá (milisegundos); el sustrato solo toma la
    // siembra inicial y después simula como el cúmulo, con su caché.
    const g: GrafoIndexado | null = micelio ? indexarGrafo(nodes, edges) : null;
    let anillo: LayoutAnillo | null = null;
    let posMicelio: Float64Array | null = null;
    if (g) {
      if (disposicion === "anillo") {
        anillo = layoutAnillo(g);
        posMicelio = anillo.pos;
      } else if (disposicion === "crecimiento") {
        posMicelio = layoutCrecimiento(g).pos;
      } else {
        posMicelio = siembraSustrato(g);
      }
    }
    const sim: SimNode[] = nodes.map((n, i) => {
      const cached = saved?.[n.id];
      if (cached && n.id !== centerId && fisica) {
        savedCount++;
        return { ...n, x: cached.x, y: cached.y, vx: 0, vy: 0, r: radioDe(n) };
      }
      if (posMicelio) {
        return { ...n, x: posMicelio[i * 2], y: posMicelio[i * 2 + 1], vx: 0, vy: 0, r: radioDe(n) };
      }
      const a = (i / Math.max(N, 1)) * Math.PI * 2;
      const r = n.id === centerId ? 0 : 50 + Math.random() * 90;
      return { ...n, x: Math.cos(a) * r, y: Math.sin(a) * r, vx: 0, vy: 0, r: radioDe(n) };
    });
    // Si casi todos los nodos vienen del cache, arrancar con poca energía para
    // que el grafo aparezca ya asentado; si hay nodos nuevos, algo más para
    // integrarlos suavemente; si todo es nuevo, simulación completa.
    const cachedRatio = N > 0 ? savedCount / N : 0;
    const initialAlpha = cachedRatio >= 0.999 ? 0.05 : cachedRatio > 0 ? 0.4 : 1;
    const byId = new Map(sim.map((n) => [n.id, n]));
    // Rango de aparición por id: orden de creación (creadoEn, desempate por id
    // para coincidir con el orden que usa GraphView al contar). Permite revelar
    // los nodos de a uno aunque compartan la misma fecha.
    // En las disposiciones micelio manda el orden del índice (`g.rango`): es el
    // mismo que usa el layout de crecimiento, y pone las notas sin fecha al
    // final en vez de al principio.
    const rankById = g
      ? new Map(g.ids.map((id, i) => [id, g.rango[i]] as const))
      : new Map(
          nodes
            .map((n) => ({ id: n.id, t: n.creadoEn ? Date.parse(n.creadoEn) : 0 }))
            .sort((a, b) => a.t - b.t || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
            .map((o, i) => [o.id, i] as const),
        );
    // ¿El nodo ya "apareció"? Se muestran los primeros `revealCount` en orden de
    // creación (null = mostrar todo).
    const revealed = (n: SimNode) => {
      const rc = revealCountRef.current;
      return rc == null || (rankById.get(n.id) ?? 0) < rc;
    };
    const simEdges: SimEdge[] = [];
    for (const e of edges) {
      const s = byId.get(e.source);
      const t = byId.get(e.target);
      if (s && t) simEdges.push({ s, t });
    }

    // ── Construcción temporal: el grafo CRECE. Solo los nodos ya "aparecidos"
    //    participan en la simulación; al aparecer, cada nodo se coloca cerca de
    //    sus vecinos ya presentes y el layout se readapta (estilo Obsidian). ──
    const orderedSim = [...sim].sort(
      (a, b) => (rankById.get(a.id) ?? 0) - (rankById.get(b.id) ?? 0),
    );
    const neighborsById = new Map<string, SimNode[]>();
    const addNbr = (a: SimNode, b: SimNode) => {
      const arr = neighborsById.get(a.id);
      if (arr) arr.push(b);
      else neighborsById.set(a.id, [b]);
    };
    for (const e of simEdges) {
      addNbr(e.s, e.t);
      addNbr(e.t, e.s);
    }
    const activated = new Set<string>();
    // Coloca un nodo que recién aparece cerca del centroide de sus vecinos ya
    // presentes (o cerca del origen si aún no tiene vecinos visibles).
    const placeNew = (n: SimNode) => {
      const nbrs = (neighborsById.get(n.id) ?? []).filter((m) => activated.has(m.id));
      if (nbrs.length > 0) {
        let sx = 0;
        let sy = 0;
        for (const m of nbrs) {
          sx += m.x;
          sy += m.y;
        }
        n.x = sx / nbrs.length + (Math.random() - 0.5) * 24;
        n.y = sy / nbrs.length + (Math.random() - 0.5) * 24;
      } else {
        const ang = Math.random() * Math.PI * 2;
        const rad = 16 + Math.random() * 28;
        n.x = Math.cos(ang) * rad;
        n.y = Math.sin(ang) * rad;
      }
      n.vx = 0;
      n.vy = 0;
      activated.add(n.id);
    };
    let prevRc: number | null = null;

    // Nodo en foco (centro fijo del panel, o el que está bajo el cursor) y el
    // conjunto de nodos que LO referencian (aristas nodo→foco), para pintarlos
    // con --mic-accent. Se recalcula solo al cambiar el foco (no por frame).
    const centerNode = centerId ? byId.get(centerId) ?? null : null;
    let focusRefs = new Set<string>();
    // Los vecinos del foco, en las DOS direcciones (`FUN-M-21`). `focusRefs` no
    // sirve para esto: guarda solo quién apunta al foco, porque su trabajo es
    // colorear las entrantes. «Vecino» acá es cualquiera con el que conecte.
    let vecinos = new Set<string>();
    const computeRefs = (focus: SimNode | null) => {
      const next = new Set<string>();
      const cerca = new Set<string>();
      if (focus) {
        for (const e of simEdges) {
          if (e.t === focus) {
            next.add(e.s.id);
            cerca.add(e.s.id);
          } else if (e.s === focus) {
            cerca.add(e.t.id);
          }
        }
      }
      focusRefs = next;
      vecinos = cerca;
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
    /** Nodo pulsado en las disposiciones sin arrastre (anillo, crecimiento): clic = abrir. */
    let clickNode: SimNode | null = null;
    let panning = false;
    // Capa estática (las disposiciones micelio y, desde `FUN-L-25`, también el
    // cúmulo): se vuelve a pintar solo cuando algo la ensucia (vista, tamaño,
    // nodos que se mueven, el foco, lo revelado, colores u opciones).
    let sucioEstatico = true;
    const ensuciar = () => {
      sucioEstatico = true;
    };
    // Sin vista cacheada, la disposición micelio se encuadra en cuanto el lienzo
    // tenga tamaño (la primera vez que se elige; después recuerda su vista).
    let encuadrePendiente = micelio && !v0;
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
      if (running && frame === 0) frame = requestAnimationFrame(micelio ? tickMicelio : tick);
    };
    // Permite despertar el bucle al cambiar las opciones. Además ensucia la capa
    // estática: los colores, los nombres, lo revelado y la flecha viven ahí.
    const despertar = () => {
      ensuciar();
      wake();
    };
    wakeRef.current = despertar;

    // Movimiento reducido: el flujo animado de las aristas es un bucle infinito
    // que no se detiene nunca. Con la preferencia del sistema activa se dibuja
    // como FLECHA —conserva la dirección, que es lo que el flujo comunica— y el
    // bucle se detiene. Se escucha en vivo: cambiarla en Windows alcanza.
    const movimiento = window.matchMedia("(prefers-reduced-motion: reduce)");
    let reducido = movimiento.matches;
    const alCambiarMovimiento = () => {
      reducido = movimiento.matches;
      despertar(); // la flecha que reemplaza al flujo se pinta en la capa
    };
    movimiento.addEventListener("change", alCambiarMovimiento);

    // Un grafo que no se ve no anima: el mini-grafo del panel lateral queda
    // montado aunque su pestaña esté oculta, y con el flujo animado (que viene
    // por defecto) redibujaba a 60 fps sin que nadie lo mirara. La simulación
    // sí sigue hasta asentarse, para que al volver el grafo esté quieto.
    let visible = true;
    // Las entradas llegan en lote y en orden: la vigente es la ÚLTIMA. Al montar
    // suelen venir dos —«oculto» cuando el lienzo aún mide 0, y «visible» tras
    // dimensionarlo— y quedarse con la primera dejaba el flujo detenido.
    const observador = new IntersectionObserver((entradas) => {
      visible = entradas[entradas.length - 1].isIntersecting;
      if (visible) wake();
    });
    observador.observe(canvas);

    const resize = () => {
      const parent = canvas.parentElement;
      if (!parent) return;
      dpr = window.devicePixelRatio || 1;
      canvas.width = parent.clientWidth * dpr;
      canvas.height = parent.clientHeight * dpr;
      canvas.style.width = `${parent.clientWidth}px`;
      canvas.style.height = `${parent.clientHeight}px`;
      alpha = Math.max(alpha, 0.3);
      if (micelio) {
        estatico.width = canvas.width;
        estatico.height = canvas.height;
        if (encuadrePendiente && parent.clientWidth > 0 && parent.clientHeight > 0) {
          recentrar();
          encuadrePendiente = false;
        }
      } else {
        capaAristas.width = capaNodos.width = canvas.width;
        capaAristas.height = capaNodos.height = canvas.height;
      }
      ensuciar();
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
        if (!revealed(n)) continue; // no se puede apuntar un nodo aún invisible
        // Comparación al cuadrado: evita una raíz cuadrada por nodo y por
        // `mousemove` (este bucle corre en cada movimiento del ratón).
        const dx = n.x - p.x;
        const dy = n.y - p.y;
        const umbral = bestD + n.r;
        if (dx * dx + dy * dy < umbral * umbral) {
          best = n;
          bestD = Math.sqrt(dx * dx + dy * dy);
        }
      }
      return best;
    };

    const onMouseDown = (ev: MouseEvent) => {
      const n = pick(ev);
      downAt = { x: ev.clientX, y: ev.clientY };
      if (n) {
        // Arrastrar un nodo solo tiene sentido donde hay física; en el anillo y
        // el crecimiento la posición es determinista y pulsar es solo abrir.
        if (fisica) {
          dragNode = n;
          alpha = Math.max(alpha, 0.4);
        } else {
          clickNode = n;
        }
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
        ensuciar();
        wake();
      } else {
        const n = pick(ev);
        if (n !== hover) {
          hover = n;
          computeRefs(hover ?? centerNode); // foco = hover, o el centro si no hay
          canvas.style.cursor = n ? "pointer" : "grab";
          // Un redibujo para el resaltado de hover. En el cúmulo el resaltado
          // vive en la capa estática; en micelio va en la sobrecapa.
          if (!micelio) ensuciar();
          wake();
        }
      }
    };
    const onMouseUp = (ev: MouseEvent) => {
      const moved =
        downAt && Math.hypot(ev.clientX - downAt.x, ev.clientY - downAt.y) > 4;
      const pulsado = dragNode ?? clickNode;
      if (pulsado && !moved) onOpenRef.current(pulsado.id);
      dragNode = null;
      clickNode = null;
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
      // DEF-038: mínimo bajo (0.05) para poder alejar y ver completo un grafo con
      // muchos nodos; el 0.3 anterior no dejaba abarcarlo entero.
      scale = Math.min(Math.max(scale * factor, 0.05), 4);
      ensuciar();
      wake(); // un redibujo para reflejar el zoom
    };

    canvas.addEventListener("mousedown", onMouseDown);
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    canvas.addEventListener("wheel", onWheel, { passive: false });
    const ro = new ResizeObserver(resize);
    ro.observe(canvas.parentElement ?? canvas);

    // Constantes del motor. El sustrato (`FUN-L-23`) usa la MISMA simulación
    // con repulsión y reposo más cortos (k = 45), fuerza al 70 % y tope 6: la
    // colonia queda apretada y las hifas, cortas. El cúmulo conserva sus valores.
    const k = disposicion === "sustrato" ? 45 : 80;
    const topeRepulsion = disposicion === "sustrato" ? 6 : 8;
    const factorRepulsion = disposicion === "sustrato" ? 0.7 : 1;

    const simulate = () => {
      // En construcción temporal solo simulan los nodos ya aparecidos, así el
      // grafo se reacomoda mientras crece (en vez de estar todo prefijado).
      const tl = revealCountRef.current != null;
      const active = tl ? sim.filter((n) => activated.has(n.id)) : sim;
      for (let i = 0; i < active.length; i++) {
        const a = active[i];
        for (let j = i + 1; j < active.length; j++) {
          const b = active[j];
          let dx = a.x - b.x;
          let dy = a.y - b.y;
          let d2 = dx * dx + dy * dy;
          if (d2 < 1) {
            dx = Math.random() - 0.5;
            dy = Math.random() - 0.5;
            d2 = 1;
          }
          const d = Math.sqrt(d2);
          const f = Math.min((k * k) / d2, topeRepulsion) * factorRepulsion * alpha;
          a.vx += (dx / d) * f;
          a.vy += (dy / d) * f;
          b.vx -= (dx / d) * f;
          b.vy -= (dy / d) * f;
        }
      }
      for (const e of simEdges) {
        if (tl && (!activated.has(e.s.id) || !activated.has(e.t.id))) continue;
        const dx = e.t.x - e.s.x;
        const dy = e.t.y - e.s.y;
        const d = Math.max(Math.sqrt(dx * dx + dy * dy), 1); // sqrt < hypot en bucles
        const f = ((d - k) / d) * 0.02 * alpha * 10;
        e.s.vx += dx * f * 0.05;
        e.s.vy += dy * f * 0.05;
        e.t.vx -= dx * f * 0.05;
        e.t.vy -= dy * f * 0.05;
      }
      for (const n of active) {
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

    // ── Cúmulo con capa estática y reposo real (`FUN-L-25` · B1, `DEF-109`).
    //    Antes cada frame redibujaba el grafo entero, y con el flujo animado
    //    (que viene por defecto) eso era a 60 fps para siempre. Ahora lo quieto
    //    se pinta a DOS capas offscreen —debajo, las aristas; encima, flechas,
    //    nodos y nombres— que solo se repintan si algo las ensucia (la
    //    simulación movió nodos, cambió la vista, el foco, lo revelado o una
    //    opción). Cada frame es copiar la capa de aristas, el flujo encima y la
    //    capa de nodos: el mismo orden de siempre (el flujo pasa por debajo de
    //    los nodos y de las flechas). Sin flujo, en reposo no hay frame. ──
    const capaAristas = document.createElement("canvas");
    const capaNodos = document.createElement("canvas");
    const actx = capaAristas.getContext("2d");
    const nctx = capaNodos.getContext("2d");
    /** Geometría de las aristas visibles, para el flujo: `[sx, sy, cx, cy, tx, ty]` por arista. */
    let geoFlujo = new Float64Array(0);
    /** 1 = la arista toca el nodo apuntado (el flujo se resalta). */
    let litFlujo = new Uint8Array(0);
    let nFlujo = 0;
    /** ¿La última capa pintada lleva flujo animado encima? */
    let conFlujo = false;

    /** Transformación de la vista (mundo → píxeles) sobre un contexto. */
    const aplicarVista = (c: CanvasRenderingContext2D, w: number, h: number) => {
      c.setTransform(dpr, 0, 0, dpr, 0, 0);
      c.translate(w / (2 * dpr) + ox, h / (2 * dpr) + oy);
      c.scale(scale, scale);
    };

    const pintarCapas = () => {
      if (!actx || !nctx) return;
      const w = canvas.width;
      const h = canvas.height;
      actx.setTransform(1, 0, 0, 1, 0, 0);
      actx.clearRect(0, 0, w, h);
      aplicarVista(actx, w, h);
      nctx.setTransform(1, 0, 0, 1, 0, 0);
      nctx.clearRect(0, 0, w, h);
      aplicarVista(nctx, w, h);

      // ── Culling por viewport: rectángulo visible en coordenadas de MUNDO. Todo
      //    lo que cae fuera no se dibuja (nodos, aristas y etiquetas). El test es
      //    aritmética simple frente al costo de rasterizar, y no cambia nada de lo
      //    que se ve: con zoom alto evita pagar por lo que está fuera de pantalla.
      const cw = w / dpr;
      const ch = h / dpr;
      const margen = 40 / scale; // glow + etiqueta del nodo
      const visL = (-cw / 2 - ox) / scale - margen;
      const visR = (cw / 2 - ox) / scale + margen;
      const visT = (-ch / 2 - oy) / scale - margen;
      const visB = (ch / 2 - oy) / scale + margen;
      const dentro = (x: number, y: number) => x >= visL && x <= visR && y >= visT && y <= visB;

      // Aristas con curva bezier suave (CA4). Indicador de dirección (s→t):
      // flujo animado (dash en movimiento) y/o flecha al medio, según la opción.
      const dir = edgeDirectionRef.current;
      const showFlow = !reducido && (dir === "animated" || dir === "both");
      const showArrow = dir === "arrow" || dir === "both" || (reducido && dir === "animated");
      const glow = hoverGlowRef.current;
      if (geoFlujo.length < simEdges.length * 6) {
        geoFlujo = new Float64Array(simEdges.length * 6);
        litFlujo = new Uint8Array(simEdges.length);
      }
      nFlujo = 0;
      for (const e of simEdges) {
        if (!revealed(e.s) || !revealed(e.t)) continue; // aún no aparecieron
        // Culling: descartar la arista si su caja envolvente no toca la vista.
        if (
          Math.max(e.s.x, e.t.x) < visL ||
          Math.min(e.s.x, e.t.x) > visR ||
          Math.max(e.s.y, e.t.y) < visT ||
          Math.min(e.s.y, e.t.y) > visB
        ) {
          continue;
        }
        const lit = hover && (e.s === hover || e.t === hover);
        const mx = (e.s.x + e.t.x) / 2;
        const my = (e.s.y + e.t.y) / 2;
        const nx = -(e.t.y - e.s.y);
        const ny = e.t.x - e.s.x;
        const len = Math.max(Math.hypot(nx, ny), 1);
        const bend = 0.12;
        const cx = mx + (nx / len) * len * bend;
        const cy = my + (ny / len) * len * bend;

        // Línea base (capa de aristas). Al apuntar un nodo, sus enlaces brillan
        // con intensidad `glow` (ancho + halo); con glow=0 apenas se resaltan.
        actx.strokeStyle = lit ? colEdgeLit : colEdge;
        actx.lineWidth = (lit ? 1.2 + 0.9 * glow : 1.1) / scale;
        if (lit && glow > 0) {
          actx.shadowColor = colEdgeLit;
          actx.shadowBlur = (8 * glow) / scale;
        }
        actx.beginPath();
        actx.moveTo(e.s.x, e.s.y);
        actx.quadraticCurveTo(cx, cy, e.t.x, e.t.y);
        actx.stroke();
        actx.shadowBlur = 0;

        // El flujo se dibuja en cada frame sobre la capa: acá solo se guarda la
        // curva de las aristas visibles.
        const o = nFlujo * 6;
        geoFlujo[o] = e.s.x;
        geoFlujo[o + 1] = e.s.y;
        geoFlujo[o + 2] = cx;
        geoFlujo[o + 3] = cy;
        geoFlujo[o + 4] = e.t.x;
        geoFlujo[o + 5] = e.t.y;
        litFlujo[nFlujo] = lit ? 1 : 0;
        nFlujo++;

        // Flecha al medio del enlace apuntando al destino (capa de nodos: va
        // por encima del flujo, como cuando se dibujaba arista por arista).
        if (showArrow) {
          const bx = 0.25 * e.s.x + 0.5 * cx + 0.25 * e.t.x;
          const by = 0.25 * e.s.y + 0.5 * cy + 0.25 * e.t.y;
          const a = Math.atan2(e.t.y - e.s.y, e.t.x - e.s.x);
          const size = 6 / scale;
          nctx.fillStyle = lit ? colEdgeLit : colEdge;
          nctx.beginPath();
          nctx.moveTo(bx + Math.cos(a) * size, by + Math.sin(a) * size);
          nctx.lineTo(bx + Math.cos(a + 2.6) * size, by + Math.sin(a + 2.6) * size);
          nctx.lineTo(bx + Math.cos(a - 2.6) * size, by + Math.sin(a - 2.6) * size);
          nctx.closePath();
          nctx.fill();
        }
      }
      conFlujo = showFlow && nFlujo > 0;

      // Nodos: se dibujan como SPRITE cacheado (círculo + glow ya rasterizados) en
      // vez de aplicar `shadowBlur` en cada `fill()`. El sprite se genera a la
      // resolución real de pantalla y se coloca en coordenadas de mundo con el
      // tamaño equivalente, así el resultado es idéntico pero sin un blur
      // gaussiano por nodo y por frame.
      const escalaPix = scale * dpr;
      for (const n of sim) {
        if (!revealed(n)) continue; // construcción temporal: aún no apareció
        if (!dentro(n.x, n.y)) continue; // culling
        // Blanco: el nodo central y el que está bajo el cursor. Accent: los que
        // referencian al nodo en foco. Si no, el color del grupo (si tiene) o el
        // glow por defecto.
        const isWhite = n.id === centerId || n === hover;
        const refsFocus = !isWhite && focusRefs.has(n.id);
        const custom = nodeColorsRef.current?.get(n.id);
        const base = custom ?? colNode;
        const shadow = refsFocus ? colAccent : base;
        const fill = isWhite ? colCenter : refsFocus ? colAccent : base;
        const blurPix = isWhite ? 22 : refsFocus ? 16 : 12;
        // Radio en píxeles reales, redondeado a 0.5 para acotar las variantes de
        // sprite que genera el zoom continuo.
        const rPix = Math.max(0.5, Math.round(n.r * escalaPix * 2) / 2);
        const sprite = nodeSprite(fill, shadow, rPix, blurPix);
        const ladoMundo = sprite.width / escalaPix;
        nctx.drawImage(sprite, n.x - ladoMundo / 2, n.y - ladoMundo / 2, ladoMundo, ladoMundo);
      }

      // Qué nombres se dibujan (`FUN-M-21`). El foco es el nodo apuntado y, si
      // no hay ninguno, el centro del panel — el mismo criterio que usa el
      // resaltado, para que el nombre acompañe a lo que ya está destacado.
      const modo = modoNombresRef.current;
      const foco = hover ?? centerNode;
      // En «todos» sigue mandando el zoom: alejado, los nombres se amontonan
      // hasta ser ilegibles y solo se deja el del apuntado. Los otros dos modos
      // ya muestran pocos, así que no necesitan ese recorte.
      const showAll = scale > 0.5;
      nctx.textAlign = "center";
      nctx.font = `${12 / scale}px ${fontFamily}`;
      for (const n of sim) {
        if (!revealed(n)) continue;
        if (modo === "apuntado") {
          if (n !== foco) continue;
        } else if (modo === "vecinos") {
          if (n !== foco && !vecinos.has(n.id)) continue;
        } else if (!showAll && n !== hover && n.id !== centerId) {
          continue;
        }
        if (!dentro(n.x, n.y)) continue; // culling
        nctx.fillStyle = n === hover || n.id === centerId ? colText2 : colText;
        nctx.fillText(n.titulo, n.x, n.y + n.r + 13 / scale);
      }
    };

    /**
     * Un frame del cúmulo: repinta las capas si algo las ensució y compone
     * aristas + flujo animado + nodos. En reposo, sin flujo, esto no corre.
     */
    const draw = () => {
      const w = canvas.width;
      const h = canvas.height;
      // Un lienzo sin tamaño (panel colapsado) no se dibuja: `drawImage` de una
      // capa de 0 px lanza una excepción.
      if (w === 0 || h === 0) return;
      if (sucioEstatico) {
        pintarCapas();
        sucioEstatico = false;
      }
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, w, h);
      ctx.drawImage(capaAristas, 0, 0);
      if (conFlujo) {
        // Flujo animado a lo largo de cada arista visible (origen → destino):
        // los mismos guiones de siempre, con el desplazamiento del reloj.
        aplicarVista(ctx, w, h);
        ctx.setLineDash([2 / scale, 9 / scale]);
        ctx.lineDashOffset = -((performance.now() / 1000) * 30) / scale;
        for (let i = 0; i < nFlujo; i++) {
          const lit = litFlujo[i] === 1;
          ctx.strokeStyle = lit ? colCenter : colEdgeLit;
          ctx.globalAlpha = lit ? 0.95 : 0.5;
          ctx.lineWidth = (lit ? 2.2 : 1.5) / scale;
          const o = i * 6;
          ctx.beginPath();
          ctx.moveTo(geoFlujo[o], geoFlujo[o + 1]);
          ctx.quadraticCurveTo(geoFlujo[o + 2], geoFlujo[o + 3], geoFlujo[o + 4], geoFlujo[o + 5]);
          ctx.stroke();
        }
        ctx.setLineDash([]);
        ctx.lineDashOffset = 0;
        ctx.globalAlpha = 1;
        ctx.setTransform(1, 0, 0, 1, 0, 0);
      }
      ctx.drawImage(capaNodos, 0, 0);
    };

    // Construcción temporal con física (cúmulo y sustrato): colocar los nodos
    // recién aparecidos (en orden de creación) y dar energía para que el grafo
    // se reacomode al crecer.
    const avanzarConstruccion = (rc: number | null | undefined) => {
      if (rc != null) {
        if (prevRc == null) activated.clear(); // (re)inicio: crecer desde cero
        const target = Math.min(rc, orderedSim.length);
        while (activated.size < target) placeNew(orderedSim[activated.size]);
        if (rc !== prevRc) alpha = Math.max(alpha, 0.6);
      }
    };

    // ── Disposiciones micelio (`FUN-L-23`): capa estática + sobrecapa. Todo lo
    //    de acá abajo hasta `tickMicelio` es inerte cuando `disposicion` es el
    //    cúmulo, que sigue con `draw` y `tick` de siempre. ──
    const estatico = document.createElement("canvas");
    const sctx = estatico.getContext("2d");
    // El fondo de las etiquetas es el del lienzo (oscuro en cualquier tema),
    // semitransparente, para que el nombre se lea sobre un tapiz de hifas.
    const fondo = getComputedStyle(canvas.parentElement ?? canvas).backgroundColor;
    const paleta: PaletaMicelio = {
      hifa: conAlpha(ctx, colGlow, 0.24),
      hifaSustrato: conAlpha(ctx, colGlow, 0.2),
      cruce: conAlpha(ctx, colGlow, 0.07),
      halo: conAlpha(ctx, colGlow, 0.1),
      espora: colGlow,
      cuerpo: "#F2E4C4",
      foco: "#EAFFF8",
      acento: colAccent,
      texto: colText,
      textoFoco: colText2,
      textoHub: "rgba(242, 228, 196, 0.9)",
      fondoEtiqueta: conAlpha(ctx, fondo || "#0B100E", 0.75),
      fuente: fontFamily,
    };
    const escena: EscenaMicelio | null =
      g && posMicelio && disposicion !== "cumulo"
        ? {
            disposicion,
            g,
            pos: posMicelio,
            radio: Float32Array.from(sim, (n) => n.r),
            anillo,
            limiteRango: Infinity,
            // Solo en Crecimiento las hifas de lo recién revelado crecen.
            aparicion: disposicion === "crecimiento" ? new Float64Array(g.n) : null,
            reducido,
            colores: nodeColorsRef.current,
          }
        : null;
    const hubs = g ? hubsDe(g) : [];
    /** Sustrato: la simulación mueve `sim`; el dibujo lee `escena.pos`. */
    const sincronizarPos = () => {
      if (!escena) return;
      for (let i = 0; i < sim.length; i++) {
        escena.pos[i * 2] = sim[i].x;
        escena.pos[i * 2 + 1] = sim[i].y;
      }
    };
    if (escena && fisica) sincronizarPos(); // con caché, `sim` ya trae lo asentado

    /** Encuadra el grafo entero en el lienzo (primera vez que se elige la disposición). */
    const recentrar = () => {
      if (!escena) return;
      const W = canvas.width / dpr;
      const H = canvas.height / dpr;
      const margen = anillo ? anillo.R + 95 : 0; // el anillo lleva nombres por fuera
      const b = anillo
        ? { minX: -margen, minY: -margen, maxX: margen, maxY: margen }
        : limitesDe(escena.g, escena.pos);
      const s = Math.min((W - 40) / (b.maxX - b.minX + 1), (H - 40) / (b.maxY - b.minY + 1));
      scale = Math.min(Math.max(s, 0.05), 4);
      ox = -((b.minX + b.maxX) / 2) * scale;
      oy = -((b.minY + b.maxY) / 2) * scale;
      ensuciar();
    };

    /** El foco como índices del grafo (los conjuntos de arriba son por id). */
    const focoActual = (): FocoMicelio => {
      const vecinosIdx = new Set<number>();
      const refsIdx = new Set<number>();
      if (!g || !hover) return { nodo: -1, vecinos: vecinosIdx, refs: refsIdx };
      for (const id of vecinos) {
        const i = g.indice.get(id);
        if (i !== undefined) vecinosIdx.add(i);
      }
      for (const id of focusRefs) {
        const i = g.indice.get(id);
        if (i !== undefined) refsIdx.add(i);
      }
      return { nodo: g.indice.get(hover.id) ?? -1, vecinos: vecinosIdx, refs: refsIdx };
    };

    const dibujarMicelio = (ahora: number) => {
      if (!escena || !sctx) return;
      const cam: Camara = {
        scale,
        ox,
        oy,
        ancho: canvas.width / dpr,
        alto: canvas.height / dpr,
        dpr,
      };
      escena.limiteRango = revealCountRef.current ?? Infinity;
      escena.colores = nodeColorsRef.current;
      escena.reducido = reducido;
      // La capa estática solo se repinta si algo la ensució; queda sucia
      // mientras alguna hifa siga creciendo.
      if (sucioEstatico) sucioEstatico = dibujarCapaEstatica(sctx, escena, cam, paleta, ahora);
      dibujarSobrecapa(ctx, estatico, escena, cam, paleta, focoActual(), modoNombresRef.current, hubs);
    };

    const tickMicelio = () => {
      frame = 0;
      if (!running || !canvas.isConnected || !escena) return;
      const ahora = performance.now();
      const rc = revealCountRef.current;
      if (fisica) avanzarConstruccion(rc);
      if (rc !== prevRc) {
        if (escena.aparicion) {
          // Crecimiento: las hifas de lo recién revelado crecen desde ahora. Al
          // (re)iniciar o terminar la construcción se parte de cero.
          const desde = prevRc == null || rc == null || rc < prevRc ? 0 : prevRc;
          if (desde === 0) escena.aparicion.fill(0);
          if (rc != null) {
            const hasta = Math.min(rc, escena.g.n);
            for (let k = desde; k < hasta; k++) escena.aparicion[escena.g.orden[k]] = ahora;
          }
        }
        ensuciar();
      }
      prevRc = rc ?? null;
      let activo = false;
      if (fisica) {
        // Sustrato: el mismo reposo con período de gracia que el cúmulo.
        const interacting = !!dragNode || panning;
        if (interacting || alpha > REST) lastEnergetic = ahora;
        activo = continuousSim || ahora - lastEnergetic <= IDLE_GRACE_MS;
        if (activo) {
          simulate();
          sincronizarPos();
          ensuciar();
        }
      }
      if (visible) dibujarMicelio(ahora);
      // Sin física activa ni hifas creciendo no hay frame siguiente: en reposo
      // no corre `requestAnimationFrame`; la capa estática se queda como está
      // hasta la próxima interacción.
      if (activo || (visible && sucioEstatico)) frame = requestAnimationFrame(tickMicelio);
    };

    const tick = () => {
      frame = 0;
      if (!running || !canvas.isConnected) return;
      const rc = revealCountRef.current;
      avanzarConstruccion(rc);
      prevRc = rc ?? null;
      const now = performance.now();
      const interacting = !!dragNode || panning;
      // Mientras haya energía o interacción, se reinicia el contador de reposo.
      if (interacting || alpha > REST) lastEnergetic = now;
      // Bloqueo (por defecto): tras asentarse y pasar el período de gracia, se
      // detiene. Con `continuousSim` el bloqueo está desactivado: nunca para.
      const idle = !continuousSim && now - lastEnergetic > IDLE_GRACE_MS;
      const active = !idle;
      if (active) {
        simulate();
        ensuciar(); // los nodos se movieron: la capa estática ya no vale
      }
      // Oculto no se dibuja: ocultarlo cambia su tamaño, eso le da energía a la
      // simulación, y dibujaba cada frame sin que nadie lo viera. Al volver a
      // verse, el observador lo despierta y el primer frame ya lo pinta.
      if (visible) draw();
      // Flujo animado sobre la capa → mantener el redibujo aunque la simulación
      // esté en reposo (en ese caso solo se copia la capa y se mueve el flujo).
      // `conFlujo` lo decide la última capa pintada (opción, movimiento reducido).
      const animating = visible && conFlujo;
      // Si no hay nada activo ni animándose, se detiene (sin rAF) hasta que algo
      // lo despierte con wake().
      if (active || animating) frame = requestAnimationFrame(tick);
    };
    resize(); // dimensiona el canvas antes del primer frame
    wake();

    return () => {
      running = false;
      movimiento.removeEventListener("change", alCambiarMovimiento);
      observador.disconnect();
      if (wakeRef.current === despertar) wakeRef.current = null;
      if (frame) cancelAnimationFrame(frame);
      // Guardar el layout actual para que el próximo montaje (cambio de pestaña)
      // o recálculo (datos nuevos) arranque asentado, sin re-simular desde cero.
      // Solo vale para las disposiciones con física: el anillo y el crecimiento
      // son deterministas y se recalculan en milisegundos.
      if (fisica) {
        const positions: Record<string, { x: number; y: number }> = {};
        for (const n of sim) positions[n.id] = { x: n.x, y: n.y };
        guardarPosiciones?.(positions);
      }
      // Conservar el zoom/pan para el próximo (re)montaje o recálculo. Si nunca
      // llegó a encuadrarse (el lienzo no tuvo tamaño), no hay vista que guardar.
      if (!encuadrePendiente) guardarVista?.({ scale, ox, oy });

      canvas.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
      canvas.removeEventListener("wheel", onWheel);
      ro.disconnect();
    };
  }, [nodes, edges, centerId, continuousSim, tema, modoOscuro, disposicion]);

  return <canvas ref={canvasRef} style={{ display: "block", width: "100%", height: "100%" }} />;
}
