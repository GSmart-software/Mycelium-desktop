/**
 * Disposiciones del grafo global (`FUN-L-23`): cómo se colocan los nodos en las
 * disposiciones que **no** son el cúmulo de fuerzas.
 *
 * - `anillo`: todas las notas en una circunferencia, agrupadas por carpeta de
 *   primer nivel («colonias»).
 * - `crecimiento`: cada nota brota junto a las que ya enlazaba, en orden de
 *   creación; sin física y estable al agregar notas.
 * - `sustrato`: usa la simulación del cúmulo (vive en `MiniGraph.tsx`); de acá
 *   solo toma la siembra inicial y el índice del grafo.
 *
 * Es un módulo **puro**: sin imports en tiempo de ejecución y sin tocar el DOM,
 * para poder transpilarlo al vuelo y probarlo con `node --test`
 * (`scripts/test-disposiciones.mjs`), igual que los otros núcleos del proyecto.
 * Lo que dibuja está aparte, en `hifas.ts`.
 *
 * Referencia: la demo `docs/design/demos/micelio-del-vault.html`, donde el
 * usuario afinó estos layouts sobre un vault sintético y dos reales.
 */

/** Lo mínimo que estas disposiciones necesitan saber de un nodo. */
export type NodoEntrada = {
  id: string;
  titulo: string;
  conexiones: number;
  creadoEn?: string;
  /** Ruta de la carpeta con `/` como separador; vacía o ausente = raíz. */
  carpeta?: string;
};
export type AristaEntrada = { source: string; target: string };

const TAU = Math.PI * 2;

/** Nombre de la colonia de las notas que viven en la raíz del vault. */
export const COLONIA_RAIZ = "Raíz";

/**
 * Con esta cantidad de conexiones o más, un nodo se dibuja como cuerpo
 * fructífero (disco crema con brillo) en vez de espora.
 */
export const UMBRAL_CUERPO_FRUCTIFERO = 20;

/**
 * Paleta de matices HSL para tintar las colonias del anillo. Se asigna en
 * orden de tamaño (la carpeta más grande, el primero), así es determinista para
 * un vault dado. Es fija a propósito: los temas los define Mycelium.
 */
export const MATICES_COLONIA = [158, 28, 190, 88, 340, 262, 48, 210, 120, 10, 300, 70] as const;
export const SATURACION_COLONIA = 34;

export type Colonia = {
  nombre: string;
  /** Cuántos nodos tiene. Decide el orden y, con él, el tinte. */
  tamano: number;
  /** Matiz HSL de `MATICES_COLONIA`. */
  matiz: number;
};

/**
 * El grafo ya indexado: los nodos pasan a ser enteros `0..n-1` (en el orden en
 * que llegaron) y todo lo demás son arreglos planos, que es lo que los layouts
 * recorren miles de veces. Se construye una vez por montaje.
 */
export type GrafoIndexado = {
  n: number;
  ids: string[];
  indice: Map<string, number>;
  titulos: string[];
  conexiones: Int32Array;
  /** Instante de creación en ms; `NaN` si la nota no trae fecha. */
  creado: Float64Array;
  /**
   * Posición de cada nodo en el orden de creación (0 = la más vieja). Las notas
   * sin fecha van al final, entre sí por id. Es el orden que usan la
   * construcción temporal y el layout de crecimiento.
   */
  rango: Int32Array;
  /** Índices ordenados por `rango`: `orden[k]` es el nodo con rango `k`. */
  orden: Int32Array;
  salientes: number[][];
  entrantes: number[][];
  /** Aristas como pares de índices; solo las que resuelven a nodos presentes. */
  aristas: [number, number][];
  /** Índice de colonia por nodo. */
  colonia: Int32Array;
  /** Colonias ordenadas por tamaño descendente (desempate por nombre). */
  colonias: Colonia[];
  /** Lo que queda de la ruta tras la colonia (subcarpetas), para ordenar el anillo. */
  subcarpeta: string[];
};

/** Primer segmento de la ruta y el resto, o «Raíz» si no hay carpeta. */
function partirCarpeta(ruta: string | undefined): [string, string] {
  const limpia = (ruta ?? "").trim().replace(/^\/+|\/+$/g, "");
  if (!limpia) return [COLONIA_RAIZ, ""];
  const corte = limpia.indexOf("/");
  return corte < 0 ? [limpia, ""] : [limpia.slice(0, corte), limpia.slice(corte + 1)];
}

const compararIds = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

export function indexarGrafo(nodos: NodoEntrada[], aristas: AristaEntrada[]): GrafoIndexado {
  const n = nodos.length;
  const ids = nodos.map((x) => x.id);
  const indice = new Map(ids.map((id, i) => [id, i]));
  const titulos = nodos.map((x) => x.titulo);
  const conexiones = new Int32Array(n);
  const creado = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    conexiones[i] = Math.max(0, nodos[i].conexiones | 0);
    creado[i] = nodos[i].creadoEn ? Date.parse(nodos[i].creadoEn as string) : NaN;
  }

  // Orden de creación: por fecha, las sin fecha al final, desempate por id.
  const orden = new Int32Array(n);
  const lista = Array.from({ length: n }, (_, i) => i).sort((a, b) => {
    const ta = creado[a];
    const tb = creado[b];
    const sinA = Number.isNaN(ta);
    const sinB = Number.isNaN(tb);
    if (sinA !== sinB) return sinA ? 1 : -1;
    if (!sinA && ta !== tb) return ta - tb;
    return compararIds(ids[a], ids[b]);
  });
  const rango = new Int32Array(n);
  lista.forEach((i, k) => {
    orden[k] = i;
    rango[i] = k;
  });

  const salientes: number[][] = Array.from({ length: n }, () => []);
  const entrantes: number[][] = Array.from({ length: n }, () => []);
  const pares: [number, number][] = [];
  for (const a of aristas) {
    const s = indice.get(a.source);
    const t = indice.get(a.target);
    if (s === undefined || t === undefined) continue;
    pares.push([s, t]);
    salientes[s].push(t);
    entrantes[t].push(s);
  }

  // Colonias: carpeta de primer nivel, ordenadas por tamaño para que el tinte
  // sea determinista y las grandes se lleven los primeros matices.
  const nombrePorNodo: string[] = new Array(n);
  const subcarpeta: string[] = new Array(n);
  const tamanos = new Map<string, number>();
  for (let i = 0; i < n; i++) {
    const [nombre, sub] = partirCarpeta(nodos[i].carpeta);
    nombrePorNodo[i] = nombre;
    subcarpeta[i] = sub;
    tamanos.set(nombre, (tamanos.get(nombre) ?? 0) + 1);
  }
  const colonias: Colonia[] = [...tamanos.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([nombre, tamano], k) => ({
      nombre,
      tamano,
      matiz: MATICES_COLONIA[k % MATICES_COLONIA.length],
    }));
  const indiceColonia = new Map(colonias.map((c, k) => [c.nombre, k]));
  const colonia = new Int32Array(n);
  for (let i = 0; i < n; i++) colonia[i] = indiceColonia.get(nombrePorNodo[i]) ?? 0;

  return {
    n,
    ids,
    indice,
    titulos,
    conexiones,
    creado,
    rango,
    orden,
    salientes,
    entrantes,
    aristas: pares,
    colonia,
    colonias,
    subcarpeta,
  };
}

/** Color CSS del tinte de una colonia, con luminosidad y opacidad a elección. */
export const tinteColonia = (matiz: number, luz: number, alpha = 1) =>
  `hsla(${matiz},${SATURACION_COLONIA}%,${luz}%,${alpha})`;

// ── Azar determinista ────────────────────────────────────────────────────────

/** Generador `mulberry32`: rápido y reproducible a partir de una semilla entera. */
export function mulberry32(semilla: number): () => number {
  let a = semilla | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** FNV-1a de 32 bits: una semilla estable a partir del id de una nota. */
export function hashCadena(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Semilla fija de las disposiciones. Cambiarla cambia el dibujo de todos los
 * vaults, así que no se toca sin motivo.
 */
export const SEMILLA = 11;

// ── Anillo de colonias ───────────────────────────────────────────────────────

export type Arco = { colonia: number; a0: number; a1: number };
export type LayoutAnillo = {
  pos: Float64Array;
  /** Ángulo de cada nodo sobre el anillo. */
  ang: Float64Array;
  /** Radio del anillo, en unidades de mundo. */
  R: number;
  arcos: Arco[];
};

/** Radio mínimo del anillo: con pocas notas no tiene sentido achicarlo más. */
export const RADIO_MINIMO_ANILLO = 420;
/** Hueco angular entre colonias consecutivas. */
const HUECO_COLONIA = 0.025;

/**
 * Todos los nodos sobre una circunferencia, agrupados por colonia (carpeta de
 * primer nivel) y, dentro, por subcarpeta y título. El radio crece con N para
 * que los nodos no se pisen con cualquier tamaño de vault.
 */
export function layoutAnillo(g: GrafoIndexado): LayoutAnillo {
  const N = g.n;
  const pos = new Float64Array(N * 2);
  const ang = new Float64Array(N);
  const R = Math.max(RADIO_MINIMO_ANILLO, (N * 2.3) / TAU);
  if (N === 0) return { pos, ang, R, arcos: [] };

  const orden = Array.from({ length: N }, (_, i) => i).sort(
    (a, b) =>
      g.colonia[a] - g.colonia[b] ||
      g.subcarpeta[a].localeCompare(g.subcarpeta[b]) ||
      g.titulos[a].localeCompare(g.titulos[b]) ||
      compararIds(g.ids[a], g.ids[b]),
  );
  const nColonias = g.colonias.length;
  const util = TAU - HUECO_COLONIA * nColonias;
  const paso = util / N;
  const arcos: Arco[] = [];
  let a = -Math.PI / 2;
  let actual = -1;
  let inicio = a;
  for (const i of orden) {
    const c = g.colonia[i];
    if (c !== actual) {
      if (actual >= 0) arcos.push({ colonia: actual, a0: inicio, a1: a });
      actual = c;
      a += HUECO_COLONIA;
      inicio = a;
    }
    const centro = a + paso / 2;
    ang[i] = centro;
    pos[i * 2] = Math.cos(centro) * R;
    pos[i * 2 + 1] = Math.sin(centro) * R;
    a += paso;
  }
  arcos.push({ colonia: actual, a0: inicio, a1: a });
  return { pos, ang, R, arcos };
}

// ── Crecimiento ──────────────────────────────────────────────────────────────

export type LayoutCrecimiento = { pos: Float64Array };

/** Lado de la rejilla de ocupación y distancia mínima entre dos notas. */
const CELDA_CRECIMIENTO = 22;
const DISTANCIA_MINIMA = 14;

/**
 * Cada nota, en orden de creación, brota cerca de las notas que ya enlazaba (o
 * que la enlazan); sin vecinas, cerca de las notas de su carpeta; sin nada, en
 * la frontera de la colonia. Sin física: el dibujo es el mismo en cada apertura.
 *
 * El azar es determinista **por nota**: la semilla sale del id, así que dónde
 * cae una nota depende solo de sus vecinas anteriores y de sí misma. Agregar
 * notas nuevas (siempre posteriores) no mueve las existentes, y ni siquiera una
 * nota importada con fecha vieja altera el azar de las que la siguen —solo las
 * que la enlazan, que ahora tienen una vecina más—.
 */
export function layoutCrecimiento(g: GrafoIndexado): LayoutCrecimiento {
  const N = g.n;
  const pos = new Float64Array(N * 2);
  const rejilla = new Map<string, number[]>();
  const clave = (x: number, y: number) =>
    `${Math.floor(x / CELDA_CRECIMIENTO)},${Math.floor(y / CELDA_CRECIMIENTO)}`;
  const libre = (x: number, y: number) => {
    const cx = Math.floor(x / CELDA_CRECIMIENTO);
    const cy = Math.floor(y / CELDA_CRECIMIENTO);
    for (let i = -1; i <= 1; i++) {
      for (let j = -1; j <= 1; j++) {
        const l = rejilla.get(`${cx + i},${cy + j}`);
        if (!l) continue;
        for (const v of l) {
          const dx = pos[v * 2] - x;
          const dy = pos[v * 2 + 1] - y;
          if (dx * dx + dy * dy < DISTANCIA_MINIMA * DISTANCIA_MINIMA) return false;
        }
      }
    }
    return true;
  };
  const poner = (u: number, x: number, y: number) => {
    pos[u * 2] = x;
    pos[u * 2 + 1] = y;
    const k = clave(x, y);
    const l = rejilla.get(k);
    if (l) l.push(u);
    else rejilla.set(k, [u]);
  };
  // Centroide acumulado de cada colonia (para las notas sin vecinas).
  const centro = g.colonias.map(() => ({ x: 0, y: 0, n: 0 }));
  let frontera = 30;

  for (let k = 0; k < N; k++) {
    const u = g.orden[k];
    const rnd = mulberry32(hashCadena(g.ids[u]) ^ SEMILLA);
    const rangoU = g.rango[u];
    // Solo cuentan las vecinas ANTERIORES: son las que ya estaban cuando brotó.
    const vecinas: number[] = [];
    for (const v of g.salientes[u]) if (g.rango[v] < rangoU) vecinas.push(v);
    for (const v of g.entrantes[u]) if (g.rango[v] < rangoU) vecinas.push(v);
    let x: number;
    let y: number;
    if (vecinas.length > 0) {
      let sx = 0;
      let sy = 0;
      for (const v of vecinas) {
        sx += pos[v * 2];
        sy += pos[v * 2 + 1];
      }
      sx /= vecinas.length;
      sy /= vecinas.length;
      // Brota alrededor de sus vecinas, en cualquier dirección, con un sesgo
      // suave hacia afuera de la colonia para que el micelio avance en vez de
      // apretarse.
      const salto = 26 + rnd() * 30;
      const haciaAfuera = Math.atan2(sy, sx);
      const a = rnd() < 0.35 ? haciaAfuera + (rnd() - 0.5) * 1.2 : rnd() * TAU;
      x = sx + Math.cos(a) * salto;
      y = sy + Math.sin(a) * salto;
    } else if (centro[g.colonia[u]].n > 0) {
      const c = centro[g.colonia[u]];
      const a = rnd() * TAU;
      const r = 30 + rnd() * 90;
      x = c.x / c.n + Math.cos(a) * r;
      y = c.y / c.n + Math.sin(a) * r;
    } else {
      const a = rnd() * TAU;
      x = Math.cos(a) * (frontera + 20);
      y = Math.sin(a) * (frontera + 20);
    }
    // Si el sitio está ocupado, empujar hacia afuera en espiral hasta hallar hueco.
    for (let intento = 0; intento < 40 && !libre(x, y); intento++) {
      const a = Math.atan2(y, x) + (rnd() - 0.5) * 0.6;
      const r = Math.hypot(x, y) + 12;
      x = Math.cos(a) * r;
      y = Math.sin(a) * r;
    }
    poner(u, x, y);
    const R = Math.hypot(x, y);
    if (R > frontera) frontera = R;
    const c = centro[g.colonia[u]];
    c.x += x;
    c.y += y;
    c.n++;
  }
  return { pos };
}

// ── Sustrato ─────────────────────────────────────────────────────────────────

/**
 * Siembra inicial del sustrato: cada nodo arranca en el sector angular de su
 * colonia, a una distancia al azar (determinista). Es solo el punto de partida
 * de la simulación de `MiniGraph.tsx`; con posiciones cacheadas no se usa.
 */
export function siembraSustrato(g: GrafoIndexado): Float64Array {
  const pos = new Float64Array(g.n * 2);
  const rnd = mulberry32(SEMILLA);
  const nColonias = Math.max(1, g.colonias.length);
  for (let u = 0; u < g.n; u++) {
    const a = (g.colonia[u] / nColonias) * TAU + (rnd() - 0.5) * 0.9;
    const r = 80 + rnd() * 380;
    pos[u * 2] = Math.cos(a) * r;
    pos[u * 2 + 1] = Math.sin(a) * r;
  }
  return pos;
}

// ── Utilidades compartidas por el dibujo ─────────────────────────────────────

export type Limites = { minX: number; minY: number; maxX: number; maxY: number };

/**
 * Caja que encierra a los nodos, para encuadrar la vista. Si hay nodos con
 * enlaces, las notas sueltas no cuentan: en Crecimiento caen en la frontera y
 * estirarían el encuadre hasta dejar la colonia diminuta.
 */
export function limitesDe(g: GrafoIndexado, pos: Float64Array): Limites {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let hayEnlazadas = false;
  for (let u = 0; u < g.n; u++) {
    if (g.conexiones[u] > 0) {
      hayEnlazadas = true;
      break;
    }
  }
  for (let u = 0; u < g.n; u++) {
    if (hayEnlazadas && g.conexiones[u] === 0) continue;
    const x = pos[u * 2];
    const y = pos[u * 2 + 1];
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  if (minX === Infinity) return { minX: -1, minY: -1, maxX: 1, maxY: 1 };
  return { minX, minY, maxX, maxY };
}

/** Los nodos más conectados (hasta 24, con 12 conexiones o más): los que se rotulan alejado. */
export function hubsDe(g: GrafoIndexado): number[] {
  return Array.from({ length: g.n }, (_, i) => i)
    .filter((i) => g.conexiones[i] >= 12)
    .sort((a, b) => g.conexiones[b] - g.conexiones[a] || compararIds(g.ids[a], g.ids[b]))
    .slice(0, 24);
}
