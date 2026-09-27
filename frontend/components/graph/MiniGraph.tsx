"use client";

import { useEffect, useRef } from "react";
import { usePreferencesStore } from "@/stores/preferencesStore";
import { usePrefVault } from "@/stores/prefsVaultStore";
import {
  RECT_VACIO,
  type Rect,
  adyacencia,
  aristasQueTocan,
  conjuntoActivo,
  indicesActivos,
  recortarRect,
  rectSucio,
  rectVacio,
  unirRect,
} from "./arrastreLocal";
import { ALPHA_CACHE, ALPHA_NUEVOS, sembrarFilotaxis } from "./cicloFisica";
import { type EstadoFisica, constantesCumulo, crearEstado } from "./fisica";
import { MIN_NODOS_WORKER, type MotorFisica, crearMotor } from "./motorFisica";
import {
  BANDA_NIEBLA,
  anillosNiebla,
  progresoRevelado,
  radioMaximo,
  suavizar,
} from "./revelado";

export type GraphNode = {
  id: string;
  titulo: string;
  conexiones: number;
  tags?: string[];
  creadoEn?: string;
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

/**
 * Construcción temporal (worker libre): si un frame de dibujo en movimiento
 * pasó de esto, el siguiente se salta. Con el ritmo «pedido» de la Parte E
 * (residual y arrastre) no se saltea nada: cada paso de física es un frame.
 */
const PRESUPUESTO_DIBUJO_MS = 12;
/** Nombres que se ven mientras el grafo se mueve: los de más enlaces. */
const HUBS_CON_NOMBRE = 24;
/**
 * Física residual (Parte E): por debajo de este desplazamiento en pantalla
 * (ningún nodo se movió medio píxel desde el último dibujo) el paso no se
 * repinta: el dibujo sería idéntico. Al asentarse se pinta igual, exacto.
 */
const RESIDUAL_MIN_PX = 0.5;

/**
 * Arrastre local (Parte F): al arrastrar un nodo solo se mueven él, sus
 * vecinos a uno y dos saltos y los que están a menos de `RADIO_LOCAL_K · k`;
 * el resto queda congelado (ver `arrastreLocal.ts`). El conjunto se recalcula
 * cuando el nodo arrastrado se aleja `RECALCULO_LOCAL_K · k` de donde se
 * calculó.
 */
const RADIO_LOCAL_K = 3;
const RECALCULO_LOCAL_K = 1;
/**
 * Al recalcular, los que entran al conjunto se recortan de la base (repintado
 * parcial) y los que salen se siguen dibujando aparte, quietos: lo dibujado
 * solo crece. Cuando pasa de `MAX_DIBUJADOS_K` veces el conjunto activo, la
 * base se repinta entera con el conjunto de ahora (medido: repintar la base
 * completa es un frame caro —rasterizar la capa entera—, y a cada `k` de
 * recorrido eran varios por segundo).
 */
const MAX_DIBUJADOS_K = 2;

/**
 * Margen por lado de las capas offscreen, como fracción del lienzo (Parte D).
 * Mientras dura un paneo el lienzo solo copia las capas desplazadas; el margen
 * es lo que se ve en los bordes en vez de un hueco vacío, hasta el repintado
 * del final del gesto.
 */
const MARGEN_CAPA = 0.25;

/** Zoom y desplazamiento con que se pintó una capa (o el de ahora). */
type Vista = { scale: number; ox: number; oy: number };

/**
 * Copia una capa con margen al lienzo visible, llevándola de la vista con que se
 * pintó a la de ahora: desplazada si cambió el desplazamiento, escalada alrededor
 * del mismo punto del mundo si cambió el zoom. Con las dos vistas iguales es una
 * copia exacta, píxel a píxel (el margen es un número entero de píxeles reales).
 *
 * `ancho`/`alto` son los del lienzo visible en píxeles CSS; `mx`/`my`, el margen
 * de la capa por lado, también en píxeles CSS.
 */
function copiarCapa(
  c: CanvasRenderingContext2D,
  capa: HTMLCanvasElement,
  pintada: Vista,
  ahora: Vista,
  ancho: number,
  alto: number,
  mx: number,
  my: number,
  dpr: number,
) {
  // Un punto de la capa en (lx, ly) cae, con la vista pintada, en el píxel
  // (lx − mx·dpr) del lienzo; de ahí se lleva a la vista de ahora.
  const k = ahora.scale / pintada.scale;
  const tx = dpr * (ancho / 2 + ahora.ox) - k * dpr * (ancho / 2 + pintada.ox + mx);
  const ty = dpr * (alto / 2 + ahora.oy) - k * dpr * (alto / 2 + pintada.oy + my);
  // Solo el trozo de la capa que cae en el lienzo: copiar la capa entera, con
  // su margen, es mover más del doble de píxeles para nada.
  const w = c.canvas.width;
  const h = c.canvas.height;
  const sx0 = Math.max(0, Math.floor(-tx / k));
  const sy0 = Math.max(0, Math.floor(-ty / k));
  const sx1 = Math.min(capa.width, Math.ceil((w - tx) / k));
  const sy1 = Math.min(capa.height, Math.ceil((h - ty) / k));
  if (sx1 <= sx0 || sy1 <= sy0) return;
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.drawImage(
    capa,
    sx0,
    sy0,
    sx1 - sx0,
    sy1 - sy0,
    tx + sx0 * k,
    ty + sy0 * k,
    (sx1 - sx0) * k,
    (sy1 - sy0) * k,
  );
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
}: {
  nodes: GraphNode[];
  edges: GraphEdge[];
  centerId: string | null;
  onOpen: (id: string) => void;
  /** Color por id según los grupos de color del usuario (sobrescribe el glow). */
  nodeColors?: Map<string, string>;
  /** Construcción temporal: solo se dibujan los primeros `revealCount` nodos en
   *  orden de creación (y sus aristas). `null`/`undefined` = mostrar todo. */
  revealCount?: number | null;
  /** Posiciones cacheadas por id: arrancar asentado en vez de re-simular desde cero. */
  initialPositions?: Record<string, { x: number; y: number }>;
  /** Devuelve las posiciones actuales al desmontar/recalcular, para cachearlas. */
  onPositions?: (positions: Record<string, { x: number; y: number }>) => void;
  /** Getter de la vista (zoom/pan) cacheada — se lee al (re)iniciar la simulación. */
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

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Las callbacks de guardado se capturan al montar: el cleanup guarda con
    // las de este montaje, no con las que la ref tenga cuando corra.
    const guardarPosiciones = onPositionsRef.current;
    const guardarVista = onViewRef.current;

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
      return n.id === centerId ? base + 3 : base;
    };
    /** Nodos sin posición en la caché: se siembran más abajo. */
    const sinSembrar: number[] = [];
    const sim: SimNode[] = nodes.map((n, i) => {
      const cached = saved?.[n.id];
      if (cached && n.id !== centerId) {
        savedCount++;
        return { ...n, x: cached.x, y: cached.y, i, r: radioDe(n) };
      }
      sinSembrar.push(i); // se siembra más abajo (filotaxis)
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
    const rankById = new Map(
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

    // Constantes del motor (`fisica.ts`).
    const constantes = constantesCumulo();

    // ── Siembra (`FUN-L-25` · Parte C). Los nodos sin caché que tienen algún
    //    vecino con posición nacen junto a ellos (como en la construcción
    //    temporal); el resto, en filotaxis alrededor del origen, con el nodo
    //    central primero y después los de más enlaces. Antes nacían todos en un
    //    una corona de radio 50–140 y el grafo pasaba cientos de pasos
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
    // ── Arrastre local (`FUN-L-25` · Parte F). Mientras dura, `local` es la
    //    máscara de los activos (1 = se integra); los congelados no se mueven
    //    (`EstadoFisica.moviles`) y viven en la base, pintada SIN los
    //    `dibujados` (`pintarBase`). Cada frame se rehace solo el rectángulo
    //    que envuelve a los dibujados y sus aristas. ──
    const ady = adyacencia(N, estado.aristas);
    const radios = Float64Array.from(sim, (n) => n.r);
    const mascaraLocal = new Uint8Array(N);
    /** Máscara de la física (los que se integran), o `null` sin arrastre local. */
    let local: Uint8Array | null = null;
    /**
     * Los que NO están en la base y se dibujan cada frame: los activos y los
     * que lo fueron desde el último repintado completo de la base (quietos).
     */
    const dibujados = new Uint8Array(N);
    let nodosLocales: Int32Array = new Int32Array(0);
    /** Índices en `simEdges` de las aristas que tocan un dibujado. */
    let aristasLocales: Int32Array = new Int32Array(0);
    /** Entraron al conjunto y siguen pintados en la base: hay que recortarlos. */
    const entrantes: number[] = [];
    /** Dónde estaba el nodo arrastrado al calcular el conjunto. */
    let puntoLocalX = 0;
    let puntoLocalY = 0;
    /** Las capas no tienen la base de este conjunto (arranque, recálculo, vista, tamaño). */
    let baseSucia = false;
    /** Lo que ocupó en el lienzo el dibujo local del frame anterior (hay que borrarlo). */
    let rectPrevio: Rect = RECT_VACIO;
    /** Ancho en px del nombre de cada activo que lo lleva (−1 = sin nombre). */
    const anchoLocal = new Float32Array(N).fill(-1);
    /**
     * Fase del cúmulo (`FUN-L-25` · Parte E). Sin caché de posiciones el grafo
     * se calcula entero ANTES de dibujarse (`precalculo`: el lienzo queda
     * vacío y el motor no entrega posiciones intermedias) y recién ahí se
     * muestra, ya ubicado, con un fundido radial desde el centro (`revelado`,
     * ver `revelado.ts`). Antes se dibujaba cada lote del asentamiento, y ese
     * movimiento masivo era lo caro y lo que se veía mal. Con caché (aunque
     * sea parcial) se arranca directo en `vivo`, sin fundido.
     */
    let fase: "precalculo" | "revelado" | "vivo" = "vivo";
    /** Cuándo empezó el fundido (tras pintar la capa), o `null` si todavía no. */
    let inicioRevelado: number | null = null;
    let panning = false;
    // Capas estáticas (`FUN-L-25`): se vuelven a pintar solo cuando algo las
    // ensucia (vista, tamaño, nodos que se mueven, el foco, lo revelado,
    // colores u opciones).
    let sucioEstatico = true;
    const ensuciar = () => {
      sucioEstatico = true;
    };
    // ── La cámara nunca repinta a mitad de gesto (`FUN-L-25` · Parte D). Las
    //    capas llevan un margen por lado (`margenX`/`margenY`, en px CSS) y recuerdan
    //    la vista con que se pintaron; mientras se panea, el lienzo las copia
    //    desplazadas a la vista de ahora (`copiarCapa`) y el repintado completo
    //    llega al soltar. Antes cada evento de paneo repintaba el grafo entero.
    //    El zoom con rueda, en cambio, repinta nítido en cada paso (Parte E,
    //    decisión del usuario): la copia escalada de la Parte D se veía borrosa
    //    hasta 150 ms después del último paso. ──
    let margenX = 0;
    let margenY = 0;
    /** Vista con que se pintó lo último (las capas, o el lienzo en movimiento). */
    let vistaPintada: Vista = { scale, ox, oy };
    const enGesto = () => panning;
    const camaraMovida = () =>
      scale !== vistaPintada.scale || ox !== vistaPintada.ox || oy !== vistaPintada.oy;
    /** Posiciones de los nodos en el último dibujo (`[x0, y0, …]` por índice del motor). */
    const posPintadas = new Float64Array(N * 2);
    /** Lo pintado pasa a ser lo de la vista de ahora (y las posiciones de ahora). */
    const marcarVistaPintada = () => {
      vistaPintada = { scale, ox, oy };
      for (const n of sim) {
        posPintadas[n.i * 2] = n.x;
        posPintadas[n.i * 2 + 1] = n.y;
      }
    };
    /** ¿Algún nodo se movió `RESIDUAL_MIN_PX` en pantalla desde el último dibujo? */
    const movidoALaVista = () => {
      const u = RESIDUAL_MIN_PX / scale;
      const u2 = u * u;
      for (const n of sim) {
        const dx = n.x - posPintadas[n.i * 2];
        const dy = n.y - posPintadas[n.i * 2 + 1];
        if (dx * dx + dy * dy >= u2) return true;
      }
      return false;
    };
    /** Posiciones que el ratón movió a mano (arrastre): van con el próximo lote. */
    let movidoAMano = false;
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
      if (running && frame === 0) frame = requestAnimationFrame(tick);
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
      capaAristas.width = capaNodos.width = canvas.width + 2 * mxDev;
      capaAristas.height = capaNodos.height = canvas.height + 2 * myDev;
      if (local) baseSucia = true; // redimensionar borra las capas
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
      // Mientras se precalcula no hay nodos a la vista: solo se puede panear.
      const n = fase === "vivo" ? pick(ev) : null;
      downAt = { x: ev.clientX, y: ev.clientY };
      if (n) {
        dragNode = n;
        // El motor sube la energía mientras dure (`alphaObjetivo` 0,3).
        arrancarCorrida();
        motor?.fijar(n.i, n.x, n.y);
        // Arrastre local (Parte F), solo en grafos grandes y fuera de la
        // construcción temporal (que ya usa su propia máscara de activos). En
        // el mini-grafo del panel el arrastre sigue siendo global.
        if (reducible && revealCountRef.current == null) calcularLocal(n, true);
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
        // Se alejó `k` de donde se calculó el conjunto activo: otro conjunto.
        if (local) {
          const lejos = RECALCULO_LOCAL_K * constantes.k;
          const dx = p.x - puntoLocalX;
          const dy = p.y - puntoLocalY;
          if (dx * dx + dy * dy > lejos * lejos) calcularLocal(dragNode, false);
        }
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
      } else if (fase === "vivo") {
        const n = pick(ev);
        if (n !== hover) {
          hover = n;
          computeRefs(hover ?? centerNode); // foco = hover, o el centro si no hay
          canvas.style.cursor = n ? "pointer" : "grab";
          // Un redibujo para el resaltado de hover, que vive en la capa estática.
          ensuciar();
          wake();
        }
      }
    };
    const onMouseUp = (ev: MouseEvent) => {
      const moved =
        downAt && Math.hypot(ev.clientX - downAt.x, ev.clientY - downAt.y) > 4;
      if (dragNode && !moved) onOpenRef.current(dragNode.id);
      if (dragNode) {
        inicioCorrida = performance.now(); // «asentado en…» cuenta desde que se suelta
        motor?.soltar();
        if (local) terminarLocal();
        // Al soltar, de vuelta a la residual (Parte E): relajación corta con
        // energía baja, a un paso por frame. Antes bajaba desde 0,3 (248
        // pasos) con el worker libre. La construcción temporal sigue libre.
        if (revealCountRef.current == null) motor?.residual(ALPHA_CACHE);
      }
      dragNode = null;
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
      // Repintado nítido en el próximo frame: la cámara movida fuera de un
      // paneo ensucia las capas (Parte E; ya no se copian escaladas).
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
    const informar = centerId === null;
    let inicioCorrida = performance.now();
    motor = crearMotor(estado, constantes, {
      continuo: continuousSim,
      alRecibir: () => wake(),
      alAsentar: (pasos) => {
        if (fase === "precalculo") {
          // El layout está calculado: se revela, ya ubicado.
          if (informar) {
            const seg = (performance.now() - inicioCorrida) / 1000;
            console.info(`grafo: layout calculado en ${seg.toFixed(1)} s, ${pasos} pasos`);
          }
          fase = "revelado";
          inicioRevelado = null;
          ensuciar();
          wake();
          return;
        }
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
    /** Un arranque nuevo (el grafo estaba quieto): desde acá se cuenta el asentamiento. */
    function arrancarCorrida() {
      if (motor && !motor.corriendo) inicioCorrida = performance.now();
    }
    function calentarMotor(a: number) {
      arrancarCorrida();
      motor?.correr(a);
    }
    if (revealCountRef.current == null) {
      if (savedCount === 0) {
        // Sin caché: a ciegas hasta converger (Parte E).
        fase = "precalculo";
        arrancarCorrida();
        motor.precalcular(initialAlpha);
      } else {
        // Con caché: se muestra ya y se retoca con la física residual, a un
        // paso por frame dibujado (Parte E).
        arrancarCorrida();
        motor.residual(initialAlpha);
      }
    }
    /**
     * Física residual (Parte E): energía baja y un paso por frame dibujado,
     * sin saltos. Tras el revelado y al soltar un nodo.
     */
    function aResidual(alpha: number) {
      arrancarCorrida();
      motor?.residual(alpha);
    }

    /**
     * (Re)calcula el conjunto activo alrededor de `n` (Parte F, cambio 1) y se
     * lo pasa al motor: desde el próximo paso solo se integran esos. Las capas
     * se repintan sin ellos en el próximo frame (`pintarBase`).
     */
    function calcularLocal(n: SimNode, inicio: boolean) {
      conjuntoActivo(n.i, ady, estado.pos, N, RADIO_LOCAL_K * constantes.k, mascaraLocal);
      local = mascaraLocal;
      puntoLocalX = n.x;
      puntoLocalY = n.y;
      motor?.moviles(mascaraLocal);
      let activos = 0;
      let nuevos = 0;
      let yaDibujados = 0;
      for (let i = 0; i < N; i++) {
        activos += mascaraLocal[i];
        yaDibujados += dibujados[i];
        if (mascaraLocal[i] && !dibujados[i]) nuevos++;
      }
      if (inicio || baseSucia || yaDibujados + nuevos > MAX_DIBUJADOS_K * activos) {
        // Base entera, con el conjunto de ahora.
        dibujados.set(mascaraLocal);
        entrantes.length = 0;
        baseSucia = true;
      } else if (nuevos > 0) {
        // Los que entran se recortan de la base en el próximo frame.
        for (let i = 0; i < N; i++) {
          if (!mascaraLocal[i] || dibujados[i]) continue;
          dibujados[i] = 1;
          entrantes.push(i);
        }
      } else {
        return; // los que salen quedan quietos, dibujados aparte
      }
      nodosLocales = indicesActivos(dibujados);
      aristasLocales = aristasQueTocan(dibujados, estado.aristas);
    }

    /** Fin del arrastre local: todos vuelven a moverse y el próximo frame repinta todo. */
    function terminarLocal() {
      local = null;
      motor?.moviles(null);
      dibujados.fill(0);
      entrantes.length = 0;
      baseSucia = false;
      rectPrevio = RECT_VACIO;
      // Las capas tienen la base (sin los activos): no sirven para el reposo.
      capasVigentes = false;
      ensuciar();
    }

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
     * `excluir` (arrastre local): no pinta las aristas que tocan esos nodos.
     */
    const pintarAristas = (
      c: CanvasRenderingContext2D,
      conMargen: boolean,
      flujo?: boolean,
      excluir: Uint8Array | null = null,
    ) => {
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
        if (excluir && (excluir[e.s.i] || excluir[e.t.i])) continue;
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

    /**
     * Pasada 3: flechas, nodos y nombres (usa la geometría de la pasada 1).
     * `excluir` (arrastre local): ni los discos ni los nombres de esos nodos.
     */
    const pintarNodos = (c: CanvasRenderingContext2D, excluir: Uint8Array | null = null) => {
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

      pintarDiscos(c, excluir);
      pintarNombres(c, false, excluir);
    };

    // ── Nodos: discos lisos, sin brillo ni sombra, en reposo y en movimiento
    //    (decisión del usuario del 2026-09-27, `DEF-109`). Antes, en reposo,
    //    cada nodo era un sprite con el círculo y su glow (`shadowBlur`) ya
    //    rasterizados. Blanco: el nodo central y el que está bajo el cursor.
    //    Acento: los que referencian al nodo en foco. Si no, el color del grupo
    //    (si tiene) o el glow del tema. Agrupados por color para no cambiar el
    //    relleno a cada nodo.
    //    En el arrastre local (Parte F), `excluir` deja fuera a los activos
    //    (la base) y `solo` pinta únicamente a ellos (cada frame). ──
    const discosPorColor = new Map<string, SimNode[]>();
    const pintarDiscos = (
      c: CanvasRenderingContext2D,
      excluir: Uint8Array | null = null,
      solo: Uint8Array | null = null,
    ) => {
      for (const lista of discosPorColor.values()) lista.length = 0;
      for (const n of sim) {
        if (!revealed(n)) continue; // construcción temporal: aún no apareció
        if (excluir && excluir[n.i]) continue;
        if (solo && !solo[n.i]) continue;
        if (!dentro(n.x, n.y)) continue; // culling
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
    };

    // ── Nombres (`FUN-M-21`; Parte C de `FUN-L-25`). Mientras el grafo se mueve
    //    solo se escriben los de los hubs, el apuntado y el centro (escribir los
    //    1.300 con `fillText` en cada frame era buena parte del frame); el resto
    //    aparece al asentarse, en la capa estática y sin pisarse: se escriben
    //    por importancia (apuntado, centro y después por enlaces, así los hubs
    //    ganan el sitio) y se salta el que caería encima de uno ya escrito, con
    //    una rejilla para no comparar todos contra todos. ──
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

    const prepararNombres = (c: CanvasRenderingContext2D) => {
      c.textAlign = "center";
      c.font = `${12 / scale}px ${fontFamily}`;
    };
    const escribirNombre = (c: CanvasRenderingContext2D, n: SimNode) => {
      c.fillStyle = n === hover || n.id === centerId ? colText2 : colText;
      c.fillText(n.titulo, n.x, n.y + n.r + 13 / scale);
    };
    /**
     * Quién llevó nombre en el último dibujo completo (no el de movimiento):
     * en el arrastre local, los activos conservan el suyo (Parte F).
     */
    const conNombre = new Uint8Array(N);
    /**
     * `excluir` (arrastre local): el reparto de sitios se hace con todos —así
     * los congelados quedan con los mismos nombres—, pero esos no se escriben.
     */
    const pintarNombres = (
      c: CanvasRenderingContext2D,
      soloDestacados: boolean,
      excluir: Uint8Array | null = null,
    ) => {
      // Qué nombres se dibujan. El foco es el nodo apuntado y, si no hay
      // ninguno, el centro del panel — el mismo criterio que usa el
      // resaltado, para que el nombre acompañe a lo que ya está destacado.
      const modo = modoNombresRef.current;
      const foco = hover ?? centerNode;
      // En «todos» sigue mandando el zoom: alejado, los nombres se amontonan
      // hasta ser ilegibles y solo se deja el del apuntado. Los otros dos modos
      // ya muestran pocos, así que no necesitan ese recorte.
      const showAll = scale > 0.5;
      prepararNombres(c);
      const escribir = (n: SimNode) => {
        if (!soloDestacados) conNombre[n.i] = 1;
        if (excluir && excluir[n.i]) return;
        escribirNombre(c, n);
      };
      if (!soloDestacados) conNombre.fill(0);
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
     * sin flujo ni flecha ni brillo; los mismos discos lisos del reposo; solo
     * los nombres destacados. Al asentarse se pinta una vez a fidelidad
     * completa. (La Parte C las trazaba rectas: el usuario lo rechazó, las
     * curvas son el estilo de Mycelium.)
     *
     * Un `stroke()` y un `fill()` por elemento, SIN agrupar en paths: medido
     * con la Tesina asentada (1.600 × 900 a dpr 1,5, rasterizado forzado),
     * agrupar los trazos empeora el rasterizado de forma monótona —35 ms uno
     * por arista, 45 en lotes de 16, 58 de 64, 75 de 256 a zoom 0,35; 128 →
     * 195 a zoom 1— y lo que ahorra en JS es un milisegundo (1,5 → 0,3).
     * Es lo mismo que `DEF-109` midió con un único path (68 contra 20 ms).
     */
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

      pintarDiscos(c);
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

    // ── Arrastre local (`FUN-L-25` · Parte F): dibujo por rectángulo sucio.
    //    Al empezar (y al recalcular el conjunto, o si cambia la vista o el
    //    tamaño) se pinta la BASE: una sola capa (`capaNodos`) con lo
    //    congelado —aristas entre congelados, discos y nombres— y SIN los
    //    activos. Cada frame, en el rectángulo que envuelve a los activos —el
    //    de ahora unido al del frame anterior, que hay que borrar—: se trazan
    //    las aristas que tocan un activo, encima se copia ese trozo de la base
    //    y encima van los discos y nombres activos. El resto del lienzo no se
    //    toca.
    //    - Base sin activos, y no tapar los activos viejos de la capa
    //      completa: taparlos exige repintar desde algo que no los tenga, que
    //      es esta misma base.
    //    - UNA capa y las aristas activas ANTES de copiarla (quedan bajo los
    //      discos congelados, como en el reposo): medido en Chromium, dos
    //      capas distintas de 3.600 × 2.025 copiadas en el mismo frame y algo
    //      dibujado después obligan a rasterizar el frame en el acto —el
    //      presupuesto de imágenes de lienzo retenidas—: 120–220 ms de JS por
    //      frame en vez de 3. ──

    /** Copia el trozo `r` (píxeles del lienzo) de una capa pintada con la vista de ahora. */
    const copiarTrozo = (capa: HTMLCanvasElement, r: Rect) => {
      const mx = Math.round(margenX * dpr);
      const my = Math.round(margenY * dpr);
      const w = r.x1 - r.x0;
      const h = r.y1 - r.y0;
      ctx.drawImage(capa, r.x0 + mx, r.y0 + my, w, h, r.x0, r.y0, w, h);
    };

    /** La base: lo congelado en `capaNodos`, sin los activos (con su margen, como el reposo). */
    const pintarBase = (activos: Uint8Array) => {
      if (!nctx) return;
      prepararLienzo(nctx, capaNodos.width, capaNodos.height);
      pintarAristas(nctx, true, false, activos);
      pintarNodos(nctx, activos);
      marcarVistaPintada();
      // Son la base del arrastre, no las del reposo: al soltar se repintan.
      capasVigentes = false;
      baseSucia = false;
      entrantes.length = 0;
      anchoLocal.fill(-1);
      medirNombres(nctx, nodosLocales);
    };

    /** Ancho (px) del nombre de cada uno de `ids` que lo lleva, para el rectángulo. */
    const medirNombres = (c: CanvasRenderingContext2D, ids: ArrayLike<number>) => {
      c.font = `${12 / scale}px ${fontFamily}`;
      for (let k = 0; k < ids.length; k++) {
        const i = ids[k];
        if (!conNombre[i]) continue;
        if (anchoNombre[i] < 0) anchoNombre[i] = c.measureText(sim[i].titulo).width * scale;
        anchoLocal[i] = anchoNombre[i];
      }
    };

    /**
     * Recorta de la base a los que entraron al conjunto (recálculo): repinta
     * la base SOLO en el rectángulo que ocupaban —ellos, sus nombres y sus
     * aristas, donde la base los tiene— con lo congelado que cae ahí.
     * Devuelve ese rectángulo, que el lienzo tiene que recomponer.
     */
    const recortarBase = (): Rect => {
      const ids = Int32Array.from(entrantes);
      entrantes.length = 0;
      if (!nctx) return RECT_VACIO;
      medirNombres(nctx, ids);
      const marca = new Uint8Array(N);
      for (const i of ids) marca[i] = 1;
      const W = canvas.width;
      const H = canvas.height;
      const rc = recortarRect(
        rectSucio(posPintadas, radios, anchoLocal, ids, estado.aristas, aristasQueTocan(marca, estado.aristas), {
          scale,
          ox,
          oy,
          dpr,
          ancho: W,
          alto: H,
        }),
        W,
        H,
      );
      if (rectVacio(rc)) return RECT_VACIO;
      const mx = Math.round(margenX * dpr);
      const my = Math.round(margenY * dpr);
      nctx.save();
      nctx.setTransform(1, 0, 0, 1, 0, 0);
      nctx.beginPath();
      nctx.rect(rc.x0 + mx, rc.y0 + my, rc.x1 - rc.x0, rc.y1 - rc.y0);
      nctx.clip();
      nctx.clearRect(rc.x0 + mx, rc.y0 + my, rc.x1 - rc.x0, rc.y1 - rc.y0);
      aplicarVista(nctx, capaNodos.width, capaNodos.height);
      // El recorte en coordenadas de mundo.
      const aMundoX = (px: number) => ((px - W / 2) / dpr - ox) / scale;
      const aMundoY = (py: number) => ((py - H / 2) / dpr - oy) / scale;
      pintarCongeladosEn(nctx, aMundoX(rc.x0), aMundoX(rc.x1), aMundoY(rc.y0), aMundoY(rc.y1));
      nctx.restore();
      return rc;
    };

    /**
     * Lo congelado (no `dibujados`) que toca el rectángulo de mundo, en el
     * orden de la base: aristas, flechas, discos y nombres. Mismo estilo que
     * `pintarAristas`/`pintarNodos`; los nombres son los que ya tenía la base
     * (`conNombre`), sin volver a repartir sitios.
     */
    const pintarCongeladosEn = (c: CanvasRenderingContext2D, l: number, r: number, t: number, b: number) => {
      const holgura = 3 / scale; // grosor del trazo y antialias
      const glow = hoverGlowRef.current;
      const dir = edgeDirectionRef.current;
      const conFlecha = dir === "arrow" || dir === "both" || (reducido && dir === "animated");
      const flechas: number[] = [];
      for (const e of simEdges) {
        if (!revealed(e.s) || !revealed(e.t)) continue;
        if (dibujados[e.s.i] || dibujados[e.t.i]) continue;
        controlDe(e);
        if (
          Math.max(e.s.x, e.t.x, ctrlX) < l - holgura ||
          Math.min(e.s.x, e.t.x, ctrlX) > r + holgura ||
          Math.max(e.s.y, e.t.y, ctrlY) < t - holgura ||
          Math.min(e.s.y, e.t.y, ctrlY) > b + holgura
        ) {
          continue;
        }
        const lit = hover && (e.s === hover || e.t === hover);
        c.strokeStyle = lit ? colEdgeLit : colEdge;
        c.lineWidth = (lit ? 1.2 + 0.9 * glow : 1.1) / scale;
        if (lit && glow > 0) {
          c.shadowColor = colEdgeLit;
          c.shadowBlur = (8 * glow) / scale;
        }
        c.beginPath();
        c.moveTo(e.s.x, e.s.y);
        c.quadraticCurveTo(ctrlX, ctrlY, e.t.x, e.t.y);
        c.stroke();
        c.shadowBlur = 0;
        if (conFlecha) flechas.push(e.s.x, e.s.y, ctrlX, ctrlY, e.t.x, e.t.y, lit ? 1 : 0);
      }
      const size = 6 / scale;
      for (let o = 0; o < flechas.length; o += 7) {
        const sx = flechas[o];
        const sy = flechas[o + 1];
        const tx = flechas[o + 4];
        const ty = flechas[o + 5];
        const bx = 0.25 * sx + 0.5 * flechas[o + 2] + 0.25 * tx;
        const by = 0.25 * sy + 0.5 * flechas[o + 3] + 0.25 * ty;
        const a = Math.atan2(ty - sy, tx - sx);
        c.fillStyle = flechas[o + 6] === 1 ? colEdgeLit : colEdge;
        c.beginPath();
        c.moveTo(bx + Math.cos(a) * size, by + Math.sin(a) * size);
        c.lineTo(bx + Math.cos(a + 2.6) * size, by + Math.sin(a + 2.6) * size);
        c.lineTo(bx + Math.cos(a - 2.6) * size, by + Math.sin(a - 2.6) * size);
        c.closePath();
        c.fill();
      }
      // Discos: `pintarDiscos` recorta con el rectángulo visible; se lo lleva
      // a este, ampliado en el radio máximo (un disco puede asomar al borde).
      const rMax = 18;
      visL = l - rMax;
      visR = r + rMax;
      visT = t - rMax;
      visB = b + rMax;
      pintarDiscos(c, dibujados);
      prepararNombres(c);
      for (const n of sim) {
        if (!conNombre[n.i] || dibujados[n.i] || !revealed(n)) continue;
        let w = anchoNombre[n.i];
        if (w < 0) {
          w = c.measureText(n.titulo).width * scale;
          anchoNombre[n.i] = w;
        }
        const mitad = w / 2 / scale;
        if (n.x + mitad < l || n.x - mitad > r || n.y + n.r + 17 / scale < t || n.y + n.r > b) continue;
        escribirNombre(c, n);
      }
    };

    /** Las aristas que tocan un activo, como en movimiento: curvas, sin flujo ni flecha ni halo. */
    const pintarAristasActivas = (c: CanvasRenderingContext2D) => {
      c.strokeStyle = colEdge;
      c.lineWidth = 1.1 / scale;
      let hayLit = false;
      for (const j of aristasLocales) {
        const e = simEdges[j];
        if (!revealed(e.s) || !revealed(e.t) || fueraDeVista(e)) continue;
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
      if (!hayLit || !hover) return;
      c.strokeStyle = colEdgeLit;
      c.lineWidth = (1.2 + 0.9 * hoverGlowRef.current) / scale;
      for (const j of aristasLocales) {
        const e = simEdges[j];
        if (e.s !== hover && e.t !== hover) continue;
        if (!revealed(e.s) || !revealed(e.t) || fueraDeVista(e)) continue;
        controlDe(e);
        c.beginPath();
        c.moveTo(e.s.x, e.s.y);
        c.quadraticCurveTo(ctrlX, ctrlY, e.t.x, e.t.y);
        c.stroke();
      }
    };

    /** Un frame del arrastre local: solo el rectángulo sucio. */
    const dibujarLocal = () => {
      const W = canvas.width;
      const H = canvas.height;
      let completo = false;
      /** Lo que la base cambió en este frame (recorte de los que entraron). */
      let recortado = RECT_VACIO;
      if (baseSucia || camaraMovida()) {
        pintarBase(dibujados);
        completo = true; // la base cambió: se recompone el lienzo entero
      } else if (entrantes.length > 0) {
        recortado = recortarBase();
      } else if (!sucioEstatico) {
        return; // nada se movió desde el último frame
      }
      sucioEstatico = false;
      lienzoAlDia = false;
      const ahora = recortarRect(
        rectSucio(estado.pos, radios, anchoLocal, nodosLocales, estado.aristas, aristasLocales, {
          scale,
          ox,
          oy,
          dpr,
          ancho: W,
          alto: H,
        }),
        W,
        H,
      );
      const r = completo
        ? { x0: 0, y0: 0, x1: W, y1: H }
        : unirRect(unirRect(ahora, rectPrevio), recortado);
      rectPrevio = ahora;
      if (rectVacio(r)) return;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(r.x0, r.y0, r.x1 - r.x0, r.y1 - r.y0);
      calcularVisible(false);
      aplicarVista(ctx, W, H);
      pintarAristasActivas(ctx);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      copiarTrozo(capaNodos, r);
      aplicarVista(ctx, W, H);
      pintarDiscos(ctx, null, dibujados);
      prepararNombres(ctx);
      for (const i of nodosLocales) {
        const n = sim[i];
        if (conNombre[i] && revealed(n) && dentroVista(n.x, n.y)) escribirNombre(ctx, n);
      }
    };

    /**
     * Un frame del cúmulo. `modo`:
     * - `"rapido"`: el grafo se mueve (Parte C): fidelidad de movimiento, directo.
     * - `"directo"`: simulación activa sin fidelidad reducida (grafos chicos,
     *   simulación continua ya casi quieta): directo, completo, sin capas.
     * - `"reposo"`: nada se mueve: las capas, a fidelidad completa. Durante un
     *   paneo solo se copian (Parte D); el zoom repinta (Parte E).
     * - `"local"`: arrastre local (Parte F): el rectángulo sucio sobre la base.
     */
    const draw = (modo: "rapido" | "directo" | "reposo" | "local") => {
      const w = canvas.width;
      const h = canvas.height;
      // Un lienzo sin tamaño (panel colapsado) no se dibuja: `drawImage` de una
      // capa de 0 px lanza una excepción.
      if (w === 0 || h === 0) return;
      if (modo === "local") {
        if (local && nctx) dibujarLocal();
        return;
      }
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
      if (!prepararCapas()) return;
      const gesto = enGesto();
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

    /**
     * Deja las capas del reposo al día (las repinta si algo las ensució).
     * Fuera de un paneo, la cámara movida (su final, o cada paso de rueda) es
     * un repintado completo; durante el paneo, las capas se copian llevadas a
     * la vista de ahora, sin el flujo, y nada se repinta (Parte D). `false` si no hay
     * contextos.
     */
    function prepararCapas(): boolean {
      if (!actx || !nctx) return false;
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
      return true;
    }

    /**
     * Un frame del revelado (Parte E): las capas —pintadas una vez— copiadas
     * dentro de un disco que crece desde el centro del grafo, con el borde
     * difuso en anillos de opacidad decreciente (`revelado.ts`). Nada más se
     * dibuja: son copias. `avance`: 0–1, sin suavizar.
     */
    const componerConNiebla = (avance: number) => {
      const W = canvas.width;
      const H = canvas.height;
      const ahora: Vista = { scale, ox, oy };
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, W, H);
      // El centro del grafo (el origen del mundo, adonde tira la gravedad) en
      // píxeles del lienzo.
      const cx = (W / dpr / 2 + ox) * dpr;
      const cy = (H / dpr / 2 + oy) * dpr;
      const rMax = radioMaximo(cx, cy, W, H);
      for (const a of anillosNiebla(suavizar(avance), rMax, rMax * BANDA_NIEBLA)) {
        ctx.save();
        ctx.beginPath();
        ctx.arc(cx, cy, a.exterior, 0, Math.PI * 2);
        if (a.interior > 0) ctx.arc(cx, cy, a.interior, 0, Math.PI * 2, true);
        ctx.clip();
        ctx.globalAlpha = a.alfa;
        const w = W / dpr;
        const h = H / dpr;
        if (!capaUnica) copiarCapa(ctx, capaAristas, vistaPintada, ahora, w, h, margenX, margenY, dpr);
        copiarCapa(ctx, capaNodos, vistaPintada, ahora, w, h, margenX, margenY, dpr);
        ctx.restore();
      }
      lienzoAlDia = false;
    };

    /**
     * Avanza el revelado un frame. El primero pinta las capas (el único dibujo
     * caro) y recién después arranca el reloj, así el fundido no empieza
     * adelantado. Con movimiento reducido no hay fundido: se muestra de una.
     * Devuelve `"sigue"`, `"espera"` (lienzo sin tamaño: el `resize` lo
     * despierta) o `"fin"`.
     */
    const pasoRevelado = (): "sigue" | "espera" | "fin" => {
      if (reducido) {
        terminarRevelado();
        return "fin";
      }
      if (canvas.width === 0 || canvas.height === 0 || !prepararCapas()) return "espera";
      if (inicioRevelado === null) {
        inicioRevelado = performance.now();
        componerConNiebla(0);
        return "sigue";
      }
      const avance = progresoRevelado(performance.now() - inicioRevelado);
      if (avance >= 1) {
        terminarRevelado();
        return "fin";
      }
      componerConNiebla(avance);
      return "sigue";
    };

    /** Fin del fundido: el grafo queda vivo y el próximo dibujo es el reposo normal. */
    function terminarRevelado() {
      if (informar) console.info("grafo: revelado");
      fase = "vivo";
      inicioRevelado = null;
      lienzoAlDia = false;
      // El grafo sigue apenas vivo (movimiento residual casi imperceptible).
      if (revealCountRef.current == null) aResidual(ALPHA_CACHE);
    }

    // Construcción temporal: colocar los nodos
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
          // Mientras crece, el worker corre libre (como antes de la Parte E).
          motor?.ritmo("libre");
          calentarMotor(ALPHA_NUEVOS);
        }
      } else if (prevRc != null) {
        // Fin de la construcción: vuelven a participar todos.
        motor?.activos(null);
        aResidual(ALPHA_NUEVOS);
      }
    };

    /**
     * Fidelidad de movimiento mientras el grafo se mueve (Partes C y D): solo
     * en grafos grandes. En el mini-grafo del panel el asentamiento dura unos
     * pocos frames y alternar nombres y flujo se vería como un parpadeo.
     */
    const reducible = N >= MIN_NODOS_WORKER;
    /** El dibujo anterior pasó el presupuesto: el próximo lote se salta (solo construcción). */
    let saltarDibujo = false;

    const tick = () => {
      frame = 0;
      if (!running || !canvas.isConnected) return;
      if (fase === "precalculo") {
        // Nada que dibujar: el lienzo queda vacío hasta que el layout converja.
        // Con el worker ni siquiera hace falta el frame (el aviso de
        // `alAsentar` lo despierta); en el hilo principal, cada frame da los
        // pasos de su presupuesto.
        if (motor && !motor.enWorker) {
          motor.avanzar();
          if (fase === "precalculo") frame = requestAnimationFrame(tick);
          else wake();
        }
        return;
      }
      if (fase === "revelado") {
        if (simulate()) ensuciar(); // las posiciones finales del precálculo
        // Oculto (o sin tamaño) el revelado espera: el observador o el
        // `resize` lo despiertan, y el fundido empieza cuando se ve.
        if (!visible) return;
        const r = pasoRevelado();
        if (r === "espera") return;
        if (r === "sigue") {
          frame = requestAnimationFrame(tick);
          return;
        }
        lastEnergetic = performance.now();
      }
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
      const aMano = movidoAMano;
      const movio = simulate() || aMano;
      movidoAMano = false;
      if (movio) {
        // En la residual el grafo se mueve fracciones de píxel por paso: si
        // ningún nodo se movió medio píxel desde el último dibujo, repintar
        // daría lo mismo. El paso de física se dio igual (Parte E).
        const residual =
          !aMano && !dragNode && revealCountRef.current == null && (motor?.alpha ?? 1) <= ALPHA_CACHE;
        if (!residual || movidoALaVista()) ensuciar();
      }
      // Oculto no se dibuja: ocultarlo cambia su tamaño, eso le da energía a la
      // simulación, y dibujaba cada frame sin que nadie lo viera. Al volver a
      // verse, el observador lo despierta y el primer frame ya lo pinta.
      if (visible) {
        // En movimiento, fidelidad reducida (arrastre, construcción, nodos
        // nuevos); con la energía residual (Parte E) o la simulación continua
        // ya casi quieta, la completa: el movimiento es apenas perceptible y
        // los nombres no deben desaparecer y volver.
        const casiQuieto = !dragNode && (motor?.alpha ?? 0) <= ALPHA_CACHE;
        const modo = local
          ? "local"
          : !moviendo
            ? "reposo"
            : reducible && !casiQuieto
              ? "rapido"
              : "directo";
        // Presupuesto adaptativo solo en la construcción temporal (worker
        // libre): el dibujo anterior fue lento, así que este lote no se pinta
        // (queda sucio: va en el próximo). En el arrastre y la residual el
        // worker da un paso por frame y todos se dibujan (Parte E).
        const libre = revealCountRef.current != null;
        if (movio && saltarDibujo && libre && modo !== "reposo") {
          saltarDibujo = false;
        } else {
          const t0 = performance.now();
          draw(modo);
          saltarDibujo =
            libre && modo !== "reposo" && performance.now() - t0 > PRESUPUESTO_DIBUJO_MS;
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
      motor?.cerrar(); // termina el worker, si lo hay
      // Guardar el layout actual para que el próximo montaje (cambio de pestaña)
      // o recálculo (datos nuevos) arranque asentado, sin re-simular desde cero.
      // A mitad del precálculo no hay layout que guardar: lo que tiene `sim`
      // es la siembra, y guardarlo haría arrancar desde ahí creyéndolo asentado.
      if (fase !== "precalculo") {
        const positions: Record<string, { x: number; y: number }> = {};
        for (const n of sim) positions[n.id] = { x: n.x, y: n.y };
        guardarPosiciones?.(positions);
      }
      // Conservar el zoom/pan para el próximo (re)montaje o recálculo.
      guardarVista?.({ scale, ox, oy });

      canvas.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
      canvas.removeEventListener("wheel", onWheel);
      ro.disconnect();
    };
  }, [nodes, edges, centerId, continuousSim, tema, modoOscuro]);

  return <canvas ref={canvasRef} style={{ display: "block", width: "100%", height: "100%" }} />;
}
