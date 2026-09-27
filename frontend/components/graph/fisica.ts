// Motor de fuerzas del cúmulo (`FUN-L-25` · Parte B, `DEF-109`).
//
// Módulo PURO: sin DOM, sin React, sin imports. Lo usan el hilo principal
// (`MiniGraph.tsx`, como respaldo) y el worker (`sim.worker.ts`), y los tests
// headless lo transpilan y lo importan tal cual. Es la misma física que
// `simulate()` tenía dentro de `MiniGraph.tsx` —mismas constantes, mismo orden
// (repulsión, resortes, gravedad e integración)— con dos cambios de costo:
//
// - **Barnes-Hut**: la repulsión deja de comparar todos los pares (O(n²)) y usa
//   un quadtree con el centro de masa de cada celda (O(n log n)), con θ = 0,9
//   como `d3-force` y como el «Graph Worker» de Obsidian. Las hojas se calculan
//   par a par, exactamente como antes (incluido el desempate al azar de dos
//   nodos superpuestos).
// - **Repulsión acotada** (`distanciaMax`): lo que queda más lejos no se
//   calcula. Implementada pero apagada: ver `constantesCumulo` y por qué.
//
// Parte G (2026-09-27): las fuerzas pasan al modelo de `d3-force` —resortes
// normalizados por grado, `distanciaMin`, recentrado del conjunto—; las de
// antes quedan en `constantesAntes`.
//
// Los datos viven en arrays tipados (posiciones y velocidades intercaladas
// `[x0, y0, x1, y1, …]`, aristas `[s0, t0, s1, t1, …]`) para que el worker los
// reciba y devuelva sin objetos por nodo.

export type ConstantesFisica = {
  /**
   * Escala del cúmulo: la repulsión es `factorRepulsion·k²/d²`, la siembra en
   * filotaxis y el tope de velocidad se miden en `k`.
   */
  k: number;
  /**
   * Por debajo de esta distancia la repulsión deja de crecer (`distanceMin` de
   * `d3-force`): evita que dos nodos casi superpuestos salgan disparados. Es la
   * clamp de siempre expresada como distancia: el tope viejo de 8 con `k` 80
   * equivale a `80/√8 ≈ 28,3`.
   */
  distanciaMin: number;
  /** Multiplicador de la repulsión. */
  factorRepulsion: number;
  /** Criterio de Barnes-Hut: una celda de lado `w` a distancia `d` se aproxima si `w < θ·d`. */
  theta: number;
  /** Más allá de esta distancia no hay repulsión (`Infinity` = sin acotar). */
  distanciaMax: number;
  /** Largo de reposo de los resortes (`linkDistance`). */
  distanciaEnlace: number;
  /** Rigidez de un resorte entre dos nodos del mismo grado, por extremo. */
  rigidezEnlace: number;
  /**
   * Resortes como `forceLink` de `d3-force`: la fuerza de cada enlace es
   * `1/min(grado(s), grado(t))` y se reparte entre los extremos según el grado
   * del otro (el de menos enlaces se mueve más). Sin esto, un hub de 320
   * enlaces tira de sus vecinos con la fuerza de 320 resortes enteros y los
   * apila encima suyo.
   */
  normalizarGrado: boolean;
  /** Tirón de cada nodo hacia el origen, `pos·gravedad·alpha` (`forceX/forceY`). */
  gravedad: number;
  /**
   * Tras cada paso, traslada el conjunto para que su centroide quede en el
   * origen (`forceCenter`). No deforma el grafo: solo lo mantiene en su lugar.
   * No se aplica al mini-grafo, que ya se ancla con su nodo central.
   */
  recentrar: boolean;
  /**
   * Multiplica TODAS las fuerzas por igual (repulsión, resortes, gravedad y su
   * tope), así que no cambia dónde se equilibran: solo cuánto camina el grafo
   * por paso. Compensa que el ciclo de la Parte C da ~300 pasos y no ~1.000.
   */
  ganancia: number;
  /** Fracción de la velocidad que se pierde en cada paso (`velocityDecay` de `d3-force`). */
  rozamiento: number;
  /** Tope del desplazamiento de un nodo en un paso. */
  velocidadMax: number;
};

/**
 * Las fuerzas del cúmulo hasta la Parte F (las del `simulate()` de
 * `MiniGraph.tsx`): resortes iguales para todos (`0,01`), gravedad por nodo y
 * `k` 80 como distancia de reposo y como escala de la repulsión, con su tope de
 * 8 (`distanciaMin 80/√8`). Quedan como referencia para los tests y la réplica
 * de medición: el motor usa `constantesCumulo`.
 */
export function constantesAntes(): ConstantesFisica {
  return {
    k: 80,
    distanciaMin: 80 / Math.SQRT2 / 2,
    factorRepulsion: 1,
    theta: 0.9,
    distanciaMax: Infinity,
    distanciaEnlace: 80,
    rigidezEnlace: 0.01,
    normalizarGrado: false,
    gravedad: 0.004,
    recentrar: false,
    ganancia: GANANCIA,
    rozamiento: 0.4,
    velocidadMax: 80,
  };
}

/**
 * Constantes del cúmulo (`FUN-L-25` · Parte G, 2026-09-27): el modelo de
 * `d3-force`, para que las notas relacionadas se vean como grupos. Medido con
 * los grafos reales de la Tesina, Trabajo y Estudio y este repo (réplica en
 * Node; spec `docs/features/grafo-indice-y-motor.md` § Cómo quedó · Parte G).
 * Entre paréntesis, el valor del «Graph Worker» de Obsidian
 * (`docs/aprendizajes/Como construye Obsidian su grafo.md` § 3), que usa
 * otras unidades: su repulsión cae como `1/d` y la de acá como `1/d²`, así
 * que los números no se copian, se copia el modelo.
 *
 * - `normalizarGrado` (Obsidian: `linkStrength 1`, que `d3` divide por
 *   `min(grado)`): lo que agrupa. Un hub ya no tira de cada vecino con la
 *   fuerza de todos sus enlaces; sus vecinos se reparten alrededor y cada
 *   grupo se sostiene con sus propios enlaces.
 * - `rigidezEnlace` 0,07 (antes 0,01, sin normalizar): normalizada, una
 *   arista entre dos notas de grado 3 queda en `0,07/3`, más del doble de
 *   firme que antes, y la de un hub a una hoja tira de la hoja con 0,14 y del
 *   hub con 1/320 de eso. Con 0,01 normalizada el cúmulo se desarma (los
 *   enlaces pierden contra la repulsión). Con 0,1 agrupa apenas más, pero al
 *   arrastrar un hub su flor se mueve en bloque y barre a los nodos que cruza:
 *   en Trabajo y Estudio, 545 movimientos de más de 20 px por paso contra 23
 *   de antes. 0,07 es el punto medio: 57 (y 14 contra 89 en la Tesina).
 * - `distanciaEnlace` 80 (Obsidian 250): igual que antes; 50, 60 y 120 no
 *   agrupaban mejor.
 * - `distanciaMin` 30 (Obsidian 30): la clamp de siempre (28,3) redondeada al
 *   valor de Obsidian.
 * - `k` 80 y `factorRepulsion` 1 (Obsidian: `strength −1000`): igual que
 *   antes. El radio lo fija el cociente repulsión/centro: bajar los dos juntos
 *   (0,25 y 0,001) dio el mismo radio y el mismo agrupamiento.
 * - `gravedad` 0,003 (antes 0,004), el centro débil (Obsidian 0,1 como
 *   `forceX/forceY`; acá se multiplica por la ganancia: 0,036 por unidad de
 *   `alpha`). No se puede quitar: sin él los 559 nodos sin enlaces de la
 *   Tesina salen despedidos y el radio se duplica (933 → 1.871). A radio
 *   igual, más o menos centro no cambió el agrupamiento (medido de 0,001 a
 *   0,0083); se bajó un poco para que los resortes más firmes no achiquen
 *   el cúmulo (radio +7 % Tesina, +10 % Trabajo y Estudio, +6 % este repo).
 * - `recentrar` (`forceCenter`): el centroide vuelve al origen tras cada paso,
 *   que es donde nace el revelado de la Parte E.
 * - `distanciaMax` sin corte (Obsidian lo acota): medido en la Parte B, cortar
 *   a `4·k` achicaba el cúmulo un 30 % —el centro solo se equilibra con la
 *   SUMA de muchas repulsiones lejanas y débiles— y ahorraba un 10 % sobre
 *   Barnes-Hut. Queda implementado y probado, pero apagado.
 */
export function constantesCumulo(): ConstantesFisica {
  return {
    ...constantesAntes(),
    distanciaMin: 30,
    rigidezEnlace: 0.07,
    normalizarGrado: true,
    gravedad: 0.003,
    recentrar: true,
  };
}

/** Ver `ConstantesFisica.ganancia`; medido en la réplica (spec, «Cómo quedó · Parte C»). */
const GANANCIA = 12;

/** Por debajo de esta energía el grafo está asentado (`alphaMin` de `d3-force`). */
export const ALPHA_MIN = 0.001;
/** Decaimiento por paso: de 1 a `ALPHA_MIN` en 300 pasos (`alphaDecay` de `d3-force`). */
export const ALPHA_DECAY = 1 - Math.pow(ALPHA_MIN, 1 / 300);

/**
 * Enfriamiento por paso, como `d3-force`: la energía se acerca a `objetivo`
 * (0 al asentarse; 0,3 mientras se arrastra un nodo) un `ALPHA_DECAY` por paso.
 */
export function enfriar(alpha: number, objetivo = 0): number {
  return alpha + (objetivo - alpha) * ALPHA_DECAY;
}

/** Buffers del quadtree, reutilizados entre pasos (crecen si hace falta). */
type Arbol = {
  cap: number;
  cuenta: number;
  /** `hijo[c·4 + q]`: celda hija del cuadrante `q` (−1 = no hay). */
  hijo: Int32Array;
  padre: Int32Array;
  /** Primer nodo de la hoja (cadena por `siguiente`); `INTERNA` si tiene hijos. */
  hoja: Int32Array;
  /** Centro geométrico y medio lado de la celda. */
  ox: Float64Array;
  oy: Float64Array;
  mitad: Float64Array;
  /** Masa (cantidad de nodos) y suma de posiciones: el centro de masa es `s/masa`. */
  masa: Float64Array;
  sx: Float64Array;
  sy: Float64Array;
  /** Cadena de nodos de una hoja (superpuestos o al tope de profundidad). */
  siguiente: Int32Array;
  pila: Int32Array;
};

const INTERNA = -1;
const VACIA = -2;
/** Tope de profundidad: por debajo, los nodos casi superpuestos se encadenan en la hoja. */
const MAX_PROF = 48;

export type EstadoFisica = {
  n: number;
  /** Posiciones intercaladas `[x0, y0, …]`. */
  pos: Float64Array;
  /** Velocidades intercaladas `[vx0, vy0, …]`. */
  vel: Float64Array;
  /** Aristas intercaladas `[s0, t0, …]` (índices de nodo). */
  aristas: Int32Array;
  /** Nodos que participan (construcción temporal); `null` = todos. */
  activos: Uint8Array | null;
  /** Nodo que se está arrastrando (no se integra); −1 = ninguno. */
  fijo: number;
  /** Nodo central del mini-grafo (tira hacia el origen); −1 = ninguno. */
  centro: number;
  arbol: Arbol;
  /** Aristas de cada nodo: da la inercia de los hubs (ver `paso`). */
  grado: Float64Array;
  /** Fuerza de cada arista con `normalizarGrado`: `1/min(grado(s), grado(t))`. */
  fuerzaArista: Float64Array;
  /** Parte del tirón de cada arista que se lleva `t`: `grado(s)/(grado(s)+grado(t))` (`bias`). */
  sesgo: Float64Array;
  /** Rigidez que suman los resortes normalizados de cada nodo (su inercia, ver `paso`). */
  rigidezNorm: Float64Array;
  /** Velocidades al empezar el paso (para aplicar la inercia). */
  v0: Float64Array;
};

function crearArbol(n: number, cap: number): Arbol {
  return {
    cap,
    cuenta: 0,
    hijo: new Int32Array(cap * 4),
    padre: new Int32Array(cap),
    hoja: new Int32Array(cap),
    ox: new Float64Array(cap),
    oy: new Float64Array(cap),
    mitad: new Float64Array(cap),
    masa: new Float64Array(cap),
    sx: new Float64Array(cap),
    sy: new Float64Array(cap),
    siguiente: new Int32Array(Math.max(n, 1)),
    pila: new Int32Array(4 * MAX_PROF + 16),
  };
}

export function crearEstado(
  n: number,
  pos: Float64Array,
  aristas: Int32Array,
  centro = -1,
): EstadoFisica {
  return {
    n,
    pos,
    vel: new Float64Array(n * 2),
    aristas,
    activos: null,
    fijo: -1,
    centro,
    arbol: crearArbol(n, Math.max(16, n * 2)),
    ...resortesDe(n, aristas),
    v0: new Float64Array(n * 2),
  };
}

/**
 * Grado de cada nodo y, por arista, la fuerza y el reparto de `forceLink`
 * (`d3-force`): se calculan una vez, con el grafo entero (también durante la
 * construcción temporal, como `d3`, que cuenta los enlaces de la fuerza).
 */
function resortesDe(n: number, aristas: Int32Array) {
  const grado = gradoDe(n, aristas);
  const m = aristas.length >> 1;
  const fuerzaArista = new Float64Array(m);
  const sesgo = new Float64Array(m);
  const rigidezNorm = new Float64Array(n);
  for (let j = 0; j < m; j++) {
    const s = aristas[j * 2];
    const t = aristas[j * 2 + 1];
    const f = 1 / Math.min(grado[s], grado[t]);
    const b = grado[s] / (grado[s] + grado[t]);
    fuerzaArista[j] = f;
    sesgo[j] = b;
    // Por extremo, el doble del reparto: con grados iguales cada uno recibe el
    // tirón entero, como sin normalizar.
    rigidezNorm[s] += 2 * f * (1 - b);
    rigidezNorm[t] += 2 * f * b;
  }
  return { grado, fuerzaArista, sesgo, rigidezNorm };
}

function gradoDe(n: number, aristas: Int32Array): Float64Array {
  const g = new Float64Array(n);
  for (let j = 0; j < aristas.length; j++) g[aristas[j]]++;
  return g;
}

/**
 * Rigidez máxima que un nodo recibe por paso sin oscilar. Con el rozamiento de
 * `d3` (se conserva el 60 % de la velocidad) el integrador diverge por encima
 * de `2·(1 + 0,6)/0,6 ≈ 5,3`; 2,5 deja margen. Los resortes suman `0,01·a` por
 * arista, así que un hub de 320 enlaces con `a = ganancia` (arranque en frío)
 * pasa de largo (32) y vibra de un paso al otro: por eso tiene inercia.
 */
const RIGIDEZ_MAX = 2.5;

/**
 * Inercia mínima por enlace, aunque los resortes estén normalizados (Parte G):
 * normalizado, el hub casi no siente sus resortes (1/320 de cada uno), pero
 * sigue en medio de sus cientos de vecinos, que se empujan entre sí y contra
 * él; sin esta masa el hub de una estrella de 400 salta 80 px por paso
 * mientras se arrastra. Es la inercia que los hubs tenían antes (`0,01` por
 * enlace), así que el hub se mueve como siempre.
 */
const MASA_POR_ENLACE = 0.01;

/** Duplica la capacidad del árbol conservando lo ya construido. */
function crecer(a: Arbol) {
  const cap = a.cap * 2;
  const copiar = <T extends Int32Array | Float64Array>(v: T, nuevo: T): T => {
    nuevo.set(v);
    return nuevo;
  };
  a.hijo = copiar(a.hijo, new Int32Array(cap * 4));
  a.padre = copiar(a.padre, new Int32Array(cap));
  a.hoja = copiar(a.hoja, new Int32Array(cap));
  a.ox = copiar(a.ox, new Float64Array(cap));
  a.oy = copiar(a.oy, new Float64Array(cap));
  a.mitad = copiar(a.mitad, new Float64Array(cap));
  a.masa = copiar(a.masa, new Float64Array(cap));
  a.sx = copiar(a.sx, new Float64Array(cap));
  a.sy = copiar(a.sy, new Float64Array(cap));
  a.cap = cap;
}

function nuevaCelda(a: Arbol, padre: number, q: number): number {
  if (a.cuenta >= a.cap) crecer(a);
  const c = a.cuenta++;
  const m = a.mitad[padre] / 2;
  a.mitad[c] = m;
  a.ox[c] = a.ox[padre] + (q & 1 ? m : -m);
  a.oy[c] = a.oy[padre] + (q & 2 ? m : -m);
  a.padre[c] = padre;
  a.hoja[c] = VACIA;
  a.hijo.fill(-1, c * 4, c * 4 + 4);
  a.hijo[padre * 4 + q] = c;
  return c;
}

const cuadrante = (a: Arbol, c: number, x: number, y: number) =>
  (x >= a.ox[c] ? 1 : 0) + (y >= a.oy[c] ? 2 : 0);

/** Construye el quadtree de los nodos activos y acumula masa y centro de masa. */
function construirArbol(e: EstadoFisica) {
  const { n, pos, activos } = e;
  const a = e.arbol;
  if (a.siguiente.length < n) a.siguiente = new Int32Array(n);
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < n; i++) {
    if (activos && !activos[i]) continue;
    const x = pos[i * 2];
    const y = pos[i * 2 + 1];
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  a.cuenta = 1;
  const lado = Math.max(maxX - minX, maxY - minY, 1) + 1;
  a.mitad[0] = lado / 2;
  a.ox[0] = minX + lado / 2;
  a.oy[0] = minY + lado / 2;
  a.padre[0] = -1;
  a.hoja[0] = VACIA;
  a.hijo.fill(-1, 0, 4);
  if (minX === Infinity) return; // ningún nodo activo

  for (let i = 0; i < n; i++) {
    if (activos && !activos[i]) continue;
    const x = pos[i * 2];
    const y = pos[i * 2 + 1];
    let c = 0;
    for (let prof = 0; ; prof++) {
      const h = a.hoja[c];
      if (h === VACIA) {
        a.hoja[c] = i;
        a.siguiente[i] = -1;
        break;
      }
      if (h >= 0) {
        // Hoja ocupada: si el otro está en el mismo punto (o se tocó el tope de
        // profundidad) se encadena; si no, la hoja se divide y se sigue bajando.
        if (prof >= MAX_PROF || (pos[h * 2] === x && pos[h * 2 + 1] === y)) {
          a.siguiente[i] = h;
          a.hoja[c] = i;
          break;
        }
        a.hoja[c] = INTERNA;
        const hq = nuevaCelda(a, c, cuadrante(a, c, pos[h * 2], pos[h * 2 + 1]));
        a.hoja[hq] = h; // la cadena de `h` baja entera (son todos el mismo punto)
      }
      const q = cuadrante(a, c, x, y);
      const hijo = a.hijo[c * 4 + q];
      if (hijo === -1) {
        const nueva = nuevaCelda(a, c, q);
        a.hoja[nueva] = i;
        a.siguiente[i] = -1;
        break;
      }
      c = hijo;
    }
  }

  // Masa y suma de posiciones de abajo hacia arriba: las hijas siempre tienen
  // índice mayor que su madre, así que alcanza con recorrer al revés.
  a.masa.fill(0, 0, a.cuenta);
  a.sx.fill(0, 0, a.cuenta);
  a.sy.fill(0, 0, a.cuenta);
  for (let c = a.cuenta - 1; c >= 0; c--) {
    const h = a.hoja[c];
    if (h >= 0) {
      for (let j = h; j !== -1; j = a.siguiente[j]) {
        a.masa[c]++;
        a.sx[c] += pos[j * 2];
        a.sy[c] += pos[j * 2 + 1];
      }
    }
    const p = a.padre[c];
    if (p >= 0) {
      a.masa[p] += a.masa[c];
      a.sx[p] += a.sx[c];
      a.sy[p] += a.sy[c];
    }
  }
}

/**
 * Repulsión con Barnes-Hut. Escribe solo en `vel`. Cada nodo acumula su propia
 * fuerza (no la del par, como hacía el bucle `i < j`): las hojas se calculan
 * par a par con la fórmula exacta de siempre, y una celda lejana empuja como un
 * solo nodo de masa `m` en su centro de masa.
 */
export function repulsionBarnesHut(
  e: EstadoFisica,
  c: ConstantesFisica,
  alpha: number,
  azar: () => number = Math.random,
) {
  construirArbol(e);
  const { n, pos, vel, activos } = e;
  const a = e.arbol;
  const kk = c.k * c.k;
  const dmin2 = c.distanciaMin * c.distanciaMin;
  const escala = c.factorRepulsion * alpha;
  const theta2 = c.theta * c.theta;
  const dmax2 = c.distanciaMax * c.distanciaMax;
  const acotada = Number.isFinite(c.distanciaMax);
  const pila = a.pila;
  if (a.masa[0] === 0) return;
  for (let i = 0; i < n; i++) {
    if (activos && !activos[i]) continue;
    const xi = pos[i * 2];
    const yi = pos[i * 2 + 1];
    let fx = 0;
    let fy = 0;
    let sp = 0;
    pila[sp++] = 0;
    while (sp > 0) {
      const cel = pila[--sp];
      const h = a.hoja[cel];
      if (h >= 0) {
        // Hoja: par a par, exacto (incluye el desempate al azar si se tocan).
        for (let j = h; j !== -1; j = a.siguiente[j]) {
          if (j === i) continue;
          let dx = xi - pos[j * 2];
          let dy = yi - pos[j * 2 + 1];
          let d2 = dx * dx + dy * dy;
          if (acotada && d2 >= dmax2) continue;
          if (d2 < 1) {
            dx = azar() - 0.5;
            dy = azar() - 0.5;
            d2 = 1;
          }
          const d = Math.sqrt(d2);
          const f = (kk / Math.max(d2, dmin2)) * escala;
          fx += (dx / d) * f;
          fy += (dy / d) * f;
        }
        continue;
      }
      const m = a.masa[cel];
      if (m === 0) continue;
      const mitad = a.mitad[cel];
      // ¿El nodo está dentro de la celda? Entonces no se aproxima: su propio
      // peso estaría en el centro de masa y se empujaría a sí mismo.
      const bx = Math.abs(xi - a.ox[cel]);
      const by = Math.abs(yi - a.oy[cel]);
      const adentro = bx <= mitad && by <= mitad;
      if (!adentro) {
        const mx = a.sx[cel] / m;
        const my = a.sy[cel] / m;
        let dx = xi - mx;
        let dy = yi - my;
        let d2 = dx * dx + dy * dy;
        const w = mitad * 2;
        if (w * w < theta2 * d2) {
          if (acotada && d2 >= dmax2) continue;
          if (d2 < 1) {
            dx = azar() - 0.5;
            dy = azar() - 0.5;
            d2 = 1;
          }
          const d = Math.sqrt(d2);
          const f = (kk / Math.max(d2, dmin2)) * escala * m;
          fx += (dx / d) * f;
          fy += (dy / d) * f;
          continue;
        }
        if (acotada) {
          // Distancia del nodo al borde de la celda: si ya supera el corte,
          // nada de adentro empuja.
          const ex = Math.max(bx - mitad, 0);
          const ey = Math.max(by - mitad, 0);
          if (ex * ex + ey * ey >= dmax2) continue;
        }
      }
      const base = cel * 4;
      for (let q = 0; q < 4; q++) {
        const hijo = a.hijo[base + q];
        if (hijo !== -1) pila[sp++] = hijo;
      }
    }
    vel[i * 2] += fx;
    vel[i * 2 + 1] += fy;
  }
}

/**
 * La repulsión par a par de siempre (O(n²)). Queda como referencia para los
 * tests y la réplica de medición; el motor no la usa.
 */
export function repulsionPares(
  e: EstadoFisica,
  c: ConstantesFisica,
  alpha: number,
  azar: () => number = Math.random,
) {
  const { n, pos, vel, activos } = e;
  const kk = c.k * c.k;
  const dmin2 = c.distanciaMin * c.distanciaMin;
  const escala = c.factorRepulsion * alpha;
  for (let i = 0; i < n; i++) {
    if (activos && !activos[i]) continue;
    for (let j = i + 1; j < n; j++) {
      if (activos && !activos[j]) continue;
      let dx = pos[i * 2] - pos[j * 2];
      let dy = pos[i * 2 + 1] - pos[j * 2 + 1];
      let d2 = dx * dx + dy * dy;
      if (d2 < 1) {
        dx = azar() - 0.5;
        dy = azar() - 0.5;
        d2 = 1;
      }
      const d = Math.sqrt(d2);
      const f = (kk / Math.max(d2, dmin2)) * escala;
      vel[i * 2] += (dx / d) * f;
      vel[i * 2 + 1] += (dy / d) * f;
      vel[j * 2] -= (dx / d) * f;
      vel[j * 2 + 1] -= (dy / d) * f;
    }
  }
}

/**
 * Un paso de la simulación con la energía `alpha` (no la enfría: eso lo hace
 * quien lleva la cuenta, con `enfriar`). Mueve `pos` y `vel`.
 */
export function paso(
  e: EstadoFisica,
  c: ConstantesFisica,
  alpha: number,
  azar: () => number = Math.random,
  repulsion: typeof repulsionBarnesHut = repulsionBarnesHut,
) {
  // Todas las fuerzas escalan con la energía y con la ganancia (ver `constantesCumulo`).
  const a = alpha * c.ganancia;
  const retiene = 1 - c.rozamiento;
  const vmax2 = c.velocidadMax * c.velocidadMax;
  const { n, pos, vel, v0, aristas, activos, fijo, centro } = e;
  v0.set(vel);
  repulsion(e, c, a, azar);
  // Resortes: tiran hacia `distanciaEnlace`. Normalizados (Parte G), como
  // `forceLink` de `d3`: fuerza `1/min(grado)` repartida según el grado del
  // otro extremo; sin normalizar, el tirón entero a cada lado (el de antes).
  const L = c.distanciaEnlace;
  const norm = c.normalizarGrado;
  const { fuerzaArista, sesgo } = e;
  for (let j = 0; j < aristas.length; j += 2) {
    const s = aristas[j];
    const t = aristas[j + 1];
    if (activos && (!activos[s] || !activos[t])) continue;
    const dx = pos[t * 2] - pos[s * 2];
    const dy = pos[t * 2 + 1] - pos[s * 2 + 1];
    const d = Math.max(Math.sqrt(dx * dx + dy * dy), 1);
    const f = ((d - L) / d) * c.rigidezEnlace * a;
    let fs = f;
    let ft = f;
    if (norm) {
      const w = 2 * f * fuerzaArista[j >> 1];
      const b = sesgo[j >> 1];
      fs = w * (1 - b);
      ft = w * b;
    }
    vel[s * 2] += dx * fs;
    vel[s * 2 + 1] += dy * fs;
    vel[t * 2] -= dx * ft;
    vel[t * 2 + 1] -= dy * ft;
  }
  // Rigidez de los resortes de cada nodo, para su inercia (abajo).
  const rigidez = norm ? e.rigidezNorm : e.grado;
  const g = c.gravedad * a;
  // Gravedad hacia el origen, rozamiento e integración.
  for (let i = 0; i < n; i++) {
    if (activos && !activos[i]) continue;
    const ix = i * 2;
    const iy = ix + 1;
    if (g !== 0) {
      vel[ix] -= pos[ix] * g;
      vel[iy] -= pos[iy] * g;
    }
    if (i === fijo) continue;
    // El nodo central tira hacia el origen para quedar al medio.
    if (i === centro) {
      vel[ix] -= pos[ix] * 0.05;
      vel[iy] -= pos[iy] * 0.05;
    }
    // Inercia de los hubs: la fuerza del paso se reparte en `m` pasos. Solo
    // cambia cómo llega al equilibrio, no dónde está (fuerza nula = reposo).
    const m =
      (Math.max(rigidez[i] * c.rigidezEnlace, e.grado[i] * MASA_POR_ENLACE) * c.ganancia) /
      RIGIDEZ_MAX;
    if (m > 1) {
      vel[ix] = v0[ix] + (vel[ix] - v0[ix]) / m;
      vel[iy] = v0[iy] + (vel[iy] - v0[iy]) / m;
    }
    vel[ix] *= retiene;
    vel[iy] *= retiene;
    const v2 = vel[ix] * vel[ix] + vel[iy] * vel[iy];
    if (v2 > vmax2) {
      const f = Math.sqrt(vmax2 / v2);
      vel[ix] *= f;
      vel[iy] *= f;
    }
    pos[ix] += vel[ix];
    pos[iy] += vel[iy];
  }
  if (c.recentrar && centro < 0) recentrar(e);
}

/**
 * `forceCenter` de `d3-force`: traslada los nodos que participan para que su
 * centroide quede en el origen. El arrastrado no se mueve (lo tiene el puntero);
 * el resto se corre con él, como en `d3`, donde el nodo fijo vuelve a su lugar.
 * Una traslación no cambia ninguna distancia: ni la forma ni las fuerzas.
 */
export function recentrar(e: EstadoFisica) {
  const { n, pos, activos, fijo } = e;
  let sx = 0;
  let sy = 0;
  let cuantos = 0;
  for (let i = 0; i < n; i++) {
    if (activos && !activos[i]) continue;
    sx += pos[i * 2];
    sy += pos[i * 2 + 1];
    cuantos++;
  }
  if (cuantos === 0) return;
  sx /= cuantos;
  sy /= cuantos;
  for (let i = 0; i < n; i++) {
    if (i === fijo || (activos && !activos[i])) continue;
    pos[i * 2] -= sx;
    pos[i * 2 + 1] -= sy;
  }
}
