/**
 * El modo pistas (`FUN-XL-04`, Parte 5): con F10 aparece una letra —o un par
 * de letras— sobre cada elemento clicable visible, y escribirlas equivale a
 * hacer clic (como Vimium o las KeyTips de Office). Acá está la lógica pura:
 * el alfabeto, las etiquetas, el orden por posición, cómo se va escribiendo
 * una etiqueta y qué hacer con cada tipo de elemento. Lo que toca el DOM —
 * buscar los objetivos, dibujar la capa, activar— está en `pistasDom.ts`.
 *
 * Sin React ni stores, para que lo pruebe `scripts/test-pistas.mjs`.
 */

/**
 * Las letras de las pistas, en orden de comodidad: primero la fila central
 * (donde descansan los dedos), después la de arriba y la de abajo. Sin la `I`
 * ni la `O`, que en mayúscula se confunden con el `1`, la `L` y el `0`.
 *
 * Se comparan por **posición** (`KeyboardEvent.code`: `KeyA`…), no por el
 * carácter: así funcionan con cualquier distribución del teclado. Lo que se
 * muestra es el carácter de la distribución del usuario cuando se conoce.
 */
export const ALFABETO_PISTAS = "ASDFGHJKLEWRUTYQPCVNMXZB";

/**
 * Las etiquetas para `n` objetivos: todas del **mismo largo** —el mínimo que
 * alcanza—, así ninguna es el comienzo de otra y no hay que esperar a ver si
 * viene otra letra. Con 24 objetivos o menos, una letra; hasta 576, dos; y así.
 * Se reparten en el orden del alfabeto: los primeros objetivos llevan las
 * letras más cómodas.
 */
export function etiquetasPistas(n: number, alfabeto: string = ALFABETO_PISTAS): string[] {
  if (n <= 0) return [];
  const k = alfabeto.length;
  let largo = 1;
  while (k ** largo < n) largo++;
  const salida: string[] = [];
  for (let i = 0; i < n; i++) {
    let resto = i;
    let etiqueta = "";
    for (let p = 0; p < largo; p++) {
      etiqueta = alfabeto[resto % k] + etiqueta;
      resto = Math.floor(resto / k);
    }
    salida.push(etiqueta);
  }
  // `i` en base k pone la letra que más cambia al final: AA, AS, AD… Es lo
  // que se quiere: los primeros objetivos comparten la primera letra cómoda.
  return salida;
}

/** Una caja en coordenadas de la ventana. */
export type CajaPista = { left: number; top: number; right: number; bottom: number };

/**
 * Ordena de arriba-izquierda a abajo-derecha, por **renglones**: dos cajas
 * cuyo borde superior difiere en menos de `tolerancia` píxeles están en el
 * mismo renglón y se ordenan de izquierda a derecha (los botones de una barra
 * no quedan desordenados por un píxel de diferencia). Estable.
 */
export function ordenarPorPosicion<T extends { caja: CajaPista }>(items: readonly T[], tolerancia = 6): T[] {
  const porArriba = items
    .map((item, i) => ({ item, i }))
    .sort((a, b) => a.item.caja.top - b.item.caja.top || a.i - b.i);
  const renglon = new Map<T, number>();
  let n = -1;
  let inicio = -Infinity;
  for (const { item } of porArriba) {
    if (item.caja.top - inicio > tolerancia) {
      n++;
      inicio = item.caja.top;
    }
    renglon.set(item, n);
  }
  return porArriba
    .sort(
      (a, b) =>
        renglon.get(a.item)! - renglon.get(b.item)! || a.item.caja.left - b.item.caja.left || a.i - b.i,
    )
    .map((x) => x.item);
}

/** La letra del alfabeto que corresponde a una tecla física, o `null`. */
export function letraDeCode(code: string, alfabeto: string = ALFABETO_PISTAS): string | null {
  const m = /^Key([A-Z])$/.exec(code);
  return m && alfabeto.includes(m[1]) ? m[1] : null;
}

/** Los índices de las etiquetas que empiezan con lo escrito. */
export function filtrarPorPrefijo(etiquetas: readonly string[], escrito: string): number[] {
  const salida: number[] = [];
  etiquetas.forEach((e, i) => {
    if (e.startsWith(escrito)) salida.push(i);
  });
  return salida;
}

export type PasoPistas =
  /** La letra no lleva a ninguna etiqueta: se ignora y lo escrito no cambia. */
  | { tipo: "ignorar"; escrito: string }
  /** Hay varias etiquetas que empiezan así: se espera otra letra. */
  | { tipo: "seguir"; escrito: string; coinciden: number[] }
  /** Se completó una etiqueta: se activa el objetivo `indice`. */
  | { tipo: "activar"; escrito: string; indice: number };

/** Escribir una letra más con las pistas a la vista. */
export function escribirLetra(etiquetas: readonly string[], escrito: string, letra: string): PasoPistas {
  const nuevo = escrito + letra;
  const coinciden = filtrarPorPrefijo(etiquetas, nuevo);
  if (coinciden.length === 0) return { tipo: "ignorar", escrito };
  const exacta = coinciden.find((i) => etiquetas[i] === nuevo);
  if (exacta !== undefined) return { tipo: "activar", escrito: nuevo, indice: exacta };
  return { tipo: "seguir", escrito: nuevo, coinciden };
}

/** Retroceso: borra la última letra escrita. */
export const borrarLetra = (escrito: string) => escrito.slice(0, -1);

// ── qué se hace con cada objetivo ─────────────────────────────────────────

/**
 * Lo que se sabe de un objetivo para decidir qué hacer con él.
 * - `etiqueta`: el `tagName` en minúsculas.
 * - `tipo`: el `type` de un `<input>`.
 * - `rol`: el atributo `role`.
 * - `editable`: un `contenteditable` (o el editor de CodeMirror).
 * - `marca`: una acción fijada por el código (`data-pista`, o la que deduce el
 *   DOM para la consola, un lienzo de dibujo o una tarjeta de un lienzo).
 */
export type DescriptorPista = {
  etiqueta: string;
  tipo?: string | null;
  rol?: string | null;
  editable?: boolean;
  marca?: string | null;
};

/**
 * - `clic`: mover el foco ahí y hacer clic (enlace, botón, pestaña, opción…).
 * - `foco`: solo el foco —modo escribir en un campo, el editor, un lienzo de
 *   dibujo—, o cualquier objetivo con Shift.
 * - `marco`: un iframe (draw.io, PDF): el foco al marco entero.
 * - `consola`: entrar a escribir en una consola.
 * - `documento`: seleccionar el documento que lo contiene (el grafo).
 * - `puntero`: una tarjeta de un lienzo, que se selecciona con el puntero.
 */
export type AccionPista = "clic" | "foco" | "marco" | "consola" | "documento" | "puntero";

const MARCAS: ReadonlySet<string> = new Set(["clic", "foco", "marco", "consola", "documento", "puntero"]);

/** Los `<input>` que se usan con un clic; el resto son campos de texto. */
const INPUT_DE_CLIC: ReadonlySet<string> = new Set([
  "checkbox",
  "radio",
  "button",
  "submit",
  "reset",
  "image",
  "file",
  "color",
]);

/**
 * Qué hacer al completar la etiqueta de un objetivo. Con `shift` (Shift+letras)
 * lo que se haría con un clic queda en solo enfocar, para después seguir con
 * el teclado ahí; lo demás no cambia.
 */
export function accionDePista(d: DescriptorPista, shift = false): AccionPista {
  if (d.marca && MARCAS.has(d.marca)) {
    const marca = d.marca as AccionPista;
    return marca === "clic" && shift ? "foco" : marca;
  }
  const etiqueta = d.etiqueta.toLowerCase();
  if (etiqueta === "iframe") return "marco";
  if (d.editable || etiqueta === "textarea" || etiqueta === "select") return "foco";
  if (etiqueta === "input") return INPUT_DE_CLIC.has((d.tipo ?? "text").toLowerCase()) && !shift ? "clic" : "foco";
  return shift ? "foco" : "clic";
}
