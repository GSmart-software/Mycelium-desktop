/**
 * La línea de historial de una pestaña (`DEF-040`), en funciones puras.
 *
 * Viven fuera de `stores/tabsStore.ts` para poder probarlas sin zustand
 * (`scripts/test-historial-pestana.mjs`). El store es quien las aplica; acá
 * solo se decide cómo queda la línea.
 */

/** Lo mínimo de una pestaña que hace falta para hablar de su historial. */
export type ConLinea = {
  notaId: string;
  historial?: string[];
  indice?: number;
};

export type Linea = { historial: string[]; indice: number };

/** Tope de entradas por línea de historial (DEF-040): se descartan las viejas. */
export const MAX_HISTORIAL = 50;

/**
 * Línea de historial de una pestaña, normalizada. Tolera las pestañas viejas
 * (sin `historial`/`indice`) y los índices fuera de rango: en ambos casos la
 * línea es simplemente el documento que la pestaña muestra ahora.
 */
export function lineaDe(tab: ConLinea): Linea {
  const historial =
    tab.historial && tab.historial.length > 0 ? tab.historial : [tab.notaId];
  const indice = Math.min(Math.max(tab.indice ?? historial.length - 1, 0), historial.length - 1);
  return { historial, indice };
}

/**
 * Añade `notaId` al final de la línea de `tab`: trunca la rama de adelante
 * (comportamiento estándar de un historial: navegar atrás y abrir otra cosa
 * descarta lo que había delante) y recorta a `MAX_HISTORIAL`.
 */
export function empujarEnLinea(tab: ConLinea, notaId: string): Linea {
  const { historial, indice } = lineaDe(tab);
  const linea = [...historial.slice(0, indice + 1), notaId].slice(-MAX_HISTORIAL);
  return { historial: linea, indice: linea.length - 1 };
}

/**
 * Línea con la que nace una pestaña abierta DESDE otra (`FUN-S-34`): un enlace
 * abierto en una pestaña nueva. Hereda la línea del origen hasta donde estaba
 * parado y suma el destino, así que «Atrás» en la pestaña nueva vuelve a la
 * nota de la que salió el enlace (como un navegador o Obsidian). La pestaña de
 * origen no cambia.
 *
 * Sin origen, o si alguno de los dos no es un documento navegable (el grafo,
 * una consola, un visor: `esNavegable` lo decide quien llama), la pestaña
 * nueva arranca una línea propia: volver desde una consola mataría su sesión.
 */
export function lineaHeredada(
  origen: ConLinea | null | undefined,
  notaId: string,
  esNavegable: (notaId: string) => boolean = () => true,
): Linea {
  if (!origen || !esNavegable(notaId) || !esNavegable(origen.notaId)) {
    return { historial: [notaId], indice: 0 };
  }
  // Abrir la misma nota que ya muestra no agrega un paso vacío a la línea.
  const { historial, indice } = lineaDe(origen);
  if (historial[indice] === notaId) return { historial: historial.slice(0, indice + 1), indice };
  return empujarEnLinea(origen, notaId);
}

/**
 * Línea de una pestaña abierta desde una flecha del historial con la rueda
 * (`FUN-S-13`): copia ENTERA la línea del origen y se para en el paso de
 * `delta`, como «abrir en pestaña nueva» sobre el botón atrás de un navegador.
 * Así la pestaña nueva puede seguir yendo atrás y adelante. Devuelve `null` si
 * no hay paso en esa dirección.
 */
export function lineaEnPaso(origen: ConLinea, delta: -1 | 1): Linea | null {
  const { historial, indice } = lineaDe(origen);
  const destino = indice + delta;
  if (destino < 0 || destino >= historial.length) return null;
  return { historial: [...historial], indice: destino };
}
