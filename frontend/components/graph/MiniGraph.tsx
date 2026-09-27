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
import { ALPHA_CACHE, ALPHA_NUEVOS, sembrarFilotaxis } from "./cicloFisica";
import { type EstadoFisica, constantesDe, crearEstado } from "./fisica";
import { MIN_NODOS_WORKER, type MotorFisica, crearMotor } from "./motorFisica";
import {
  type Camara,
  type EscenaMicelio,
  type FocoMicelio,
  type PaletaMicelio,
  type Vista,
  conAlpha,
  copiarCapa,
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

/**
 * `r` = radio del nodo, precalculado (depende solo de `conexiones` y del centro).
 * `i` = su índice en los arrays del motor de fuerzas (`fisica.ts`), que son los
 * que tienen la posición y la velocidad de verdad; `x`/`y` son la copia que dibuja.
 */
type SimNode = GraphNode & { x: number; y: number; i: number; r: number };
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

/**
 * Flujo animado acotado (`FUN-L-25` · B2, `DEF-109`). Por debajo de este zoom
 * los guiones no se distinguen: es el mismo umbral que ya apaga los nombres.
 */
const FLUJO_ZOOM_MIN = 0.5;
/**
 * Techo de aristas visibles con flujo. Medido en `DEF-109`: con miles de
 * trazos por frame el canvas cae a un régimen decenas de veces más lento
 * (719 ms/frame a 2.000 nodos con todo a la vista). Por encima, sin guiones.
 */
const FLUJO_MAX_ARISTAS = 1500;

/** Si un frame de dibujo en movimiento pasó de esto, el siguiente se salta. */
const PRESUPUESTO_DIBUJO_MS = 12;
/** Nombres que se ven mientras el grafo se mueve: los de más enlaces. */
const HUBS_CON_NOMBRE = 24;

/**
 * Margen por lado de las capas offscreen, como fracción del lienzo (Parte D).
 * Mientras dura un paneo o un zoom con rueda el lienzo solo copia las capas
 * desplazadas o escaladas; el margen es lo que se ve en los bordes en vez de un
 * hueco vacío, hasta el repintado del final del gesto.
 */
const MARGEN_CAPA = 0.25;
/** Tras el último evento de rueda, cuánto se espera para repintar a fidelidad completa. */
const RUEDA_REPOSO_MS = 150;
/** Sustrato en movimiento: la capa se repinta como mucho a ~30 fps. */
const INTERVALO_SUSTRATO_MS = 33;

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
    /** Nodos sin posición (ni caché ni siembra de micelio): los siembra el cúmulo. */
    const sinSembrar: number[] = [];
    const sim: SimNode[] = nodes.map((n, i) => {
      const cached = saved?.[n.id];
      if (cached && n.id !== centerId && fisica) {
        savedCount++;
        return { ...n, x: cached.x, y: cached.y, i, r: radioDe(n) };
      }
      if (posMicelio) {
        return { ...n, x: posMicelio[i * 2], y: posMicelio[i * 2 + 1], i, r: radioDe(n) };
      }
      sinSembrar.push(i); // el cúmulo lo siembra más abajo (filotaxis)
      return { ...n, x: 0, y: 0, i, r: radioDe(n) };
    });
    // Si casi todos los nodos vienen del cache, arrancar con poca energía para
    // que el grafo aparezca ya asentado; si hay nodos nuevos, algo más para
    // integrarlos suavemente; si todo es nuevo, simulación completa (como
    // `d3-force`: 0,05, 0,3 y 1; el ciclo está en `cicloFisica.ts`).
    const cachedRatio = N > 0 ? savedCount / N : 0;
    const initialAlpha = cachedRatio >= 0.999 ? ALPHA_CACHE : cachedRatio > 0 ? ALPHA_NUEVOS : 1;
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

    // Constantes del motor. El sustrato (`FUN-L-23`) usa la MISMA simulación
    // con repulsión y reposo más cortos (k = 45), fuerza al 70 % y tope 6: la
    // colonia queda apretada y las hifas, cortas. El cúmulo conserva sus valores.
    const constantes = constantesDe(disposicion === "sustrato" ? "sustrato" : "cumulo");

    // ── Siembra (`FUN-L-25` · Parte C). Los nodos sin caché que tienen algún
    //    vecino con posición nacen junto a ellos (como en la construcción
    //    temporal); el resto, en filotaxis alrededor del origen, con el nodo
    //    central primero y después los de más enlaces. Antes nacían todos en un
    //    anillo de radio 50–140 y el grafo pasaba cientos de pasos
    //    expandiéndose a empujones. ──
    if (sinSembrar.length > 0) {
      const conPosicion = new Uint8Array(N).fill(1);
      for (const i of sinSembrar) conPosicion[i] = 0;
      const vecinosIdx: number[][] = Array.from({ length: N }, () => []);
      for (const e of simEdges) {
        vecinosIdx[e.s.i].push(e.t.i);
        vecinosIdx[e.t.i].push(e.s.i);
      }
      const enFilotaxis: number[] = [];
      for (const i of sinSembrar) {
        let sx = 0;
        let sy = 0;
        let cuantos = 0;
        for (const j of vecinosIdx[i]) {
          if (!conPosicion[j]) continue;
          sx += sim[j].x;
          sy += sim[j].y;
          cuantos++;
        }
        if (cuantos === 0 || sim[i].id === centerId) {
          enFilotaxis.push(i);
          continue;
        }
        const jitter = constantes.k / 4;
        sim[i].x = sx / cuantos + (Math.random() - 0.5) * jitter;
        sim[i].y = sy / cuantos + (Math.random() - 0.5) * jitter;
      }
      enFilotaxis.sort(
        (a, b) =>
          Number(sim[b].id === centerId) - Number(sim[a].id === centerId) ||
          sim[b].conexiones - sim[a].conexiones ||
          a - b,
      );
      const semilla = new Float64Array(N * 2);
      sembrarFilotaxis(semilla, enFilotaxis, constantes.k);
      for (const i of enFilotaxis) {
        sim[i].x = semilla[i * 2];
        sim[i].y = semilla[i * 2 + 1];
      }
    }

    // ── Motor de fuerzas (`fisica.ts`, `FUN-L-25` · B3): posiciones y
    //    velocidades en arrays tipados; `sim[i].x/y` es la copia que se dibuja.
    //    Lo que el hilo principal mueve a mano (arrastre, nodos que aparecen)
    //    pasa por `colocar`, que actualiza las dos y avisa al motor (que puede
    //    estar en un worker, `B4`: se crea más abajo, con las constantes). ──
    let motor: MotorFisica | null = null;
    const estado: EstadoFisica = crearEstado(
      N,
      Float64Array.from({ length: N * 2 }, (_, j) => (j & 1 ? sim[j >> 1].y : sim[j >> 1].x)),
      Int32Array.from(simEdges.flatMap((e) => [e.s.i, e.t.i])),
      centerId ? sim.findIndex((n) => n.id === centerId) : -1,
    );
    /** Nodos que ya participan en la construcción temporal (espejo de `activated`). */
    const mascaraActivos = new Uint8Array(N);
    const colocar = (n: SimNode, x: number, y: number) => {
      n.x = x;
      n.y = y;
      estado.pos[n.i * 2] = x;
      estado.pos[n.i * 2 + 1] = y;
      estado.vel[n.i * 2] = 0;
      estado.vel[n.i * 2 + 1] = 0;
      motor?.colocar(n.i, x, y);
    };

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
        colocar(
          n,
          sx / nbrs.length + (Math.random() - 0.5) * 24,
          sy / nbrs.length + (Math.random() - 0.5) * 24,
        );
      } else {
        const ang = Math.random() * Math.PI * 2;
        const rad = 16 + Math.random() * 28;
        colocar(n, Math.cos(ang) * rad, Math.sin(ang) * rad);
      }
      activated.add(n.id);
      mascaraActivos[n.i] = 1;
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
    // ── La cámara nunca repinta a mitad de gesto (`FUN-L-25` · Parte D). Las
    //    capas llevan un margen por lado (`margenX`/`margenY`, en px CSS) y recuerdan
    //    la vista con que se pintaron; mientras se panea o se gira la rueda, el
    //    lienzo las copia llevadas a la vista de ahora (`copiarCapa`) y el
    //    repintado completo llega al terminar el gesto: al soltar el paneo, o
    //    `RUEDA_REPOSO_MS` después del último evento de rueda. Antes cada evento
    //    de paneo o de rueda repintaba el grafo entero. ──
    let margenX = 0;
    let margenY = 0;
    /** Vista con que se pintó lo último (las capas, o el lienzo en movimiento). */
    let vistaPintada: Vista = { scale, ox, oy };
    let ruedaActiva = false;
    let temporizadorRueda: ReturnType<typeof setTimeout> | undefined;
    const enGesto = () => panning || ruedaActiva;
    const camaraMovida = () =>
      scale !== vistaPintada.scale || ox !== vistaPintada.ox || oy !== vistaPintada.oy;
    /** Lo pintado pasa a ser lo de la vista de ahora. */
    const marcarVistaPintada = () => {
      vistaPintada = { scale, ox, oy };
    };
    /** Posiciones que el ratón movió a mano (arrastre): van con el próximo lote. */
    let movidoAMano = false;
    // Sin vista cacheada, la disposición micelio se encuadra en cuanto el lienzo
    // tenga tamaño (la primera vez que se elige; después recuerda su vista).
    let encuadrePendiente = micelio && !v0;
    let downAt: { x: number; y: number } | null = null;
    let dpr = window.devicePixelRatio || 1;
    let running = true;
    // Reposo: cuando el grafo se asienta (el motor avisa) y no hay interacción
    // se deja de redibujar para no consumir CPU con muchos nodos. Cualquier
    // interacción (drag, hover, zoom, resize) lo despierta. `frame` = rAF pendiente.
    // Si `continuousSim`, el motor nunca se asienta. Tras la última
    // interacción el bucle sigue IDLE_GRACE_MS antes de detenerse (antes eran
    // 5 s simulando con energía residual; la Parte C lo bajó a 1 s).
    const IDLE_GRACE_MS = 1000;
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
      // (Ya no le da energía a la simulación: el tamaño del lienzo no cambia
      // el layout, solo la vista. Con la caché, eso volvía a mover el grafo
      // entero cada vez que se abría la pestaña, porque montar dispara resize.)
      // El margen de las capas es un número entero de píxeles reales: así, sin
      // gesto, copiarlas es píxel a píxel (lo quieto se ve idéntico).
      const mxDev = Math.round(parent.clientWidth * MARGEN_CAPA * dpr);
      const myDev = Math.round(parent.clientHeight * MARGEN_CAPA * dpr);
      margenX = mxDev / dpr;
      margenY = myDev / dpr;
      const anchoCapa = canvas.width + 2 * mxDev;
      const altoCapa = canvas.height + 2 * myDev;
      if (micelio) {
        estatico.width = sobre.width = anchoCapa;
        estatico.height = sobre.height = altoCapa;
        if (encuadrePendiente && parent.clientWidth > 0 && parent.clientHeight > 0) {
          recentrar();
          encuadrePendiente = false;
        }
      } else {
        capaAristas.width = capaNodos.width = anchoCapa;
        capaAristas.height = capaNodos.height = altoCapa;
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
          // El motor sube la energía mientras dure (`alphaObjetivo` 0,3).
          arrancarCorrida();
          motor?.fijar(n.i, n.x, n.y);
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
        motor?.fijar(dragNode.i, p.x, p.y);
        // Con el worker, las posiciones siguientes pueden no llegar en este
        // frame: el nodo arrastrado va con el próximo lote que se pinte (con
        // el mismo presupuesto que las posiciones del motor).
        movidoAMano = true;
        wake();
      } else if (panning) {
        // Sin repintar: el frame copia las capas desplazadas (Parte D).
        ox += ev.movementX;
        oy += ev.movementY;
        wake();
      } else {
        const n = pick(ev);
        if (n !== hover) {
          hover = n;
          computeRefs(hover ?? centerNode); // foco = hover, o el centro si no hay
          canvas.style.cursor = n ? "pointer" : "grab";
          // Un redibujo para el resaltado de hover. En el cúmulo el resaltado
          // vive en la capa estática; en micelio va en la sobrecapa.
          if (micelio) sucioSobre = true;
          else ensuciar();
          wake();
        }
      }
    };
    const onMouseUp = (ev: MouseEvent) => {
      const moved =
        downAt && Math.hypot(ev.clientX - downAt.x, ev.clientY - downAt.y) > 4;
      const pulsado = dragNode ?? clickNode;
      if (pulsado && !moved) onOpenRef.current(pulsado.id);
      if (dragNode) {
        inicioCorrida = performance.now(); // «asentado en…» cuenta desde que se suelta
        motor?.soltar();
      }
      dragNode = null;
      clickNode = null;
      if (panning) {
        // Fin del paneo: el próximo frame ve la cámara movida fuera de un
        // gesto y repinta a fidelidad completa.
        panning = false;
        wake();
      }
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
      // Durante el gesto el frame copia las capas escaladas alrededor del
      // puntero (Parte D); el repintado completo, cuando la rueda se detiene.
      ruedaActiva = true;
      clearTimeout(temporizadorRueda);
      temporizadorRueda = setTimeout(() => {
        ruedaActiva = false;
        wake();
      }, RUEDA_REPOSO_MS);
      wake();
    };

    canvas.addEventListener("mousedown", onMouseDown);
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    canvas.addEventListener("wheel", onWheel, { passive: false });
    const ro = new ResizeObserver(resize);
    ro.observe(canvas.parentElement ?? canvas);

    // La física, en un worker si se puede (`motorFisica.ts`); si no, acá mismo.
    // Con el worker corre libre (Parte C): el hilo principal dibuja lo último
    // que llegó y el motor avisa cuando el grafo se asienta.
    // Solo el grafo global (sin nodo central) lo cuenta en la consola: el
    // mini-grafo del panel se reconstruye con cada nota que se abre.
    const informar = fisica && centerId === null;
    let inicioCorrida = performance.now();
    if (fisica) {
      motor = crearMotor(estado, constantes, {
        continuo: continuousSim,
        alRecibir: () => wake(),
        alAsentar: (pasos) => {
          if (informar) {
            const seg = (performance.now() - inicioCorrida) / 1000;
            console.info(`grafo: asentado en ${seg.toFixed(1)} s, ${pasos} pasos`);
          }
          // El primer frame quieto se pinta a fidelidad completa.
          ensuciar();
          wake();
        },
      });
      if (informar) {
        console.info(
          `grafo: física en ${motor.enWorker ? "worker" : "hilo principal"}, ${N} nodos, ${simEdges.length} aristas`,
        );
      }
    }
    /** Un arranque nuevo (el grafo estaba quieto): desde acá se cuenta el asentamiento. */
    function arrancarCorrida() {
      if (motor && !motor.corriendo) inicioCorrida = performance.now();
    }
    function calentarMotor(a: number) {
      arrancarCorrida();
      motor?.correr(a);
    }
    if (revealCountRef.current == null) calentarMotor(initialAlpha);

    /**
     * Aplica las posiciones nuevas del motor, si llegaron (en el hilo
     * principal, antes da los pasos de este frame). Devuelve si los nodos se
     * movieron.
     */
    const simulate = (): boolean => {
      if (!motor) return false;
      motor.avanzar();
      const pos = motor.tomar();
      if (!pos) return false;
      for (const n of sim) {
        if (n === dragNode) continue; // manda el ratón
        n.x = pos[n.i * 2];
        n.y = pos[n.i * 2 + 1];
      }
      return true;
    };

    // ── Cúmulo con capa estática y reposo real (`FUN-L-25` · B1, `DEF-109`).
    //    Antes cada frame redibujaba el grafo entero, y con el flujo animado
    //    (que viene por defecto) eso era a 60 fps para siempre. El dibujo va en
    //    tres pasadas, siempre en este orden: aristas base, flujo animado, y
    //    flechas + nodos + nombres (el flujo pasa por debajo de nodos y flechas).
    //    - En reposo, las pasadas quietas se pintan a DOS capas offscreen que
    //      solo se repintan si algo las ensucia (vista, foco, lo revelado, una
    //      opción); cada frame es copiar las capas con el flujo en el medio, y
    //      sin flujo no hay frame.
    //    - Mientras la simulación está activa los nodos se mueven casi en cada
    //      frame: ahí las capas no se pueden reutilizar y pintarlas aparte y
    //      copiarlas costaría más (medido), así que se dibuja directo como antes. ──
    const capaAristas = document.createElement("canvas");
    const capaNodos = document.createElement("canvas");
    const actx = capaAristas.getContext("2d");
    const nctx = capaNodos.getContext("2d");
    /** ¿Las capas tienen lo último? (dejan de tenerlo tras un frame directo). */
    let capasVigentes = false;
    /** ¿El lienzo ya muestra lo último a fidelidad completa, sin nada animado encima? */
    let lienzoAlDia = false;
    /** Geometría de las aristas visibles: `[sx, sy, cx, cy, tx, ty]` por arista. */
    let geoAristas = new Float64Array(0);
    /** 1 = la arista toca el nodo apuntado (se resalta). */
    let litAristas = new Uint8Array(0);
    let nVisibles = 0;
    /** ¿Lo último pintado lleva flujo animado encima? */
    let conFlujo = false;
    // Rectángulo visible en coordenadas de MUNDO (culling), de la última pintada.
    let visL = 0;
    let visR = 0;
    let visT = 0;
    let visB = 0;
    const dentro = (x: number, y: number) => x >= visL && x <= visR && y >= visT && y <= visB;
    // El del lienzo visible, sin el margen de las capas (Parte D): los nombres y
    // el flujo solo se pintan acá, como antes de que las capas tuvieran margen.
    let vpL = 0;
    let vpR = 0;
    let vpT = 0;
    let vpB = 0;
    const dentroVista = (x: number, y: number) => x >= vpL && x <= vpR && y >= vpT && y <= vpB;
    /** 1 = la arista visible cae en el lienzo (no solo en el margen de la capa). */
    let enVistaAristas = new Uint8Array(0);
    /** ¿Lo último del reposo se pintó en una sola capa (sin flujo posible)? */
    let capaUnica = true;
    /** Vista que muestra el lienzo compuesto con las capas (si `lienzoAlDia`). */
    let lienzoVista: Vista = { scale, ox, oy };

    /** Transformación de la vista (mundo → píxeles) sobre un contexto. */
    const aplicarVista = (c: CanvasRenderingContext2D, w: number, h: number) => {
      c.setTransform(dpr, 0, 0, dpr, 0, 0);
      c.translate(w / (2 * dpr) + ox, h / (2 * dpr) + oy);
      c.scale(scale, scale);
    };
    /** Limpia el contexto y le aplica la vista. */
    const prepararLienzo = (c: CanvasRenderingContext2D, w: number, h: number) => {
      c.setTransform(1, 0, 0, 1, 0, 0);
      c.clearRect(0, 0, w, h);
      aplicarVista(c, w, h);
    };

    // ── Culling por viewport: rectángulo visible en coordenadas de MUNDO. Todo
    //    lo que cae fuera no se dibuja (nodos, aristas y etiquetas). El test es
    //    aritmética simple frente al costo de rasterizar, y no cambia nada de lo
    //    que se ve: con zoom alto evita pagar por lo que está fuera de pantalla. ──
    //    `conMargen`: lo que se pinta a las capas incluye su margen (Parte D).
    const calcularVisible = (conMargen: boolean) => {
      const cw = canvas.width / dpr;
      const ch = canvas.height / dpr;
      const margen = 40 / scale; // glow + etiqueta del nodo
      vpL = (-cw / 2 - ox) / scale - margen;
      vpR = (cw / 2 - ox) / scale + margen;
      vpT = (-ch / 2 - oy) / scale - margen;
      vpB = (ch / 2 - oy) / scale + margen;
      const extraX = conMargen ? margenX / scale : 0;
      const extraY = conMargen ? margenY / scale : 0;
      visL = vpL - extraX;
      visR = vpR + extraX;
      visT = vpT - extraY;
      visB = vpB + extraY;
    };
    const fueraDeVista = (e: SimEdge) =>
      Math.max(e.s.x, e.t.x) < visL ||
      Math.min(e.s.x, e.t.x) > visR ||
      Math.max(e.s.y, e.t.y) < visT ||
      Math.min(e.s.y, e.t.y) > visB;
    const fueraDelLienzo = (e: SimEdge) =>
      Math.max(e.s.x, e.t.x) < vpL ||
      Math.min(e.s.x, e.t.x) > vpR ||
      Math.max(e.s.y, e.t.y) < vpT ||
      Math.min(e.s.y, e.t.y) > vpB;

    /** Cuántas aristas caen en el lienzo visible (solo el culling, sin dibujar). */
    const aristasALaVista = () => {
      calcularVisible(false);
      let n = 0;
      for (const e of simEdges) {
        if (!revealed(e.s) || !revealed(e.t) || fueraDelLienzo(e)) continue;
        if (++n > FLUJO_MAX_ARISTAS) break;
      }
      return n;
    };

    // Punto de control de la curva de una arista (CA4): el mismo en reposo y en
    // movimiento, así el grafo no cambia de forma al detenerse (Parte D).
    let ctrlX = 0;
    let ctrlY = 0;
    const controlDe = (e: SimEdge) => {
      const mx = (e.s.x + e.t.x) / 2;
      const my = (e.s.y + e.t.y) / 2;
      const nx = -(e.t.y - e.s.y);
      const ny = e.t.x - e.s.x;
      const len = Math.max(Math.hypot(nx, ny), 1);
      const bend = 0.12;
      ctrlX = mx + (nx / len) * len * bend;
      ctrlY = my + (ny / len) * len * bend;
    };

    /**
     * Pasada 1: aristas base. Además guarda la geometría de las visibles.
     * `flujo`: si lleva flujo animado encima; sin indicar, lo decide como
     * siempre (la opción, el zoom y cuántas aristas quedan a la vista).
     */
    const pintarAristas = (c: CanvasRenderingContext2D, conMargen: boolean, flujo?: boolean) => {
      calcularVisible(conMargen);

      // Aristas con curva bezier suave (CA4). Indicador de dirección (s→t):
      // flujo animado (dash en movimiento) y/o flecha al medio, según la opción.
      const dir = edgeDirectionRef.current;
      const showFlow = !reducido && (dir === "animated" || dir === "both");
      const glow = hoverGlowRef.current;
      if (geoAristas.length < simEdges.length * 6) {
        geoAristas = new Float64Array(simEdges.length * 6);
        litAristas = new Uint8Array(simEdges.length);
        enVistaAristas = new Uint8Array(simEdges.length);
      }
      nVisibles = 0;
      for (const e of simEdges) {
        if (!revealed(e.s) || !revealed(e.t)) continue; // aún no aparecieron
        // Culling: descartar la arista si su caja envolvente no toca la vista.
        if (fueraDeVista(e)) continue;
        const lit = hover && (e.s === hover || e.t === hover);
        controlDe(e);
        const cx = ctrlX;
        const cy = ctrlY;

        // Línea base. Al apuntar un nodo, sus enlaces brillan con intensidad
        // `glow` (ancho + halo); con glow=0 apenas se resaltan.
        c.strokeStyle = lit ? colEdgeLit : colEdge;
        c.lineWidth = (lit ? 1.2 + 0.9 * glow : 1.1) / scale;
        if (lit && glow > 0) {
          c.shadowColor = colEdgeLit;
          c.shadowBlur = (8 * glow) / scale;
        }
        c.beginPath();
        c.moveTo(e.s.x, e.s.y);
        c.quadraticCurveTo(cx, cy, e.t.x, e.t.y);
        c.stroke();
        c.shadowBlur = 0;

        // La curva queda guardada para el flujo (que se mueve en cada frame) y
        // para la flecha (que va en la pasada de nodos).
        const o = nVisibles * 6;
        geoAristas[o] = e.s.x;
        geoAristas[o + 1] = e.s.y;
        geoAristas[o + 2] = cx;
        geoAristas[o + 3] = cy;
        geoAristas[o + 4] = e.t.x;
        geoAristas[o + 5] = e.t.y;
        litAristas[nVisibles] = lit ? 1 : 0;
        enVistaAristas[nVisibles] = fueraDelLienzo(e) ? 0 : 1;
        nVisibles++;
      }
      // Flujo acotado (`FUN-L-25` · B2): alejado o con demasiadas aristas a la
      // vista, solo queda el trazo base (y la flecha, si la opción la pide). La
      // opción no cambia de valor: el flujo vuelve en cuanto el zoom o el
      // recorte lo permiten.
      conFlujo =
        flujo ??
        (showFlow && nVisibles > 0 && scale >= FLUJO_ZOOM_MIN && nVisibles <= FLUJO_MAX_ARISTAS);
    };

    /** Pasada 2: el flujo animado a lo largo de cada arista visible (origen → destino). */
    const pintarFlujo = (c: CanvasRenderingContext2D) => {
      // Los mismos guiones de siempre, con el desplazamiento del reloj.
      c.setLineDash([2 / scale, 9 / scale]);
      c.lineDashOffset = -((performance.now() / 1000) * 30) / scale;
      for (let i = 0; i < nVisibles; i++) {
        if (enVistaAristas[i] === 0) continue; // en el margen de la capa: no se ve
        const lit = litAristas[i] === 1;
        c.strokeStyle = lit ? colCenter : colEdgeLit;
        c.globalAlpha = lit ? 0.95 : 0.5;
        c.lineWidth = (lit ? 2.2 : 1.5) / scale;
        const o = i * 6;
        c.beginPath();
        c.moveTo(geoAristas[o], geoAristas[o + 1]);
        c.quadraticCurveTo(geoAristas[o + 2], geoAristas[o + 3], geoAristas[o + 4], geoAristas[o + 5]);
        c.stroke();
      }
      c.setLineDash([]);
      c.lineDashOffset = 0;
      c.globalAlpha = 1;
    };

    /** Pasada 3: flechas, nodos y nombres (usa la geometría de la pasada 1). */
    const pintarNodos = (c: CanvasRenderingContext2D) => {
      // Flecha al medio del enlace apuntando al destino.
      const dir = edgeDirectionRef.current;
      const showArrow = dir === "arrow" || dir === "both" || (reducido && dir === "animated");
      if (showArrow) {
        const size = 6 / scale;
        for (let i = 0; i < nVisibles; i++) {
          const o = i * 6;
          const sx = geoAristas[o];
          const sy = geoAristas[o + 1];
          const tx = geoAristas[o + 4];
          const ty = geoAristas[o + 5];
          const bx = 0.25 * sx + 0.5 * geoAristas[o + 2] + 0.25 * tx;
          const by = 0.25 * sy + 0.5 * geoAristas[o + 3] + 0.25 * ty;
          const a = Math.atan2(ty - sy, tx - sx);
          c.fillStyle = litAristas[i] === 1 ? colEdgeLit : colEdge;
          c.beginPath();
          c.moveTo(bx + Math.cos(a) * size, by + Math.sin(a) * size);
          c.lineTo(bx + Math.cos(a + 2.6) * size, by + Math.sin(a + 2.6) * size);
          c.lineTo(bx + Math.cos(a - 2.6) * size, by + Math.sin(a - 2.6) * size);
          c.closePath();
          c.fill();
        }
      }

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
        c.drawImage(sprite, n.x - ladoMundo / 2, n.y - ladoMundo / 2, ladoMundo, ladoMundo);
      }

      pintarNombres(c, false);
    };

    // ── Nombres (`FUN-M-21`; Parte C de `FUN-L-25`). Mientras el grafo se mueve
    //    solo se escriben los de los hubs, el apuntado y el centro (escribir los
    //    1.300 con `fillText` en cada frame era buena parte del frame); el resto
    //    aparece al asentarse, en la capa estática y sin pisarse: se escriben
    //    por importancia (apuntado, centro y después por enlaces, así los hubs
    //    ganan el sitio) y se salta el que caería encima de uno ya escrito, el
    //    mismo criterio de `hifas.ts` con una rejilla para no comparar todos
    //    contra todos. ──
    const hubsCumulo = new Set(
      [...sim].sort((a, b) => b.conexiones - a.conexiones || a.i - b.i).slice(0, HUBS_CON_NOMBRE),
    );
    /** Candidatos a nombre en orden de importancia. */
    const porImportancia = [...sim].sort((a, b) => b.conexiones - a.conexiones || a.i - b.i);
    /** Ancho de cada nombre con la fuente a 12 px (−1 = sin medir). Se mide una vez. */
    const anchoNombre = new Float32Array(N).fill(-1);
    /** Rejilla de ocupación en píxeles de pantalla: celda → cajas `[x, y, w, h, …]`. */
    const CELDA_NOMBRE = 96;
    const ocupadas = new Map<number, number[]>();
    /** ¿La caja pisa una ya ocupada? Si no, la ocupa. */
    const ocupar = (x: number, y: number, w: number, h: number, forzar: boolean): boolean => {
      const c0 = Math.floor(x / CELDA_NOMBRE);
      const c1 = Math.floor((x + w) / CELDA_NOMBRE);
      const f0 = Math.floor(y / CELDA_NOMBRE);
      const f1 = Math.floor((y + h) / CELDA_NOMBRE);
      if (!forzar) {
        for (let f = f0; f <= f1; f++) {
          for (let k = c0; k <= c1; k++) {
            const cajas = ocupadas.get(f * 100003 + k);
            if (!cajas) continue;
            for (let j = 0; j < cajas.length; j += 4) {
              if (
                x < cajas[j] + cajas[j + 2] &&
                x + w > cajas[j] &&
                y < cajas[j + 1] + cajas[j + 3] &&
                y + h > cajas[j + 1]
              ) {
                return false;
              }
            }
          }
        }
      }
      for (let f = f0; f <= f1; f++) {
        for (let k = c0; k <= c1; k++) {
          const clave = f * 100003 + k;
          const cajas = ocupadas.get(clave);
          if (cajas) cajas.push(x, y, w, h);
          else ocupadas.set(clave, [x, y, w, h]);
        }
      }
      return true;
    };

    const pintarNombres = (c: CanvasRenderingContext2D, soloDestacados: boolean) => {
      // Qué nombres se dibujan. El foco es el nodo apuntado y, si no hay
      // ninguno, el centro del panel — el mismo criterio que usa el
      // resaltado, para que el nombre acompañe a lo que ya está destacado.
      const modo = modoNombresRef.current;
      const foco = hover ?? centerNode;
      // En «todos» sigue mandando el zoom: alejado, los nombres se amontonan
      // hasta ser ilegibles y solo se deja el del apuntado. Los otros dos modos
      // ya muestran pocos, así que no necesitan ese recorte.
      const showAll = scale > 0.5;
      c.textAlign = "center";
      c.font = `${12 / scale}px ${fontFamily}`;
      const escribir = (n: SimNode) => {
        c.fillStyle = n === hover || n.id === centerId ? colText2 : colText;
        c.fillText(n.titulo, n.x, n.y + n.r + 13 / scale);
      };
      if (modo !== "todos" || !showAll) {
        for (const n of sim) {
          if (!revealed(n)) continue;
          if (modo === "apuntado") {
            if (n !== foco) continue;
          } else if (modo === "vecinos") {
            if (n !== foco && !vecinos.has(n.id)) continue;
          } else if (n !== hover && n.id !== centerId) {
            continue;
          }
          if (!dentroVista(n.x, n.y)) continue; // culling
          escribir(n);
        }
        return;
      }
      if (soloDestacados) {
        for (const n of sim) {
          if (n !== hover && n.id !== centerId && !hubsCumulo.has(n)) continue;
          if (!revealed(n) || !dentroVista(n.x, n.y)) continue;
          escribir(n);
        }
        return;
      }
      // Todos, sin pisarse. Las cajas se comparan en píxeles de pantalla.
      ocupadas.clear();
      const W2 = canvas.width / dpr / 2 + ox;
      const H2 = canvas.height / dpr / 2 + oy;
      const intentar = (n: SimNode, forzar: boolean) => {
        if (!revealed(n) || !dentroVista(n.x, n.y)) return;
        let w = anchoNombre[n.i];
        if (w < 0) {
          // `measureText` mide con la fuente de `c` (12/scale en unidades de
          // mundo): llevado a 12 px de pantalla, sirve para cualquier zoom.
          w = c.measureText(n.titulo).width * scale;
          anchoNombre[n.i] = w;
        }
        const sx = n.x * scale + W2;
        const sy = (n.y + n.r) * scale + 13 + H2; // línea base del texto
        if (ocupar(sx - w / 2 - 2, sy - 11, w + 4, 14, forzar)) escribir(n);
      };
      if (hover) intentar(hover, true);
      if (centerNode && centerNode !== hover) intentar(centerNode, true);
      for (const n of porImportancia) {
        if (n === hover || n === centerNode) continue;
        intentar(n, false);
      }
    };

    /**
     * Fidelidad de movimiento, mientras el grafo se mueve (Parte C, corregida
     * en la Parte D): las aristas conservan su curva —la misma que en reposo—,
     * sin flujo ni flecha ni brillo; nodos como discos planos del mismo color y
     * radio (sin el sprite con glow), agrupados por color para no cambiar el
     * relleno a cada nodo; solo los nombres destacados. Al asentarse se pinta
     * una vez a fidelidad completa. (La Parte C las trazaba rectas: el usuario
     * lo rechazó, las curvas son el estilo de Mycelium.)
     *
     * Un `stroke()` y un `fill()` por elemento, SIN agrupar en paths: medido
     * con la Tesina asentada (1.600 × 900 a dpr 1,5, rasterizado forzado),
     * agrupar los trazos empeora el rasterizado de forma monótona —35 ms uno
     * por arista, 45 en lotes de 16, 58 de 64, 75 de 256 a zoom 0,35; 128 →
     * 195 a zoom 1— y lo que ahorra en JS es un milisegundo (1,5 → 0,3).
     * Es lo mismo que `DEF-109` midió con un único path (68 contra 20 ms).
     */
    const discosPorColor = new Map<string, SimNode[]>();
    const pintarRapido = (c: CanvasRenderingContext2D) => {
      calcularVisible(false);
      conFlujo = false;
      nVisibles = 0;
      c.strokeStyle = colEdge;
      c.lineWidth = 1.1 / scale;
      let hayLit = false;
      for (const e of simEdges) {
        if (!revealed(e.s) || !revealed(e.t)) continue;
        if (fueraDeVista(e)) continue;
        if (hover && (e.s === hover || e.t === hover)) {
          hayLit = true;
          continue; // se dibujan después, resaltadas
        }
        controlDe(e);
        c.beginPath();
        c.moveTo(e.s.x, e.s.y);
        c.quadraticCurveTo(ctrlX, ctrlY, e.t.x, e.t.y);
        c.stroke();
      }
      if (hayLit && hover) {
        // Resaltadas por color y ancho, sin el halo (`shadowBlur`) del reposo.
        c.strokeStyle = colEdgeLit;
        c.lineWidth = (1.2 + 0.9 * hoverGlowRef.current) / scale;
        for (const e of simEdges) {
          if (e.s !== hover && e.t !== hover) continue;
          if (!revealed(e.s) || !revealed(e.t)) continue;
          controlDe(e);
          c.beginPath();
          c.moveTo(e.s.x, e.s.y);
          c.quadraticCurveTo(ctrlX, ctrlY, e.t.x, e.t.y);
          c.stroke();
        }
      }

      for (const lista of discosPorColor.values()) lista.length = 0;
      for (const n of sim) {
        if (!revealed(n) || !dentro(n.x, n.y)) continue;
        const isWhite = n.id === centerId || n === hover;
        const refsFocus = !isWhite && focusRefs.has(n.id);
        const fill = isWhite
          ? colCenter
          : refsFocus
            ? colAccent
            : (nodeColorsRef.current?.get(n.id) ?? colNode);
        const lista = discosPorColor.get(fill);
        if (lista) lista.push(n);
        else discosPorColor.set(fill, [n]);
      }
      for (const [fill, lista] of discosPorColor) {
        if (lista.length === 0) continue;
        c.fillStyle = fill;
        for (const n of lista) {
          c.beginPath();
          c.arc(n.x, n.y, n.r, 0, Math.PI * 2);
          c.fill();
        }
      }
      pintarNombres(c, true);
    };

    /** Copia las capas del reposo al lienzo, llevadas a la vista de ahora. */
    const componerCapas = (flujo: boolean) => {
      const W = canvas.width / dpr;
      const H = canvas.height / dpr;
      const ahora: Vista = { scale, ox, oy };
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      if (!capaUnica) copiarCapa(ctx, capaAristas, vistaPintada, ahora, W, H, margenX, margenY, dpr);
      if (flujo) {
        aplicarVista(ctx, canvas.width, canvas.height);
        pintarFlujo(ctx);
        ctx.setTransform(1, 0, 0, 1, 0, 0);
      }
      copiarCapa(ctx, capaNodos, vistaPintada, ahora, W, H, margenX, margenY, dpr);
      lienzoVista = ahora;
      lienzoAlDia = !flujo;
    };

    /**
     * Un frame del cúmulo. `modo`:
     * - `"rapido"`: el grafo se mueve (Parte C): fidelidad de movimiento, directo.
     * - `"directo"`: simulación activa sin fidelidad reducida (grafos chicos,
     *   simulación continua ya casi quieta): directo, completo, sin capas.
     * - `"reposo"`: nada se mueve: las capas, a fidelidad completa. Durante un
     *   paneo o un zoom con rueda solo se copian (Parte D).
     */
    const draw = (modo: "rapido" | "directo" | "reposo") => {
      const w = canvas.width;
      const h = canvas.height;
      // Un lienzo sin tamaño (panel colapsado) no se dibuja: `drawImage` de una
      // capa de 0 px lanza una excepción.
      if (w === 0 || h === 0) return;
      if (modo !== "reposo") {
        // En movimiento se pinta directo con la vista de ahora: la cámara
        // entra con el próximo lote de posiciones.
        if (camaraMovida()) ensuciar();
        // Nada cambió y nada se anima (p. ej. el lote siguiente del worker
        // todavía no llegó): el lienzo ya muestra lo último.
        if (!sucioEstatico && (modo === "rapido" || !conFlujo)) return;
        prepararLienzo(ctx, w, h);
        if (modo === "rapido") {
          pintarRapido(ctx);
        } else {
          pintarAristas(ctx, false);
          if (conFlujo) pintarFlujo(ctx);
          pintarNodos(ctx);
        }
        marcarVistaPintada();
        sucioEstatico = false;
        capasVigentes = false;
        lienzoAlDia = false;
        return;
      }
      if (!actx || !nctx) return;
      // Reposo. Fuera de un gesto, la cámara movida (fin de un paneo o de la
      // rueda) es un repintado completo; dentro, las capas se copian llevadas
      // a la vista de ahora, sin el flujo, y nada se repinta (Parte D).
      const gesto = enGesto();
      if (!gesto && camaraMovida()) ensuciar();
      if (sucioEstatico || !capasVigentes) {
        // Las capas solo se separan si el flujo animado va entre aristas y
        // nodos; si no se puede ver (opción, movimiento reducido, zoom o más de
        // `FLUJO_MAX_ARISTAS` a la vista), todo va a una sola capa.
        const dir = edgeDirectionRef.current;
        const flujoPosible =
          !reducido &&
          (dir === "animated" || dir === "both") &&
          scale >= FLUJO_ZOOM_MIN &&
          aristasALaVista() <= FLUJO_MAX_ARISTAS;
        const cw = capaNodos.width;
        const ch = capaNodos.height;
        if (flujoPosible) {
          prepararLienzo(actx, cw, ch);
          pintarAristas(actx, true, true);
          prepararLienzo(nctx, cw, ch);
          pintarNodos(nctx);
          capaUnica = false;
        } else {
          prepararLienzo(nctx, cw, ch);
          pintarAristas(nctx, true, false);
          pintarNodos(nctx);
          capaUnica = true;
        }
        marcarVistaPintada();
        sucioEstatico = false;
        capasVigentes = true;
        lienzoAlDia = false;
      }
      // El flujo solo se anima con el lienzo en la vista de las capas.
      const flujo = conFlujo && !gesto && !camaraMovida();
      if (
        !flujo &&
        lienzoAlDia &&
        lienzoVista.scale === scale &&
        lienzoVista.ox === ox &&
        lienzoVista.oy === oy
      ) {
        return; // el lienzo ya muestra las capas en esta vista y nada se anima
      }
      componerCapas(flujo);
    };

    // Construcción temporal con física (cúmulo y sustrato): colocar los nodos
    // recién aparecidos (en orden de creación) y dar energía para que el grafo
    // se reacomode al crecer.
    const avanzarConstruccion = (rc: number | null | undefined) => {
      if (rc != null) {
        if (prevRc == null) {
          // (re)inicio: crecer desde cero
          activated.clear();
          mascaraActivos.fill(0);
        }
        const target = Math.min(rc, orderedSim.length);
        while (activated.size < target) placeNew(orderedSim[activated.size]);
        if (rc !== prevRc) {
          // Solo simulan los nodos ya aparecidos, así el grafo se reacomoda
          // mientras crece (en vez de estar todo prefijado).
          motor?.activos(mascaraActivos);
          calentarMotor(ALPHA_NUEVOS);
        }
      } else if (prevRc != null) {
        // Fin de la construcción: vuelven a participar todos.
        motor?.activos(null);
        calentarMotor(ALPHA_NUEVOS);
      }
    };

    // ── Disposiciones micelio (`FUN-L-23`): capa estática + sobrecapa. Todo lo
    //    de acá abajo hasta `tickMicelio` es inerte cuando `disposicion` es el
    //    cúmulo, que sigue con `draw` y `tick` de siempre. ──
    const estatico = document.createElement("canvas");
    const sctx = estatico.getContext("2d");
    const sobre = document.createElement("canvas");
    const octx = sobre.getContext("2d");
    /** La sobrecapa (foco y nombres) ya no muestra lo último. */
    let sucioSobre = true;
    /** Sustrato: lo último de la capa estática se pintó con fidelidad de movimiento. */
    let capaRapida = false;
    /** Sustrato: llegaron posiciones que la capa todavía no muestra. */
    let posNuevas = false;
    /** Sustrato en movimiento: cuándo se repintó la capa por última vez. */
    let ultimoRepintado = -Infinity;
    /**
     * Fidelidad de movimiento mientras el grafo se mueve (Partes C y D): solo
     * en grafos grandes. En el mini-grafo del panel el asentamiento dura unos
     * pocos frames y alternar discos y sprites se vería como un parpadeo.
     */
    const reducible = N >= MIN_NODOS_WORKER;
    /** El dibujo anterior pasó el presupuesto: el próximo lote de posiciones se salta. */
    let saltarDibujo = false;
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
            rapido: false,
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

    const dibujarMicelio = (ahora: number, rapido: boolean) => {
      if (!escena || !sctx || !octx) return;
      const W = canvas.width / dpr;
      const H = canvas.height / dpr;
      // Un lienzo sin tamaño (panel colapsado) no se dibuja: `drawImage` de una
      // capa de 0 px lanza una excepción.
      if (canvas.width === 0 || canvas.height === 0) return;
      escena.limiteRango = revealCountRef.current ?? Infinity;
      escena.colores = nodeColorsRef.current;
      escena.reducido = reducido;
      // La capa estática solo se repinta si algo la ensució; queda sucia
      // mientras alguna hifa siga creciendo. Se pinta con su margen y con la
      // vista de ahora, que pasa a ser la de las dos capas.
      if (sucioEstatico) {
        if (fisica) sincronizarPos();
        escena.rapido = rapido;
        marcarVistaPintada();
        const camCapa: Camara = { scale, ox, oy, ancho: W + 2 * margenX, alto: H + 2 * margenY, dpr };
        sucioEstatico = dibujarCapaEstatica(sctx, escena, camCapa, paleta, ahora);
        capaRapida = rapido;
        sucioSobre = true;
      }
      // La sobrecapa (foco y nombres) va con la misma vista que la estática, así
      // las dos se copian juntas aunque el cursor cambie el foco en un gesto.
      if (sucioSobre) {
        const camSobre: Camara = { ...vistaPintada, ancho: W, alto: H, dpr };
        dibujarSobrecapa(
          octx,
          escena,
          camSobre,
          margenX,
          margenY,
          paleta,
          focoActual(),
          modoNombresRef.current,
          hubs,
        );
        sucioSobre = false;
        lienzoAlDia = false;
      }
      if (lienzoAlDia && lienzoVista.scale === scale && lienzoVista.ox === ox && lienzoVista.oy === oy) {
        return; // el lienzo ya muestra las dos capas en esta vista
      }
      const vistaAhora: Vista = { scale, ox, oy };
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      copiarCapa(ctx, estatico, vistaPintada, vistaAhora, W, H, margenX, margenY, dpr);
      copiarCapa(ctx, sobre, vistaPintada, vistaAhora, W, H, margenX, margenY, dpr);
      lienzoVista = vistaAhora;
      lienzoAlDia = true;
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
      let rapido = false;
      if (fisica) {
        // Sustrato: el mismo reposo con período de gracia que el cúmulo.
        const interacting = !!dragNode || panning;
        const moviendo = !!dragNode || !!motor?.corriendo;
        if (interacting || moviendo) lastEnergetic = ahora;
        activo = moviendo || ahora - lastEnergetic <= IDLE_GRACE_MS;
        if (simulate() || movidoAMano) posNuevas = true;
        movidoAMano = false;
        // En movimiento, fidelidad de movimiento (Parte D); la simulación
        // continua, ya casi quieta, vuelve a la completa (si no, no se vería).
        const casiQuieto = continuousSim && !dragNode && (motor?.alpha ?? 0) < 0.05;
        rapido = moviendo && reducible && !casiQuieto;
        if (posNuevas) {
          if (!rapido) {
            ensuciar();
          } else if (ahora - ultimoRepintado >= INTERVALO_SUSTRATO_MS) {
            // Repintado acotado (Parte D): como mucho ~30 fps, y si el último
            // pasó el presupuesto este lote se salta (la física no se entera:
            // sigue en el worker). Entre repintados el hilo principal no dibuja.
            if (saltarDibujo) {
              saltarDibujo = false;
              ultimoRepintado = ahora;
            } else {
              ensuciar();
            }
          }
        }
        // Lo último se pintó en movimiento y ya no se mueve: fidelidad completa.
        if (capaRapida && !rapido) ensuciar();
      }
      // Fuera de un gesto, la cámara movida (fin de un paneo o de la rueda) es
      // un repintado completo; dentro, las capas solo se copian (Parte D).
      if (!enGesto() && camaraMovida()) ensuciar();
      if (visible) {
        const repinta = sucioEstatico;
        const t0 = performance.now();
        dibujarMicelio(ahora, rapido);
        if (repinta) {
          posNuevas = false;
          if (rapido) {
            ultimoRepintado = ahora;
            saltarDibujo = performance.now() - t0 > PRESUPUESTO_DIBUJO_MS;
          }
        }
      }
      // Sin física activa ni hifas creciendo no hay frame siguiente: en reposo
      // no corre `requestAnimationFrame`; la capa estática se queda como está
      // hasta la próxima interacción.
      if (activo || posNuevas || (visible && sucioEstatico)) frame = requestAnimationFrame(tickMicelio);
    };

    const tick = () => {
      frame = 0;
      if (!running || !canvas.isConnected) return;
      const rc = revealCountRef.current;
      avanzarConstruccion(rc);
      prevRc = rc ?? null;
      const now = performance.now();
      const interacting = !!dragNode || panning;
      // El motor simula (worker o hilo principal) o se arrastra un nodo.
      const moviendo = !!dragNode || !!motor?.corriendo;
      // Mientras haya movimiento o interacción, se reinicia el contador de reposo.
      if (interacting || moviendo) lastEnergetic = now;
      // Bloqueo (por defecto): tras asentarse (el motor avisa) y pasar el
      // período de gracia, se detiene. Con `continuousSim` el motor no se
      // asienta nunca: nunca para.
      const active = moviendo || now - lastEnergetic <= IDLE_GRACE_MS;
      // Los nodos se movieron (pasos locales, posiciones del worker que
      // llegaron —incluso con el bucle ya en reposo— o el nodo arrastrado): la
      // capa ya no vale.
      const movio = simulate() || movidoAMano;
      movidoAMano = false;
      if (movio) ensuciar();
      // Oculto no se dibuja: ocultarlo cambia su tamaño, eso le da energía a la
      // simulación, y dibujaba cada frame sin que nadie lo viera. Al volver a
      // verse, el observador lo despierta y el primer frame ya lo pinta.
      if (visible) {
        // En movimiento, fidelidad reducida; la simulación continua, ya casi
        // quieta, vuelve a la completa (si no, no se vería nunca).
        const casiQuieto = continuousSim && !dragNode && (motor?.alpha ?? 0) < 0.05;
        const modo = !moviendo ? "reposo" : reducible && !casiQuieto ? "rapido" : "directo";
        if (movio && saltarDibujo && modo !== "reposo") {
          // Presupuesto adaptativo: el dibujo anterior fue lento, así que este
          // lote de posiciones no se pinta (queda sucio: va en el próximo). La
          // física no se entera: sigue libre en el worker.
          saltarDibujo = false;
        } else {
          const t0 = performance.now();
          draw(modo);
          saltarDibujo = modo !== "reposo" && performance.now() - t0 > PRESUPUESTO_DIBUJO_MS;
        }
      }
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
      clearTimeout(temporizadorRueda);
      motor?.cerrar(); // termina el worker, si lo hay
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
