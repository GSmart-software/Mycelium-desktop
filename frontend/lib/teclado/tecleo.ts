/**
 * Saltar tecleando en una lista (`FUN-XL-04`, rediseño del 2026-11-06), como
 * en el Explorador de Windows: con el foco en un elemento de una lista (el
 * árbol, los resultados, las Esporas, la papelera, las filas de una tabla),
 * teclear letras salta al siguiente elemento cuyo nombre empieza con lo
 * tecleado. Si se teclea rápido (menos de `ESPERA_TECLEO` ms entre letras), lo
 * tecleado se acumula («not» → «Notas»); si no, se empieza de nuevo. Sin
 * tildes ni mayúsculas: «indice» encuentra «Índice».
 *
 * Lógica pura —sin DOM— para que la pruebe `scripts/test-pistas.mjs`; lo que
 * escucha las teclas y mueve el foco está en `tecleoDom.ts`.
 */

/** Cuánto se espera entre letras para seguir acumulando (ms). */
export const ESPERA_TECLEO = 700;

/** Un nombre para comparar: sin tildes, en minúsculas y sin espacios al comienzo. */
export function normalizarNombre(nombre: string): string {
  return nombre.normalize("NFD").replace(/\p{M}/gu, "").toLocaleLowerCase("es").trimStart();
}

/** Lo que se lleva tecleado y cuándo fue la última letra. */
export type Tecleo = { texto: string; momento: number };

/**
 * Suma una letra a lo tecleado: si pasó más de `ESPERA_TECLEO` desde la
 * anterior, empieza de nuevo.
 */
export function acumularTecleo(previo: Tecleo | null, letra: string, ahora: number): Tecleo {
  const sigue = previo !== null && ahora - previo.momento <= ESPERA_TECLEO;
  return { texto: (sigue ? previo.texto : "") + normalizarNombre(letra), momento: ahora };
}

/**
 * El índice del elemento al que se salta, o `null` si ninguno empieza así.
 *
 * - Con **una** letra, se busca desde el **siguiente** al actual (con vuelta):
 *   teclear «n» varias veces recorre todos los que empiezan con «n».
 * - Con **más** letras, desde el **actual** (incluido): «no» y luego «not» no
 *   saltan de «Notas» a otro si «Notas» ya sirve.
 * - Lo tecleado con la misma letra repetida («nnn») se toma como esa letra:
 *   es el que recorre, no el que busca «nnn».
 */
export function saltoPorTecleo(nombres: readonly string[], actual: number, tecleado: string): number | null {
  const n = nombres.length;
  if (n === 0 || !tecleado) return null;
  const repetida = [...tecleado].every((c) => c === tecleado[0]);
  const buscado = repetida ? tecleado[0] : tecleado;
  const desde = buscado.length === 1 ? actual + 1 : Math.max(actual, 0);
  for (let k = 0; k < n; k++) {
    const i = (((desde + k) % n) + n) % n;
    if (normalizarNombre(nombres[i]).startsWith(buscado)) return i;
  }
  return null;
}
