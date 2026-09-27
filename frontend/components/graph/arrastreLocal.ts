// Arrastre local del cúmulo (`FUN-L-25` · Parte F, `DEF-109`).
//
// Idea del usuario: al mover un nodo, los que no están cerca ni conectados no
// deberían recalcularse ni redibujarse. Este módulo decide QUIÉNES se mueven
// (el conjunto activo). La física de los congelados está en `fisica.ts`
// (`EstadoFisica.moviles`).
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
