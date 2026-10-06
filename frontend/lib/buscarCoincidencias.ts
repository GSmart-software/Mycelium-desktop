/**
 * Núcleo puro del buscador de la nota (HU-31) cuando hay **bloques renderizados**
 * en la vista en vivo (`DEF-125`).
 *
 * El buscador recorría el texto del documento con la búsqueda de CodeMirror, que
 * resalta con decoraciones de marca. Una tabla renderizada (`FUN-L-19`) es un
 * widget que **reemplaza** su rango del documento: lo que hay ahí ya no es texto
 * del editor sino el DOM del widget, y una marca de CodeMirror sobre un rango
 * reemplazado no se dibuja. Las coincidencias de las celdas se contaban (sobre el
 * markdown) pero no se veían, y «siguiente» llevaba a la tabla sin marcar nada.
 *
 * Acá se arma la lista que usa el buscador en vivo: las coincidencias del texto
 * de CodeMirror que quedan FUERA de los bloques, más las de dentro de cada
 * bloque calculadas sobre lo que el bloque **muestra**, en orden de documento.
 *
 * Sin imports en runtime: se prueba headless en `scripts/test-buscar-tablas.mjs`.
 */

/**
 * Posiciones de cada aparición de `termino` en `texto`, sin solaparse.
 *
 * Es el mismo recorrido que hace `buscarEnDom` sobre el DOM: la n-ésima posición
 * de acá es el n-ésimo `Range` de allá, y de eso depende que la coincidencia
 * actual de una celda se pueda señalar antes de que su DOM exista.
 */
export function posicionesDe(texto: string, termino: string, sensible: boolean): number[] {
  if (termino === "") return [];
  const heno = sensible ? texto : texto.toLowerCase();
  const aguja = sensible ? termino : termino.toLowerCase();
  const res: number[] = [];
  let i = heno.indexOf(aguja);
  while (i >= 0) {
    res.push(i);
    // El avance nunca es 0: un término vacío ya se descartó arriba.
    i = heno.indexOf(aguja, i + aguja.length);
  }
  return res;
}

/**
 * Dónde está una coincidencia dentro de una tabla renderizada: la tabla (por la
 * posición donde arranca en el documento), la celda y cuál de las apariciones
 * de esa celda es. `fila` -1 es el encabezado; `fila`/`columna` null es una
 * tabla irregular, que el widget dibuja entera sin celdas editables.
 */
export type CeldaBuscada = {
  tabla: number;
  fila: number | null;
  columna: number | null;
  n: number;
};

/** Una coincidencia del buscador en vivo: texto del editor o dentro de una celda. */
export type Coincidencia = {
  desde: number;
  hasta: number;
  /** Solo las de una tabla renderizada. */
  celda?: CeldaBuscada;
};

/** Un bloque renderizado y lo que se ve en cada una de sus partes. */
export type BloqueBuscable = {
  desde: number;
  hasta: number;
  /** Texto visible por celda, en el orden en que se leen (fila a fila). */
  celdas: { fila: number | null; columna: number | null; texto: string }[];
};

/** Coincidencias de un bloque, en orden de lectura. */
export function coincidenciasDeBloque(
  bloque: BloqueBuscable,
  termino: string,
  sensible: boolean,
): Coincidencia[] {
  const res: Coincidencia[] = [];
  for (const c of bloque.celdas) {
    const pos = posicionesDe(c.texto, termino, sensible);
    for (let n = 0; n < pos.length; n++) {
      res.push({
        desde: bloque.desde,
        hasta: bloque.hasta,
        celda: { tabla: bloque.desde, fila: c.fila, columna: c.columna, n },
      });
    }
  }
  return res;
}

/**
 * Une las coincidencias del texto con las de los bloques, en orden de documento.
 *
 * Las del texto que caen dentro de un bloque se descartan: son del markdown que
 * el bloque oculta (`| a | b |`, los `**` de una negrita), y en su lugar van las
 * que el bloque muestra. Las dos listas llegan ordenadas por posición.
 */
export function combinarCoincidencias(
  texto: { desde: number; hasta: number }[],
  bloques: BloqueBuscable[],
  termino: string,
  sensible: boolean,
): Coincidencia[] {
  const res: Coincidencia[] = [];
  let b = 0;
  for (const m of texto) {
    // Primero los bloques que terminan antes de esta coincidencia.
    while (b < bloques.length && bloques[b].hasta <= m.desde) {
      res.push(...coincidenciasDeBloque(bloques[b], termino, sensible));
      b++;
    }
    const dentro = bloques.some((x) => m.desde < x.hasta && m.hasta > x.desde);
    if (!dentro) res.push({ desde: m.desde, hasta: m.hasta });
  }
  for (; b < bloques.length; b++) res.push(...coincidenciasDeBloque(bloques[b], termino, sensible));
  return res;
}

const mismaCelda = (a: CeldaBuscada, b: CeldaBuscada): boolean =>
  a.tabla === b.tabla && a.fila === b.fila && a.columna === b.columna && a.n === b.n;

/**
 * Índice de la coincidencia actual: la celda marcada, si hay una; si no, la del
 * texto que coincide exactamente con la selección (es lo que deja «siguiente»
 * sobre una del texto). -1 si ninguna.
 */
export function indiceActual(
  lista: Coincidencia[],
  celda: CeldaBuscada | null,
  sel: { from: number; to: number },
): number {
  if (celda) return lista.findIndex((c) => c.celda !== undefined && mismaCelda(c.celda, celda));
  return lista.findIndex((c) => !c.celda && c.desde === sel.from && c.hasta === sel.to);
}

/**
 * A cuál ir con siguiente/anterior. Circular, como `findNext` de CodeMirror:
 * desde la actual si la hay; si no, desde la selección.
 */
export function indiceSiguiente(
  lista: Coincidencia[],
  actual: number,
  sel: { from: number; to: number },
  adelante: boolean,
): number {
  const total = lista.length;
  if (total === 0) return -1;
  if (actual >= 0) return (actual + (adelante ? 1 : -1) + total) % total;
  if (adelante) {
    const i = lista.findIndex((c) => c.desde >= sel.to);
    return i >= 0 ? i : 0;
  }
  for (let i = total - 1; i >= 0; i--) if (lista[i].desde < sel.from) return i;
  return total - 1;
}

/**
 * El «n» del contador «n de m». Si hay una actual, esa; si no, como lo contaba
 * el buscador antes: las que empiezan en la selección o antes (mínimo 1).
 */
export function posicionEnContador(
  lista: Coincidencia[],
  actual: number,
  sel: { from: number },
): number {
  if (lista.length === 0) return 0;
  if (actual >= 0) return actual + 1;
  const antes = lista.filter((c) => c.desde <= sel.from).length;
  return Math.max(antes, 1);
}
