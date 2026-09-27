// Ciclo de asentamiento del cúmulo (`FUN-L-25` · Parte C, `DEF-109`).
//
// La física (`fisica.ts`) da UN paso; este módulo decide cuántos, con qué
// energía y cuándo parar, como `d3-force` (y el «Graph Worker» de Obsidian):
//
// - `alpha` se acerca a `objetivo` un `ALPHA_DECAY` por paso (`enfriar`): de 1
//   a `ALPHA_MIN` son 300 pasos. Al bajar de `ALPHA_MIN` con objetivo 0, el
//   grafo está asentado y el ciclo se detiene solo.
// - Arrastrar un nodo sube `objetivo` a 0,3 mientras dura (`fijar`/`soltar`):
//   el grafo sigue vivo alrededor del arrastre y se asienta al soltar.
// - `avanzarCiclo` da tantos pasos como quepan en un presupuesto de tiempo. El
//   worker lo llama en bucle, libre; el respaldo del hilo principal, una vez
//   por frame con 6 ms.
// - Precálculo a ciegas (Parte E): sin caché de posiciones, el grafo corre a
//   convergencia antes de dibujarse (`precalcular`), aunque la simulación sea
//   continua; después se revela ya ubicado.
//
// Módulo PURO (sin DOM): lo importan el worker, el respaldo del hilo principal
// y los tests headless. Aquí vive también la siembra en filotaxis.
import {
  ALPHA_MIN,
  type ConstantesFisica,
  type EstadoFisica,
  enfriar,
  paso,
} from "./fisica";

/** Energía mientras se arrastra un nodo (`alphaTarget(0.3)` de Obsidian). */
export const ALPHA_ARRASTRE = 0.3;
/** Energía con que se integran nodos nuevos (construcción temporal, caché parcial). */
export const ALPHA_NUEVOS = 0.3;
/** Energía al volver con la caché de posiciones completa: solo se retoca. */
export const ALPHA_CACHE = 0.05;
/**
 * Con la simulación continua (preferencia `graphContinuousSim`) la energía no
 * baja de acá: es la misma fuerza efectiva que el piso de 0,02 del ciclo viejo
 * (0,002 × la ganancia de `fisica.ts`).
 */
export const ALPHA_CONTINUO = 0.002;

export type Ciclo = {
  estado: EstadoFisica;
  constantes: ConstantesFisica;
  alpha: number;
  objetivo: number;
  /** Sin asentarse nunca (simulación continua). */
  continuo: boolean;
  /** ¿Hay que seguir dando pasos? */
  corriendo: boolean;
  /** Pasos desde el último arranque (para el aviso de «asentado»). */
  pasos: number;
};

export function crearCiclo(
  estado: EstadoFisica,
  constantes: ConstantesFisica,
  continuo = false,
): Ciclo {
  return {
    estado,
    constantes,
    alpha: 0,
    objetivo: continuo ? ALPHA_CONTINUO : 0,
    continuo,
    corriendo: false,
    pasos: 0,
  };
}

/** Le da energía (sin bajarla si ya tenía más) y lo pone a correr. */
export function calentar(c: Ciclo, alpha: number) {
  if (!c.corriendo) c.pasos = 0;
  c.alpha = Math.max(c.alpha, alpha);
  c.corriendo = true;
}

/** Arrastre: el nodo `i` queda en `(x, y)` y el grafo se mantiene con energía. */
export function fijar(c: Ciclo, i: number, x: number, y: number) {
  const e = c.estado;
  e.fijo = i;
  e.pos[i * 2] = x;
  e.pos[i * 2 + 1] = y;
  e.vel[i * 2] = 0;
  e.vel[i * 2 + 1] = 0;
  c.objetivo = Math.max(c.objetivo, ALPHA_ARRASTRE);
  calentar(c, ALPHA_ARRASTRE);
}

/** Fin del arrastre: la energía vuelve a bajar hacia 0 y el grafo se asienta. */
export function soltar(c: Ciclo) {
  c.estado.fijo = -1;
  c.objetivo = c.continuo ? ALPHA_CONTINUO : 0;
  c.pasos = 0; // el asentamiento se cuenta desde que se suelta
}

/**
 * Precálculo a ciegas (Parte E): energía `alpha` y objetivo 0, así el ciclo
 * se asienta solo aunque la simulación sea continua (que nunca baja de
 * `ALPHA_CONTINUO`). Nadie dibuja mientras tanto.
 */
export function precalcular(c: Ciclo, alpha: number) {
  c.objetivo = 0;
  calentar(c, alpha);
}

/**
 * Física residual (Parte E): energía baja fijada en `alpha` (no se suma a la
 * que tuviera: tras un arrastre también BAJA) con el objetivo de siempre. Es
 * lo que corre después del revelado y al soltar un nodo, a un paso por frame
 * dibujado (`paso` por pedido del hilo principal).
 */
export function residual(c: Ciclo, alpha: number) {
  if (!c.corriendo) c.pasos = 0;
  c.objetivo = c.continuo ? ALPHA_CONTINUO : 0;
  c.alpha = alpha;
  c.corriendo = true;
}

/** Un nodo que el hilo principal movió a mano (aparición): velocidad a 0. */
export function colocarEn(c: Ciclo, i: number, x: number, y: number) {
  const e = c.estado;
  e.pos[i * 2] = x;
  e.pos[i * 2 + 1] = y;
  e.vel[i * 2] = 0;
  e.vel[i * 2 + 1] = 0;
}

/**
 * Da pasos mientras quede presupuesto (al menos uno, hasta `maxPasos`) y el
 * ciclo no se haya asentado. Devuelve cuántos dio. `ahora` es el reloj (en el
 * worker y en el navegador, `performance.now`).
 */
export function avanzarCiclo(
  c: Ciclo,
  presupuestoMs: number,
  ahora: () => number,
  maxPasos = Infinity,
): number {
  if (!c.corriendo) return 0;
  const t0 = ahora();
  let dados = 0;
  do {
    paso(c.estado, c.constantes, c.alpha);
    c.alpha = enfriar(c.alpha, c.objetivo);
    c.pasos++;
    dados++;
    // Objetivo 0 solo lo tiene la simulación continua durante el precálculo.
    if (c.objetivo === 0 && c.alpha < ALPHA_MIN) {
      c.corriendo = false;
      break;
    }
  } while (dados < maxPasos && ahora() - t0 < presupuestoMs);
  return dados;
}

/** Ángulo áureo en radianes (`π·(3 − √5)`): el de la filotaxis de `d3-force`. */
const ANGULO_AUREO = Math.PI * (3 - Math.sqrt(5));

/**
 * Siembra en filotaxis (la de `d3-force`): el nodo `i` de `orden` va a radio
 * `k/4·√i` y ángulo `i·ángulo áureo`. Quedan repartidos en un disco sin
 * huecos ni amontonamientos, con poca energía que disipar —antes nacían todos
 * en un anillo de radio 50–140 y se expandían a empujones—. El primero cae en
 * el origen: `orden` pone ahí al nodo central (si lo hay) y después a los de
 * más enlaces, que es donde la gravedad los terminaría llevando.
 * Escribe en `pos` (intercaladas `[x0, y0, …]`) solo los nodos de `orden`.
 */
export function sembrarFilotaxis(pos: Float64Array, orden: ArrayLike<number>, k: number) {
  const paso = k / 4;
  for (let i = 0; i < orden.length; i++) {
    const u = orden[i];
    const r = paso * Math.sqrt(i);
    const a = i * ANGULO_AUREO;
    pos[u * 2] = Math.cos(a) * r;
    pos[u * 2 + 1] = Math.sin(a) * r;
  }
}
