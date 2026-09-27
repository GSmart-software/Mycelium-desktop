// Revelado del cúmulo con niebla (`FUN-L-25` · Parte E, `DEF-109`).
//
// Sin caché de posiciones el grafo se calcula entero antes de dibujarse
// (precálculo a ciegas); después aparece ya ubicado, «como si una niebla se
// desvaneciera desde el centro»: la capa estática se pinta UNA vez y en cada
// frame del revelado se copia recortada a un disco que crece desde el centro
// del grafo, con el borde difuso hecho de anillos de opacidad decreciente.
//
// Por qué anillos con `clip` y no un gradiente radial compuesto
// (`destination-in`): medido a 1.600 × 900 con dpr 1,5 y rasterizado por
// software, el gradiente sobre el lienzo entero cuesta 2–3 veces la copia de la
// capa (42–86 ms contra 19–27), y seis anillos recortados, 1–1,4 veces (21–37):
// cada píxel se copia una vez, en el anillo que le toca.
//
// Módulo PURO (sin DOM): la geometría y el tiempo del revelado, para los tests.

/** Duración del fundido. */
export const DURACION_REVELADO_MS = 600;
/** Ancho del borde difuso, como fracción del radio que tiene que cubrir. */
export const BANDA_NIEBLA = 0.35;
/** Anillos del borde difuso (el disco interior, opaco, es el primero). */
export const ANILLOS_NIEBLA = 6;

/** Easing del frente de la niebla: sale rápido y se frena al final (cúbica). */
export function suavizar(t: number): number {
  const u = Math.min(Math.max(t, 0), 1);
  return 1 - (1 - u) ** 3;
}

/** Avance del revelado entre 0 y 1 según el tiempo transcurrido. */
export function progresoRevelado(transcurridoMs: number, duracionMs = DURACION_REVELADO_MS): number {
  if (duracionMs <= 0) return 1;
  return Math.min(Math.max(transcurridoMs / duracionMs, 0), 1);
}

/** Distancia desde `(cx, cy)` a la esquina más lejana del lienzo `w × h`. */
export function radioMaximo(cx: number, cy: number, w: number, h: number): number {
  const dx = Math.max(Math.abs(cx), Math.abs(w - cx));
  const dy = Math.max(Math.abs(cy), Math.abs(h - cy));
  return Math.hypot(dx, dy);
}

/** Un anillo de la niebla: la corona entre `interior` y `exterior`, con opacidad `alfa`. */
export type AnilloNiebla = { interior: number; exterior: number; alfa: number };

/**
 * Los anillos del revelado con el frente en `avance` (0–1, ya suavizado): el
 * frente va de 0 (nada visible) a `rMax + banda` (todo opaco hasta `rMax`).
 * El primero es el disco opaco (`interior` 0); los siguientes, coronas
 * contiguas con opacidad decreciente hasta el frente. Se omiten los que
 * todavía no tienen radio.
 */
export function anillosNiebla(
  avance: number,
  rMax: number,
  banda = rMax * BANDA_NIEBLA,
  n = ANILLOS_NIEBLA,
): AnilloNiebla[] {
  const frente = Math.min(Math.max(avance, 0), 1) * (rMax + banda);
  const anillos: AnilloNiebla[] = [];
  for (let j = 0; j < n; j++) {
    const exterior = frente - banda + (banda * (j + 1)) / n;
    if (exterior <= 0) continue;
    const interior = j === 0 ? 0 : Math.max(0, frente - banda + (banda * j) / n);
    anillos.push({ interior, exterior, alfa: 1 - j / n });
  }
  return anillos;
}
