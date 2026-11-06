/**
 * Navegación con el teclado dentro de los componentes (`FUN-XL-04`, Parte 7):
 * la lógica pura —sin DOM ni React— de qué elemento sigue al pulsar una flecha
 * en el grafo y en el lienzo, cómo se mueve la fecha elegida en la grilla del
 * calendario, qué fila sigue en una tabla y cuánto vale un divisor de tamaño
 * tras una tecla. La prueba `scripts/test-teclado-componentes.mjs`.
 */

export type Direccion = "izquierda" | "derecha" | "arriba" | "abajo";

/** La dirección de una flecha (`KeyboardEvent.key`), o `null` si no es una flecha. */
export function direccionDeTecla(key: string): Direccion | null {
  switch (key) {
    case "ArrowLeft":
      return "izquierda";
    case "ArrowRight":
      return "derecha";
    case "ArrowUp":
      return "arriba";
    case "ArrowDown":
      return "abajo";
    default:
      return null;
  }
}

export type Punto = { x: number; y: number };

/**
 * El vecino más cercano en una dirección (pantalla: `y` crece hacia abajo).
 *
 * Se mide el avance en la dirección pedida (`avance`, tiene que ser positivo) y
 * el desvío hacia el costado (`desvio`). Primero se buscan los que están dentro
 * de un cono de unos 63° a cada lado (`desvio <= 2 * avance`): es lo que el ojo
 * entiende por «el de la derecha». Entre ellos gana el de menor
 * `avance + 2 * desvio`, que prefiere al que está alineado aunque quede un poco
 * más lejos. Si no hay ninguno en el cono, se acepta cualquiera que avance algo,
 * con la misma cuenta: una flecha que no lleva a ningún lado cuando hay algo de
 * ese lado se siente rota. Sin nada de ese lado, `null`.
 */
export function vecinoEnDireccion<T extends Punto>(
  origen: Punto,
  candidatos: readonly T[],
  dir: Direccion,
): T | null {
  let mejorCono: { c: T; puntaje: number } | null = null;
  let mejorFuera: { c: T; puntaje: number } | null = null;
  for (const c of candidatos) {
    const dx = c.x - origen.x;
    const dy = c.y - origen.y;
    const avance = dir === "derecha" ? dx : dir === "izquierda" ? -dx : dir === "abajo" ? dy : -dy;
    const desvio = Math.abs(dir === "derecha" || dir === "izquierda" ? dy : dx);
    if (avance <= 0.5) continue;
    const puntaje = avance + 2 * desvio;
    if (desvio <= 2 * avance) {
      if (mejorCono === null || puntaje < mejorCono.puntaje) mejorCono = { c, puntaje };
    } else if (mejorFuera === null || puntaje < mejorFuera.puntaje) {
      mejorFuera = { c, puntaje };
    }
  }
  return (mejorCono ?? mejorFuera)?.c ?? null;
}

/** El punto más cercano a otro (para empezar «por el del medio»). `null` sin candidatos. */
export function masCercano<T extends Punto>(origen: Punto, candidatos: readonly T[]): T | null {
  let mejor: T | null = null;
  let d2 = Infinity;
  for (const c of candidatos) {
    const d = (c.x - origen.x) ** 2 + (c.y - origen.y) ** 2;
    if (d < d2) {
      d2 = d;
      mejor = c;
    }
  }
  return mejor;
}

/**
 * Cuánto hay que desplazar una vista para que una caja (en píxeles de pantalla,
 * relativos al contenedor) quede adentro con un margen. `{ dx: 0, dy: 0 }` si ya
 * se ve. Si la caja es más grande que el contenedor, se alinea su esquina de
 * arriba a la izquierda.
 */
export function desplazamientoParaVer(
  caja: { left: number; top: number; right: number; bottom: number },
  ancho: number,
  alto: number,
  margen = 24,
): { dx: number; dy: number } {
  const eje = (a: number, b: number, total: number) => {
    if (b - a > total - 2 * margen) return margen - a;
    if (a < margen) return margen - a;
    if (b > total - margen) return total - margen - b;
    return 0;
  };
  return { dx: eje(caja.left, caja.right, ancho), dy: eje(caja.top, caja.bottom, alto) };
}

// ── calendario ────────────────────────────────────────────────────────────

/**
 * Lo que hace una tecla en la grilla del calendario (patrón «grid» de ARIA):
 * ← → un día, ↑ ↓ una semana, Inicio / Fin al primer o último día de la fila
 * (`columna` es la del día elegido, de 0 a 6), RePág / AvPág un mes (con Shift,
 * un año). `null` si la tecla no es de la grilla.
 */
export function pasoDeCalendario(
  key: string,
  columna: number,
  shift = false,
): { dias: number } | { meses: number } | null {
  switch (key) {
    case "ArrowLeft":
      return { dias: -1 };
    case "ArrowRight":
      return { dias: 1 };
    case "ArrowUp":
      return { dias: -7 };
    case "ArrowDown":
      return { dias: 7 };
    case "Home":
      return { dias: -columna };
    case "End":
      return { dias: 6 - columna };
    case "PageUp":
      return { meses: shift ? -12 : -1 };
    case "PageDown":
      return { meses: shift ? 12 : 1 };
    default:
      return null;
  }
}

// ── listas (filas de una tabla) ──────────────────────────────────────────

/**
 * La fila que sigue en una lista de `total` con una tecla: ↑ ↓ una, Inicio / Fin
 * la primera y la última, RePág / AvPág de a `pagina`. Sin dar la vuelta. `null`
 * si la tecla no es de la lista o no hay filas.
 */
export function pasoDeLista(indice: number, total: number, key: string, pagina = 10): number | null {
  if (total <= 0) return null;
  const i = Math.min(Math.max(indice, 0), total - 1);
  const limitar = (n: number) => Math.min(Math.max(n, 0), total - 1);
  switch (key) {
    case "ArrowUp":
      return limitar(i - 1);
    case "ArrowDown":
      return limitar(i + 1);
    case "Home":
      return 0;
    case "End":
      return total - 1;
    case "PageUp":
      return limitar(i - pagina);
    case "PageDown":
      return limitar(i + pagina);
    default:
      return null;
  }
}

/**
 * La pestaña que sigue en una lista de pestañas (`role="tablist"`): ← → (o ↑ ↓
 * si es vertical) con vuelta, Inicio / Fin. `null` si la tecla no es de la lista.
 */
export function pasoDePestanas(
  indice: number,
  total: number,
  key: string,
  vertical = false,
): number | null {
  if (total <= 0) return null;
  const atras = vertical ? "ArrowUp" : "ArrowLeft";
  const adelante = vertical ? "ArrowDown" : "ArrowRight";
  if (key === atras) return (indice - 1 + total) % total;
  if (key === adelante) return (indice + 1) % total;
  if (key === "Home") return 0;
  if (key === "End") return total - 1;
  return null;
}

// ── divisores de tamaño ──────────────────────────────────────────────────

export type Separador = {
  valor: number;
  min: number;
  max: number;
  /** `vertical`: una barra vertical que cambia anchos (← →); `horizontal`, altos (↑ ↓). */
  orientacion: "vertical" | "horizontal";
  /**
   * Si la flecha que «agranda» va al revés: el panel de la derecha crece con ←
   * (su borde está a la izquierda) y el visor de abajo, con ↑.
   */
  invertido?: boolean;
  paso: number;
  pasoGrande: number;
};

/**
 * El valor de un divisor (`role="separator"`) tras una tecla: las flechas de su
 * eje lo mueven de a `paso` (con Shift, `pasoGrande`) en la dirección en que se
 * movería la barra, Inicio y Fin lo llevan al mínimo y al máximo. Siempre dentro
 * de `[min, max]`. `null` si la tecla no es del divisor.
 */
export function valorDeSeparador(s: Separador, key: string, shift = false): number | null {
  const limitar = (n: number) => Math.min(Math.max(n, s.min), s.max);
  if (key === "Home") return s.min;
  if (key === "End") return s.max;
  const menos = s.orientacion === "vertical" ? "ArrowLeft" : "ArrowUp";
  const mas = s.orientacion === "vertical" ? "ArrowRight" : "ArrowDown";
  let signo = key === mas ? 1 : key === menos ? -1 : 0;
  if (signo === 0) return null;
  if (s.invertido) signo = -signo;
  return limitar(s.valor + signo * (shift ? s.pasoGrande : s.paso));
}

// ── las tarjetas de un lienzo ───────────────────────────────────────────

/**
 * Qué hace una flecha con el foco en una tarjeta de un lienzo (segunda vuelta
 * de los niveles, 2026-11-06: «Ctrl para todo»):
 * - sola o con **Ctrl**: **pasar** a la tarjeta vecina (Ctrl+flechas es
 *   moverse en el nivel, y adentro del lienzo el nivel son las tarjetas);
 * - con **Ctrl+Shift**: **mover** la tarjeta (mover es una acción);
 * - con **Alt**: nada (Alt solo sale un nivel; Ctrl+Alt+flechas es de Windows).
 */
export function teclaDeTarjeta(e: { ctrlKey: boolean; shiftKey: boolean; altKey: boolean }): "pasar" | "mover" | null {
  if (e.altKey) return null;
  if (e.ctrlKey && e.shiftKey) return "mover";
  return "pasar";
}

/** Lo que se mueve una tarjeta con Ctrl+Shift+flecha, en unidades del lienzo. */
export const PASO_DE_TARJETA = 10;

/**
 * El desplazamiento de una tarjeta con Ctrl+Shift+flecha. Un solo paso, de a
 * 10: hasta la segunda vuelta había uno grande (de a 50, con Shift) pero Shift
 * ya es parte de mover, y sumarle Alt chocaría con «Alt solo sale». Para ir
 * lejos, mantener la tecla apretada (la repetición mueve de a 10).
 */
export function pasoDeTarjeta(dir: Direccion): { dx: number; dy: number } {
  const p = PASO_DE_TARJETA;
  return {
    dx: dir === "derecha" ? p : dir === "izquierda" ? -p : 0,
    dy: dir === "abajo" ? p : dir === "arriba" ? -p : 0,
  };
}
