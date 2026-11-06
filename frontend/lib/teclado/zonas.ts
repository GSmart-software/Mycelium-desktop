/**
 * Zonas y modos del teclado (`FUN-XL-04`, Parte 2): la lógica pura —sin DOM,
 * React ni stores— de cómo se recorren las zonas con F6, a qué panel se pasa
 * con Ctrl+Alt+←/→, en qué modo queda un documento después de cambiar de
 * pestaña y cuándo Esc saca de escribir. La pruebas `scripts/test-teclado-zonas.mjs`;
 * lo que toca el DOM está en `focoDom.ts`.
 *
 * **Las zonas.** La app se parte en zonas, marcadas en el DOM con `data-zona`:
 * la barra superior (nombre, vaults, buscador y controles de la ventana; desde
 * la prueba de cobertura del 2026-11-06, que la encontró fuera de F6), el rail, el panel izquierdo (la sección del rail que esté abierta), cada
 * panel de la pantalla dividida (barra de pestañas + documento), el panel de
 * enlaces de un panel si está abierto y la barra de estado. F6 / Shift+F6 las
 * recorren en el **orden del documento**, que es el visual: la barra superior, el rail, el panel
 * izquierdo, los paneles de izquierda a derecha y de arriba abajo —cada uno
 * seguido de su panel de enlaces— y la barra de estado.
 *
 * **Los dos modos.** Un documento (`data-documento`, el cuerpo de un panel)
 * está **seleccionado** —modo navegar— cuando el foco está en él mismo, y en
 * modo **escribir** cuando el foco está adentro. Esc pasa de escribir a
 * navegar y Enter vuelve.
 */

/** Las zonas, en el orden en que aparecen en la ventana. */
export const ZONAS = ["superior", "rail", "izquierda", "panel", "lateral", "estado"] as const;
export type Zona = (typeof ZONAS)[number];

/**
 * El índice de la zona siguiente (`delta` 1) o anterior (-1), con vuelta. Si
 * el foco no está en ninguna (`actual` -1, por ejemplo en la barra superior),
 * F6 va a la primera y Shift+F6 a la última. Sin zonas, -1.
 */
export function zonaVecina(total: number, actual: number, delta: 1 | -1): number {
  if (total <= 0) return -1;
  if (actual < 0 || actual >= total) return delta === 1 ? 0 : total - 1;
  return (actual + delta + total) % total;
}

export type Caja = { left: number; top: number; right: number; bottom: number };

/**
 * El panel contiguo a la izquierda o a la derecha del activo, para
 * Ctrl+Alt+←/→. Por geometría: el más cercano en esa dirección y, entre los
 * que están igual de cerca, el que más comparte la altura del activo. Si no
 * hay ninguno de ese lado (paneles apilados arriba y abajo), el anterior o el
 * siguiente en el orden de la división, sin dar la vuelta. `null` si no hay
 * adónde ir.
 */
export function panelContiguo(
  paneles: readonly { id: string; caja: Caja }[],
  activoId: string,
  dir: "izquierda" | "derecha",
): string | null {
  const i = paneles.findIndex((p) => p.id === activoId);
  if (i < 0) return null;
  const a = paneles[i].caja;
  // Tolerancia: el divisor entre dos paneles mide unos píxeles.
  const TOL = 8;
  let mejor: { id: string; distancia: number; solape: number } | null = null;
  for (const p of paneles) {
    if (p.id === activoId) continue;
    const c = p.caja;
    const distancia = dir === "derecha" ? c.left - a.right : a.left - c.right;
    if (distancia < -TOL) continue;
    const solape = Math.min(a.bottom, c.bottom) - Math.max(a.top, c.top);
    if (
      mejor === null ||
      distancia < mejor.distancia - TOL ||
      (Math.abs(distancia - mejor.distancia) <= TOL && solape > mejor.solape)
    ) {
      mejor = { id: p.id, distancia, solape };
    }
  }
  if (mejor) return mejor.id;
  const j = dir === "derecha" ? i + 1 : i - 1;
  return j >= 0 && j < paneles.length ? paneles[j].id : null;
}

/** Qué clase de documento muestra una pestaña, para decidir dónde va el foco. */
export type ClaseDocumento = "editor" | "consola" | "otro";

/**
 * La clase de documento de una pestaña: `tipoPestana` es el de
 * `lib/pestanas.ts` y `tipoNota`, el de la nota (solo cuenta si es una nota).
 */
export function claseDeDocumento(tipoPestana: string, tipoNota: string | null): ClaseDocumento {
  if (tipoPestana === "terminal") return "consola";
  if (tipoPestana === "nota" && (tipoNota === null || tipoNota === "markdown")) return "editor";
  return "otro";
}

export type Modo = "navegar" | "escribir";

/**
 * En qué modo queda el documento activo después de Ctrl+Tab, Ctrl+Shift+Tab,
 * Ctrl+W, Ctrl+Shift+T o de cambiar de panel con el teclado.
 *
 * Por defecto, **navegar**: el documento queda seleccionado y Enter entra.
 * Nunca en `body`, que obligaba a empezar de nuevo desde arriba.
 *
 * La excepción: si se venía escribiendo en un editor de notas y lo que queda
 * es otro editor de notas, se sigue escribiendo (con el cursor donde estaba en
 * esa nota). Es lo que hace un editor de código al pasar de archivo, y quien
 * cambia de nota con Ctrl+Tab mientras escribe quiere seguir escribiendo; un
 * Esc de más para volver a entrar sería un estorbo en el caso más común.
 *
 * Una consola **nunca** recibe el foco sola: xterm se queda con casi todo el
 * teclado y solo F6 lo saca. Queda seleccionada y Enter entra.
 */
export function modoTrasCambio(veniaEscribiendoEnEditor: boolean, destino: ClaseDocumento): Modo {
  return veniaEscribiendoEnEditor && destino === "editor" ? "escribir" : "navegar";
}

/** Lo que se mira antes y después de que la app atienda un Esc. */
export type FotoEsc = {
  /** El elemento con el foco (cualquier cosa comparable). */
  foco: unknown;
  /** El valor del campo con el foco, si es un campo de texto. */
  valor: string | null;
  /** Cuántos menús, listas, diálogos y paneles emergentes hay abiertos. */
  emergentes: number;
};

/**
 * ¿Este Esc saca de escribir? Solo si **no había nada que cerrar**: nadie lo
 * atendió (`defaultPrevented`), el foco no se movió (cerrar algo suele
 * devolverlo a otro lado o dejarlo en `body`), el campo no cambió (Esc que
 * vacía un buscador) y no se cerró ningún emergente (autocompletado, menú,
 * diálogo). Si había algo abierto, ese Esc lo cerró y el siguiente saca.
 */
export function escSaleDeEscribir(prevenido: boolean, antes: FotoEsc, despues: FotoEsc): boolean {
  if (prevenido) return false;
  if (antes.foco !== despues.foco) return false;
  if (antes.valor !== despues.valor) return false;
  return despues.emergentes >= antes.emergentes;
}
