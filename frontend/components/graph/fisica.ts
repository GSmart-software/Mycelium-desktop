// Motor de fuerzas del cúmulo y del sustrato (`FUN-L-25` · Parte B, `DEF-109`).
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
//   calcula. Implementada pero apagada: ver `constantesDe` y por qué.
//
// Los datos viven en arrays tipados (posiciones y velocidades intercaladas
// `[x0, y0, x1, y1, …]`, aristas `[s0, t0, s1, t1, …]`) para que el worker los
// reciba y devuelva sin objetos por nodo.

/** Disposiciones que simulan (las otras dos son deterministas: `disposiciones.ts`). */
export type DisposicionFisica = "cumulo" | "sustrato";

export type ConstantesFisica = {
  /** Distancia de reposo de los resortes y escala de la repulsión (`k²/d²`). */
  k: number;
  /** Tope de la repulsión por par (la misma clamp de siempre). */
  topeRepulsion: number;
  /** Multiplicador de la repulsión (el sustrato empuja al 70 %). */
  factorRepulsion: number;
  /** Criterio de Barnes-Hut: una celda de lado `w` a distancia `d` se aproxima si `w < θ·d`. */
  theta: number;
  /** Más allá de esta distancia no hay repulsión (`Infinity` = sin acotar). */
  distanciaMax: number;
};

/**
 * Constantes por disposición. El cúmulo y el sustrato conservan los valores que
 * tenían en `MiniGraph.tsx` (`k` 80/45, tope 8/6, factor 1/0,7).
 *
 * `distanciaMax = Infinity` (sin corte): la spec proponía `4·k`, pero medido
 * sobre un vault sintético de 1.000 notas (réplica en Node, ver
 * `docs/features/grafo-indice-y-motor.md` § Cómo quedó · Parte B) cortar a `4·k`
 * achica el cúmulo asentado un 30 % (radio RMS 793 → 550) y desde la caché
 * desplaza cada nodo 160 px de media: la gravedad (`0,004·x`) solo se equilibra
 * con la SUMA de muchas repulsiones lejanas y débiles, y el corte se la quita.
 * Incluso `16·k` lo achica un 6 %. El ahorro, en cambio, es de un 10 % sobre
 * Barnes-Hut (las celdas lejanas ya se calculan como un solo nodo). El corte
 * queda implementado y probado, pero apagado.
 */
export function constantesDe(disposicion: DisposicionFisica): ConstantesFisica {
  const sustrato = disposicion === "sustrato";
  return {
    k: sustrato ? 45 : 80,
    topeRepulsion: sustrato ? 6 : 8,
    factorRepulsion: sustrato ? 0.7 : 1,
    theta: 0.9,
    distanciaMax: Infinity,
  };
}

/** Enfriamiento por paso: de 1 a 0,03 son ~700 pasos, como siempre. */
export function enfriar(alpha: number): number {
  return Math.max(alpha * 0.995, 0.02);
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
  };
}

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
  const tope = c.topeRepulsion;
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
          const f = Math.min(kk / d2, tope) * escala;
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
          const f = Math.min(kk / d2, tope) * escala * m;
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
      const f = Math.min(kk / d2, c.topeRepulsion) * escala;
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
  repulsion(e, c, alpha, azar);
  const { n, pos, vel, aristas, activos, fijo, centro } = e;
  const k = c.k;
  // Resortes: tiran hacia la distancia `k` (mismas constantes que siempre).
  for (let a = 0; a < aristas.length; a += 2) {
    const s = aristas[a];
    const t = aristas[a + 1];
    if (activos && (!activos[s] || !activos[t])) continue;
    const dx = pos[t * 2] - pos[s * 2];
    const dy = pos[t * 2 + 1] - pos[s * 2 + 1];
    const d = Math.max(Math.sqrt(dx * dx + dy * dy), 1);
    const f = ((d - k) / d) * 0.02 * alpha * 10 * 0.05;
    vel[s * 2] += dx * f;
    vel[s * 2 + 1] += dy * f;
    vel[t * 2] -= dx * f;
    vel[t * 2 + 1] -= dy * f;
  }
  // Gravedad hacia el origen, rozamiento e integración.
  for (let i = 0; i < n; i++) {
    if (activos && !activos[i]) continue;
    const ix = i * 2;
    const iy = ix + 1;
    vel[ix] -= pos[ix] * 0.004 * alpha;
    vel[iy] -= pos[iy] * 0.004 * alpha;
    if (i === fijo) continue;
    // El nodo central tira hacia el origen para quedar al medio.
    if (i === centro) {
      vel[ix] -= pos[ix] * 0.05;
      vel[iy] -= pos[iy] * 0.05;
    }
    vel[ix] *= 0.85;
    vel[iy] *= 0.85;
    pos[ix] += vel[ix];
    pos[iy] += vel[iy];
  }
}
