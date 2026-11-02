/**
 * Paleta de las gráficas, derivada del tema activo (`FUN-L-32`).
 *
 * Regla del usuario (2026-11-02): «no utilicemos colores distintos al del tema».
 * Por eso no hay una paleta fija: se arma en tiempo de ejecución, en OKLCH, con
 * el acento y el glow del tema, variando la luminosidad. Así sirve igual con
 * los temas de fábrica, con uno propio y con un snippet que pise los colores.
 *
 * - `rampaTonal`: cuatro pasos de luminosidad del acento (oscuro) al glow (claro).
 * - `paletaGrupos`: cada grupo de archivos (Notas, Imágenes, PDF, Visuales)
 *   recibe SIEMPRE el mismo paso para ese tema —el color sigue al tipo, no a
 *   su tamaño—, elegido para que los vecinos se distingan en el anillo y en la
 *   torta. «Otros» es el gris del tema.
 * - `leerPaletaGraficas`: la única función con DOM; lee los tokens resueltos y
 *   guarda en caché el resultado por combinación de colores.
 *
 * Sin imports a propósito: los tests lo transpilan solo
 * (`scripts/test-paleta-graficas.mjs`). El hook de React vive aparte, en
 * `lib/usePaletaGraficas.ts`.
 *
 * Implementación de referencia: `scratchpad/dash/paleta3.mjs` y `paleta2.mjs`
 * de la sesión del 2026-11-02 (spec `docs/features/salud-dashboard.md`). La
 * simulación de daltonismo y la ΔE vienen del validador de la skill `dataviz`
 * (`validate_palette.mjs`, funciones `simulate` y `deltaE`).
 */

export type ModoGrafica = "claro" | "oscuro";

/** Los grupos de archivos que comparten color en todas las gráficas. */
export type GrupoGrafica = "notas" | "imagenes" | "pdf" | "visuales" | "otros";

/** Orden del anillo y de la barra apilada; el último toca al primero. */
export const ORDEN_ANILLO: readonly GrupoGrafica[] = ["notas", "imagenes", "pdf", "visuales", "otros"];

/**
 * Orden de la torta por tamaño típico de un vault (lo que más pesa, primero).
 * Es el orden en que se declaran las porciones en Mermaid y, por eso, el de
 * `pie1`…`pie5` (ver `lib/mermaidTema.ts`).
 */
export const ORDEN_TORTA: readonly GrupoGrafica[] = ["imagenes", "pdf", "notas", "visuales", "otros"];

/** Luminosidades OKLCH de los cuatro pasos (spec, «Colores de las gráficas»). */
const LUMINOSIDADES: Record<ModoGrafica, readonly number[]> = {
  claro: [0.3, 0.46, 0.62, 0.79],
  oscuro: [0.52, 0.665, 0.81, 0.955],
};

/** Saturación mínima de la rampa: por debajo, un paso se lee gris. */
const SATURACION_MINIMA = 0.06;

type Vec3 = [number, number, number];

// ── sRGB ↔ OKLab ↔ OKLCH ─────────────────────────────────────────────────────

const aLineal = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const aGamma = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);
const acotar = (x: number) => Math.min(1, Math.max(0, x));

/** `#rgb` o `#rrggbb` → sRGB 0..1. Otro formato → null. */
export function hexARgb(hex: string): Vec3 | null {
  const v = hex.trim().toLowerCase();
  let m = /^#([0-9a-f]{3})$/.exec(v);
  if (m) return [0, 1, 2].map((i) => parseInt(m![1][i] + m![1][i], 16) / 255) as Vec3;
  m = /^#([0-9a-f]{6})$/.exec(v);
  if (m) return [0, 2, 4].map((i) => parseInt(m![1].slice(i, i + 2), 16) / 255) as Vec3;
  return null;
}

function rgbLineal(hex: string): Vec3 {
  return (hexARgb(hex) ?? [0.5, 0.5, 0.5]).map(aLineal) as Vec3;
}

function oklabDeLineal([r, g, b]: Vec3): Vec3 {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

/** `#rrggbb` → [L 0..1, C, H en grados]. */
export function hexAOklch(hex: string): Vec3 {
  const [L, a, b] = oklabDeLineal(rgbLineal(hex));
  return [L, Math.hypot(a, b), ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360];
}

/** OKLCH → sRGB lineal, sin recortar (puede salir del rango 0..1). */
function oklchALineal(L: number, C: number, H: number): Vec3 {
  const a = C * Math.cos((H * Math.PI) / 180);
  const b = C * Math.sin((H * Math.PI) / 180);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

const enGamut = (v: Vec3) => v.every((x) => x >= -0.0005 && x <= 1.0005);

/**
 * OKLCH → `#rrggbb`. Si el color no entra en sRGB, baja la saturación (de a
 * 0,003) conservando la luminosidad y el tono: recortar canal por canal
 * cambiaría el tono, y en una rampa de un solo tono eso se nota.
 */
export function oklchAHex(L: number, C: number, H: number): string {
  let c = C;
  while (c > 0 && !enGamut(oklchALineal(L, c, H))) c -= 0.003;
  return (
    "#" +
    oklchALineal(L, Math.max(c, 0), H)
      .map((v) =>
        Math.round(acotar(aGamma(acotar(v))) * 255)
          .toString(16)
          .padStart(2, "0"),
      )
      .join("")
  );
}

// ── distancia perceptual y daltonismo ────────────────────────────────────────

/**
 * Machado, Oliveira y Fernandes (2009), severidad 1.0, sobre sRGB lineal. Los
 * umbrales de la spec (ΔE ≥ 8 con daltonismo) están calibrados con este modelo.
 */
const MACHADO = {
  protan: [
    [0.152286, 1.052583, -0.204868],
    [0.114503, 0.786281, 0.099216],
    [-0.003882, -0.048116, 1.051998],
  ],
  deutan: [
    [0.367322, 0.860646, -0.227968],
    [0.280085, 0.672501, 0.047413],
    [-0.01182, 0.04294, 0.968881],
  ],
} as const;

export type Daltonismo = keyof typeof MACHADO;

function simular(hex: string, tipo: Daltonismo): Vec3 {
  const [r, g, b] = rgbLineal(hex);
  return MACHADO[tipo].map((f) => acotar(f[0] * r + f[1] * g + f[2] * b)) as Vec3;
}

/** Distancia euclídea en OKLab ×100; con `tipo`, vista con ese daltonismo. */
export function deltaE(a: string, b: string, tipo?: Daltonismo): number {
  const la = oklabDeLineal(tipo ? simular(a, tipo) : rgbLineal(a));
  const lb = oklabDeLineal(tipo ? simular(b, tipo) : rgbLineal(b));
  return 100 * Math.hypot(la[0] - lb[0], la[1] - lb[1], la[2] - lb[2]);
}

/** Contraste WCAG (1 a 21). */
export function contrasteWcag(a: string, b: string): number {
  const lum = (h: string) => {
    const [r, g, bl] = rgbLineal(h);
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

// ── la rampa y la asignación ─────────────────────────────────────────────────

/**
 * Cuatro pasos del acento al glow: la luminosidad es fija por modo; el tono y
 * la saturación se interpolan (el tono por el camino corto del círculo). En
 * claro va de oscuro a medio, en oscuro de medio a muy claro: así todos se
 * despegan del fondo.
 */
export function rampaTonal(acento: string, glow: string, modo: ModoGrafica): string[] {
  return tonos(acento, glow, LUMINOSIDADES[modo]);
}

function tonos(acento: string, glow: string, luminosidades: readonly number[]): string[] {
  const [, CA, hA] = hexAOklch(acento);
  const [, CG, hG] = hexAOklch(glow);
  const dh = ((hG - hA + 540) % 360) - 180;
  const ultimo = Math.max(1, luminosidades.length - 1);
  return luminosidades.map((L, i) => {
    const t = i / ultimo;
    return oklchAHex(L, Math.max(SATURACION_MINIMA, CA + (CG - CA) * t), (hA + dh * t + 360) % 360);
  });
}

/**
 * `n` tonos más del tema, para gráficas con más de cinco series (las porciones
 * 6 a 12 de una torta de Mermaid escrita a mano). Reparten la misma franja de
 * luminosidad de la rampa y van intercalados (oscuro, claro, medio…) para que
 * los vecinos no se confundan. Algunos quedan cerca de los cuatro pasos: con
 * tantas series, la leyenda es la que distingue.
 */
export function tonosExtra(acento: string, glow: string, modo: ModoGrafica, n: number): string[] {
  if (n <= 0) return [];
  const [L0, , , L1] = LUMINOSIDADES[modo];
  const ls = Array.from({ length: n }, (_, i) => L0 + ((L1 - L0) * (i + 0.5)) / n);
  const lista = tonos(acento, glow, ls);
  // Intercalado: 0, n-1, 1, n-2… separa en luminosidad a cada par de vecinos.
  const salida: string[] = [];
  for (let i = 0, j = n - 1; i <= j; i++, j--) {
    salida.push(lista[i]);
    if (i !== j) salida.push(lista[j]);
  }
  return salida;
}

/** Separación de una paleta, en ΔE ×100 redondeada a un decimal. */
export type SeparacionPaleta = {
  /** Peor par de vecinos (anillo y torta) con protanopía o deuteranopía. */
  vecinosDaltonismo: number;
  /** Peor par de vecinos con visión normal. */
  vecinosNormal: number;
  /** Peor par de todos contra todos, con daltonismo. */
  todosDaltonismo: number;
  /** Peor par de todos contra todos, con visión normal. */
  todosNormal: number;
};

export type PaletaGraficas = {
  modo: ModoGrafica;
  /** El color de cada grupo, fijo para este tema. */
  grupos: Record<GrupoGrafica, string>;
  /** Los cinco colores en el orden de la torta (`ORDEN_TORTA`). */
  torta: string[];
  /** Los cuatro pasos, de oscuro a claro. */
  rampa: string[];
  /** Para las gráficas de una sola serie. */
  acento: string;
  glow: string;
  /** El de «Otros» y el de lo que no cuenta (las huérfanas). */
  gris: string;
  /** El fondo contra el que se midió el contraste. */
  superficie: string;
  /** Contraste WCAG de cada grupo contra `superficie` (menos de 3:1 pide etiqueta). */
  contraste: Record<GrupoGrafica, number>;
  separacion: SeparacionPaleta;
};

/** Todas las permutaciones, en orden lexicográfico (el desempate es el primero). */
function permutaciones<T>(a: T[]): T[][] {
  if (a.length <= 1) return [a];
  return a.flatMap((x, i) => permutaciones([...a.slice(0, i), ...a.slice(i + 1)]).map((p) => [x, ...p]));
}

/** Con un decimal, como compara la referencia (que parseaba el texto del validador). */
const unDecimal = (x: number) => Number(x.toFixed(1));

type Pares = [number, number][];
const paresVecinos = (n: number): Pares => Array.from({ length: n - 1 }, (_, i) => [i, i + 1]);
const paresTodos = (n: number): Pares =>
  Array.from({ length: n }, (_, i) => Array.from({ length: n - i - 1 }, (_, k) => [i, i + 1 + k] as [number, number])).flat();

function peorDaltonismo(colores: string[], pares: Pares): number {
  let peor = Infinity;
  for (const tipo of ["protan", "deutan"] as const)
    for (const [i, j] of pares) peor = Math.min(peor, deltaE(colores[i], colores[j], tipo));
  return unDecimal(peor);
}

function peorNormal(colores: string[], pares: Pares): number {
  let peor = Infinity;
  for (const [i, j] of pares) peor = Math.min(peor, deltaE(colores[i], colores[j]));
  return unDecimal(peor);
}

/**
 * La paleta de los grupos: prueba las 24 maneras de repartir los cuatro pasos
 * entre Notas, Imágenes, PDF y Visuales, y se queda con la que más separa a
 * los vecinos en los dos órdenes en que se dibujan (el anillo, que cierra en
 * Notas, y la torta por tamaño, que también cierra), sin descuidar la
 * separación de todos contra todos. Puntaje de la referencia:
 * `min(cvd,20) + min(nv,30) + min(cvdTodos,12) + min(nvTodos,15)`; los topes
 * evitan que un par muy separado compense a otro pegado.
 */
export function paletaGrupos(
  acento: string,
  glow: string,
  gris: string,
  modo: ModoGrafica,
  superficie: string,
): PaletaGraficas {
  const rampa = rampaTonal(acento, glow, modo);
  let mejor: { puntaje: number; pal: string[]; sep: SeparacionPaleta } | null = null;
  for (const p of permutaciones([0, 1, 2, 3])) {
    const pal = p.map((i) => rampa[i]); // Notas, Imágenes, PDF, Visuales
    const anillo = [...pal, gris, pal[0]];
    const torta = [pal[1], pal[2], pal[0], pal[3], gris, pal[1]];
    const cinco = [...pal, gris];
    const sep: SeparacionPaleta = {
      vecinosDaltonismo: Math.min(
        peorDaltonismo(anillo, paresVecinos(anillo.length)),
        peorDaltonismo(torta, paresVecinos(torta.length)),
      ),
      vecinosNormal: Math.min(peorNormal(anillo, paresVecinos(anillo.length)), peorNormal(torta, paresVecinos(torta.length))),
      todosDaltonismo: peorDaltonismo(cinco, paresTodos(5)),
      todosNormal: peorNormal(cinco, paresTodos(5)),
    };
    const puntaje =
      Math.min(sep.vecinosDaltonismo, 20) +
      Math.min(sep.vecinosNormal, 30) +
      Math.min(sep.todosDaltonismo, 12) +
      Math.min(sep.todosNormal, 15);
    if (!mejor || puntaje > mejor.puntaje) mejor = { puntaje, pal, sep };
  }
  const [notas, imagenes, pdf, visuales] = mejor!.pal;
  const grupos: Record<GrupoGrafica, string> = { notas, imagenes, pdf, visuales, otros: gris };
  const contraste = Object.fromEntries(
    Object.entries(grupos).map(([g, c]) => [g, contrasteWcag(c, superficie)]),
  ) as Record<GrupoGrafica, number>;
  return {
    modo,
    grupos,
    torta: ORDEN_TORTA.map((g) => grupos[g]),
    rampa,
    acento,
    glow,
    gris,
    superficie,
    contraste,
    separacion: mejor!.sep,
  };
}

// ── lectura del tema activo (la única parte con DOM) ─────────────────────────

/**
 * Los tokens que se leen. Son los semánticos (`--mic-accent`, no
 * `--mic-raw-accent`): por defecto valen lo mismo que los crudos, pero además
 * siguen a un snippet —la ayuda enseña a pisar `--mic-accent`— y a la
 * atmósfera, que cambia el lienzo y la tinta tenue.
 */
const TOKENS = {
  acento: ["--mic-accent", "--mic-raw-accent"],
  glow: ["--mic-glow", "--mic-raw-glow"],
  gris: ["--mic-text-muted", "--mic-raw-ink-muted"],
  superficie: ["--mic-bg-canvas", "--mic-raw-canvas", "--mic-raw-mist"],
} as const;

/** Bioluminiscencia claro: lo que se usa sin DOM (render en el servidor, tests). */
export const TOKENS_POR_DEFECTO = {
  acento: "#0e7c8c",
  glow: "#16b8c9",
  gris: "#59696c",
  superficie: "#f1f6f7",
  modo: "claro" as ModoGrafica,
};

const cache = new Map<string, PaletaGraficas>();

/** La paleta para estos colores, calculada una sola vez por combinación. */
export function paletaEnCache(
  acento: string,
  glow: string,
  gris: string,
  modo: ModoGrafica,
  superficie: string,
): PaletaGraficas {
  // En minúsculas: el mismo color escrito distinto es la misma entrada.
  const [a, g, gr, s] = [acento, glow, gris, superficie].map((c) => c.trim().toLowerCase());
  const clave = [a, g, gr, modo, s].join("|");
  let p = cache.get(clave);
  if (!p) {
    p = paletaGrupos(a, g, gr, modo, s);
    // Un tema propio editado en vivo podría ir sumando entradas: con unas pocas alcanza.
    if (cache.size >= 16) cache.delete(cache.keys().next().value!);
    cache.set(clave, p);
  }
  return p;
}

/**
 * Lee los colores del tema activo vistos desde `dentro` (así cuenta un snippet
 * que los pise solo en `.mic-preview`) y devuelve la paleta. Los tokens pueden
 * llevar `color-mix()`, que `getComputedStyle` no resuelve en una variable: se
 * pinta cada color en un píxel de un canvas y se lee, como en `lib/mermaid.ts`.
 * El modo sale del `data-dark` de `<html>`.
 */
export function leerPaletaGraficas(dentro?: Element): PaletaGraficas {
  if (typeof document === "undefined") {
    const d = TOKENS_POR_DEFECTO;
    return paletaEnCache(d.acento, d.glow, d.gris, d.modo, d.superficie);
  }
  const raiz = document.documentElement;
  const host = dentro ?? document.body ?? raiz;
  const modo: ModoGrafica = raiz.getAttribute("data-dark") === "true" ? "oscuro" : "claro";

  const sonda = document.createElement("span");
  sonda.style.display = "none";
  host.appendChild(sonda);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 1;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  const hex = (n: number) => Math.round(n).toString(16).padStart(2, "0");
  let fondo: Vec3 = modo === "oscuro" ? [0, 0, 0] : [255, 255, 255];

  /** El primer token que tenga valor, como `#rrggbb` opaco (compuesto sobre `fondo`). */
  const resolver = (tokens: readonly string[], porDefecto: string): string => {
    const estilo = getComputedStyle(host);
    const token = tokens.find((t) => estilo.getPropertyValue(t).trim() !== "");
    if (!token || !ctx) return porDefecto;
    sonda.style.color = "";
    sonda.style.color = `var(${token})`;
    const css = getComputedStyle(sonda).color;
    ctx.clearRect(0, 0, 1, 1);
    ctx.fillStyle = "#000000";
    ctx.fillStyle = css;
    ctx.fillRect(0, 0, 1, 1);
    const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
    const al = a / 255;
    return "#" + [r, g, b].map((c, i) => hex(c * al + fondo[i] * (1 - al))).join("");
  };

  try {
    const d = TOKENS_POR_DEFECTO;
    const superficie = resolver(TOKENS.superficie, d.superficie);
    fondo = (hexARgb(superficie) ?? [1, 1, 1]).map((c) => c * 255) as Vec3;
    return paletaEnCache(
      resolver(TOKENS.acento, d.acento),
      resolver(TOKENS.glow, d.glow),
      resolver(TOKENS.gris, d.gris),
      modo,
      superficie,
    );
  } finally {
    sonda.remove();
  }
}
