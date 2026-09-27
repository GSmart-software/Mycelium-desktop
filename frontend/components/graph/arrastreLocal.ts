// Arrastre local del cúmulo (`FUN-L-25` · Parte F, `DEF-109`).
//
// Idea del usuario: al mover un nodo, los que no están cerca ni conectados no
// deberían recalcularse ni redibujarse. Este módulo decide QUIÉNES se mueven
// (el conjunto activo) y QUÉ parte del lienzo hay que rehacer en cada frame
// (el rectángulo sucio). La física de los congelados está en `fisica.ts`
// (`EstadoFisica.moviles`) y el dibujo en `MiniGraph.tsx`.
//
// Módulo PURO (sin DOM): lo importan `MiniGraph.tsx` y los tests headless
// (`scripts/test-arrastre-local.mjs`).

/** Vecinos de cada nodo en formato compacto: los de `i` son `vecinos[inicio[i] … inicio[i+1])`. */
export type Adyacencia = { inicio: Int32Array; vecinos: Int32Array };

/** Adyacencia no dirigida a partir de las aristas intercaladas `[s0, t0, s1, t1, …]`. */
export function adyacencia(n: number, aristas: ArrayLike<number>): Adyacencia {
  const inicio = new Int32Array(n + 1);
  for (let j = 0; j < aristas.length; j++) inicio[aristas[j] + 1]++;
  for (let i = 0; i < n; i++) inicio[i + 1] += inicio[i];
  const vecinos = new Int32Array(inicio[n]);
  const lleno = inicio.slice(0, n);
  for (let j = 0; j < aristas.length; j += 2) {
    const s = aristas[j];
    const t = aristas[j + 1];
    vecinos[lleno[s]++] = t;
    vecinos[lleno[t]++] = s;
  }
  return { inicio, vecinos };
}

/**
 * Conjunto activo del arrastre de `i` (Parte F, cambio 1): el propio nodo, sus
 * vecinos de grafo a uno y dos saltos, y todo nodo a menos de `radio` de él
 * (el cúmulo usa `3·k`). Devuelve la máscara (1 = activo) en `salida`, que se
 * limpia antes.
 *
 * La consulta por distancia recorre las posiciones una vez: se hace al empezar
 * el arrastre y al recalcular (cada `k` de recorrido), no por frame, y armar
 * un quadtree o una rejilla para consultarlo también es O(n). Con la Tesina
 * (1.306 nodos) son unas centésimas de milisegundo.
 */
export function conjuntoActivo(
  i: number,
  ady: Adyacencia,
  pos: ArrayLike<number>,
  n: number,
  radio: number,
  salida: Uint8Array = new Uint8Array(n),
): Uint8Array {
  salida.fill(0);
  salida[i] = 1;
  const { inicio, vecinos } = ady;
  for (let a = inicio[i]; a < inicio[i + 1]; a++) {
    const v = vecinos[a];
    salida[v] = 1;
    for (let b = inicio[v]; b < inicio[v + 1]; b++) salida[vecinos[b]] = 1;
  }
  const x = pos[i * 2];
  const y = pos[i * 2 + 1];
  const r2 = radio * radio;
  for (let j = 0; j < n; j++) {
    if (salida[j]) continue;
    const dx = pos[j * 2] - x;
    const dy = pos[j * 2 + 1] - y;
    if (dx * dx + dy * dy < r2) salida[j] = 1;
  }
  return salida;
}

/** Índices de los nodos activos de la máscara. */
export function indicesActivos(mascara: Uint8Array): Int32Array {
  let cuantos = 0;
  for (let i = 0; i < mascara.length; i++) cuantos += mascara[i];
  const r = new Int32Array(cuantos);
  let k = 0;
  for (let i = 0; i < mascara.length; i++) if (mascara[i]) r[k++] = i;
  return r;
}

/**
 * Aristas (índice `j` de la arista `[s, t] = aristas[2j], aristas[2j+1]`) que
 * tocan algún nodo activo, incluidas las que van a un congelado: todas se
 * mueven cuando se mueve su extremo activo, así que no pueden quedar en la
 * capa de los congelados.
 */
export function aristasQueTocan(mascara: Uint8Array, aristas: ArrayLike<number>): Int32Array {
  const r: number[] = [];
  for (let j = 0; j < aristas.length; j += 2) {
    if (mascara[aristas[j]] || mascara[aristas[j + 1]]) r.push(j >> 1);
  }
  return Int32Array.from(r);
}

/** Rectángulo en píxeles del lienzo `[x0, y0) – [x1, y1)`; vacío si `x1 <= x0` o `y1 <= y0`. */
export type Rect = { x0: number; y0: number; x1: number; y1: number };

export const RECT_VACIO: Rect = { x0: 0, y0: 0, x1: 0, y1: 0 };

export const rectVacio = (r: Rect) => r.x1 <= r.x0 || r.y1 <= r.y0;

/** El rectángulo que envuelve a los dos (uno vacío no suma). */
export function unirRect(a: Rect, b: Rect): Rect {
  if (rectVacio(a)) return b;
  if (rectVacio(b)) return a;
  return {
    x0: Math.min(a.x0, b.x0),
    y0: Math.min(a.y0, b.y0),
    x1: Math.max(a.x1, b.x1),
    y1: Math.max(a.y1, b.y1),
  };
}

/** Recorta al lienzo `ancho × alto` y lleva los bordes a píxeles enteros (hacia afuera). */
export function recortarRect(r: Rect, ancho: number, alto: number): Rect {
  const x0 = Math.max(0, Math.floor(r.x0));
  const y0 = Math.max(0, Math.floor(r.y0));
  const x1 = Math.min(ancho, Math.ceil(r.x1));
  const y1 = Math.min(alto, Math.ceil(r.y1));
  return x1 <= x0 || y1 <= y0 ? RECT_VACIO : { x0, y0, x1, y1 };
}

/** Cómo se lleva el mundo a píxeles del lienzo: `px = (x·scale + ox)·dpr + ancho/2`. */
export type Transformacion = { scale: number; ox: number; oy: number; dpr: number; ancho: number; alto: number };

/**
 * Curvatura de las aristas (la de `controlDe` en `MiniGraph.tsx`): el punto de
 * control es el punto medio desplazado `CURVA` veces la perpendicular.
 */
export const CURVA = 0.12;

/**
 * Rectángulo sucio (Parte F, cambio 3): lo que ocupa en el lienzo todo lo que
 * se redibuja en el frame —los nodos activos con su disco y su nombre, y las
 * aristas que los tocan— con `margen` píxeles CSS de más por lado (antialias,
 * grosor del trazo). Una curva cuadrática queda dentro del triángulo de sus
 * tres puntos, así que alcanza con los extremos y el punto de control.
 *
 * `radio[i]`: el del disco, en unidades de mundo. `nombre[i]`: ancho del nombre
 * en píxeles CSS si se escribe, o < 0 si no; va centrado bajo el disco, con la
 * línea base a `r + 13/scale` (las mismas cuentas que `pintarNombres`).
 */
export function rectSucio(
  pos: ArrayLike<number>,
  radio: ArrayLike<number>,
  nombre: ArrayLike<number>,
  nodos: ArrayLike<number>,
  aristas: ArrayLike<number>,
  indicesAristas: ArrayLike<number>,
  t: Transformacion,
  margen = 4,
): Rect {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  // En unidades de mundo; se pasa a píxeles al final.
  for (let k = 0; k < nodos.length; k++) {
    const i = nodos[k];
    const x = pos[i * 2];
    const y = pos[i * 2 + 1];
    const r = radio[i];
    let izq = x - r;
    let der = x + r;
    let abajo = y + r;
    const w = nombre[i];
    if (w >= 0) {
      // Nombre: `w` px de ancho y ~4 px bajo la línea base (descendentes).
      const mitad = w / 2 / t.scale;
      if (x - mitad < izq) izq = x - mitad;
      if (x + mitad > der) der = x + mitad;
      abajo = y + r + 17 / t.scale;
    }
    if (izq < x0) x0 = izq;
    if (der > x1) x1 = der;
    if (y - r < y0) y0 = y - r;
    if (abajo > y1) y1 = abajo;
  }
  for (let k = 0; k < indicesAristas.length; k++) {
    const j = indicesAristas[k] * 2;
    const s = aristas[j];
    const d = aristas[j + 1];
    const sx = pos[s * 2];
    const sy = pos[s * 2 + 1];
    const tx = pos[d * 2];
    const ty = pos[d * 2 + 1];
    const cx = (sx + tx) / 2 - (ty - sy) * CURVA;
    const cy = (sy + ty) / 2 + (tx - sx) * CURVA;
    const minX = Math.min(sx, tx, cx);
    const maxX = Math.max(sx, tx, cx);
    const minY = Math.min(sy, ty, cy);
    const maxY = Math.max(sy, ty, cy);
    if (minX < x0) x0 = minX;
    if (maxX > x1) x1 = maxX;
    if (minY < y0) y0 = minY;
    if (maxY > y1) y1 = maxY;
  }
  if (x0 === Infinity) return RECT_VACIO;
  const { scale, ox, oy, dpr, ancho, alto } = t;
  return {
    x0: (x0 * scale + ox - margen) * dpr + ancho / 2,
    y0: (y0 * scale + oy - margen) * dpr + alto / 2,
    x1: (x1 * scale + ox + margen) * dpr + ancho / 2,
    y1: (y1 * scale + oy + margen) * dpr + alto / 2,
  };
}
