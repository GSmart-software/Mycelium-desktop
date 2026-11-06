/**
 * El modo pistas (`FUN-XL-04`, Parte 5): con F10 aparece una letra —o un par
 * de letras— sobre cada elemento clicable visible, y escribirlas equivale a
 * hacer clic (como Vimium o las KeyTips de Office). Desde el rediseño del
 * 2026-11-06, las letras salen del nombre de lo que señalan (Explorador → E)
 * y los botones de solo ícono muestran además ese nombre. Acá está la lógica
 * pura: los alfabetos, las etiquetas (por nombre y, sin nombre, las de
 * siempre), el nombre visible y dónde cabe, el orden por posición, cómo se va escribiendo
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

// ── etiquetas por nombre ──────────────────────────────────────────────────

/**
 * Las letras de las pistas que salen del nombre: todas, porque la letra ya
 * dice algo («Inicio» → `I`). La `I` y la `O` van al final: son las que menos
 * se distinguen, así que la parte sin nombre las usa última.
 */
export const ALFABETO_NOMBRES = ALFABETO_PISTAS + "IO";

/**
 * Las palabras que no dicen qué es el objetivo: artículos, preposiciones y
 * conjunciones («Abrir **el** panel **de** búsqueda» → ABRIR, PANEL, BUSQUEDA).
 * Ya normalizadas: en mayúscula y sin tildes.
 */
const PALABRAS_VACIAS: ReadonlySet<string> = new Set([
  "EL", "LA", "LOS", "LAS", "LO", "UN", "UNA", "UNOS", "UNAS",
  "DE", "DEL", "AL", "A", "EN", "CON", "SIN", "POR", "PARA", "Y", "O", "U", "E",
  "THE", "OF", "TO", "AN", "AND", "OR",
]);

/**
 * Limpia un nombre para mostrarlo o sacarle letras: sin el atajo entre
 * paréntesis del final («Buscar (Ctrl+Shift+F)» → «Buscar») y con los
 * espacios colapsados.
 */
export function limpiarNombre(nombre: string): string {
  const limpio = nombre.replace(/\s+/g, " ").trim();
  const sinParentesis = limpio.replace(/\s*\([^()]*\)$/, "").trim();
  return sinParentesis || limpio;
}

/**
 * Las palabras significativas de un nombre, normalizadas: sin tildes (Á → A,
 * Ñ → N), en mayúscula, partidas por todo lo que no sea letra del alfabeto
 * (espacios, signos, números) y sin las palabras vacías. Si **todas** son
 * vacías («A»), se quedan: algo dicen.
 */
export function palabrasDeNombre(nombre: string, alfabeto: string = ALFABETO_NOMBRES): string[] {
  const normal = limpiarNombre(nombre).normalize("NFD").replace(/\p{M}/gu, "").toUpperCase();
  const palabras: string[] = [];
  let actual = "";
  for (const c of normal) {
    if (alfabeto.includes(c)) actual += c;
    else if (actual) {
      palabras.push(actual);
      actual = "";
    }
  }
  if (actual) palabras.push(actual);
  const llenas = palabras.filter((p) => !PALABRAS_VACIAS.has(p));
  return llenas.length > 0 ? llenas : palabras;
}

/**
 * Las segundas letras que se prueban, en orden: la inicial de la segunda
 * palabra («Nueva carpeta» → C), las siguientes letras de la primera
 * («Explorador» → X, P, L…), las iniciales de las demás palabras, el resto
 * de sus letras y, por último, todo el alfabeto. Sin repetir.
 */
function segundasLetras(palabras: readonly string[], alfabeto: string): string[] {
  const orden: string[] = [];
  if (palabras[1]) orden.push(palabras[1][0]);
  orden.push(...palabras[0].slice(1));
  for (const p of palabras.slice(2)) orden.push(p[0]);
  for (const p of palabras.slice(1)) orden.push(...p.slice(1));
  orden.push(...alfabeto);
  return [...new Set(orden)];
}

/**
 * Las etiquetas para objetivos con nombre (`FUN-XL-04`, rediseño del
 * 2026-11-06): la letra sale del nombre, así la pista dice algo.
 *
 * 1. Cada nombre se reduce a sus palabras significativas (`palabrasDeNombre`).
 * 2. Se agrupan por la inicial de la primera. Si una inicial es de un solo
 *    objetivo, esa letra es su etiqueta (Explorador → `E`).
 * 3. Si varios comparten la inicial, **ninguno** se queda con la letra sola
 *    (sería el comienzo de los otros) y cada uno suma una segunda letra
 *    significativa (`segundasLetras`), sin repetir dentro del grupo:
 *    Explorador `EX`, Esporas `ES`. Un grupo más grande que el alfabeto usa
 *    dos letras más, como `etiquetasPistas`.
 * 4. Los objetivos sin nombre útil (sin letras) se reparten las iniciales que
 *    ningún nombre usó, con el esquema de siempre (`etiquetasPistas`).
 *
 * Así ninguna etiqueta es el comienzo de otra: grupos distintos empiezan con
 * letras distintas y, dentro de un grupo, todas tienen el mismo largo. El
 * reparto sigue el orden de entrada (el de lectura), así que la misma
 * pantalla da las mismas etiquetas. Si no quedan iniciales libres para los
 * sin nombre, todas vuelven al esquema de siempre.
 */
export function etiquetasPorNombre(
  nombres: readonly (string | null | undefined)[],
  alfabeto: string = ALFABETO_NOMBRES,
): string[] {
  const palabras = nombres.map((n) => (n ? palabrasDeNombre(n, alfabeto) : []));
  const grupos = new Map<string, number[]>();
  const sinNombre: number[] = [];
  palabras.forEach((p, i) => {
    if (p.length === 0) {
      sinNombre.push(i);
      return;
    }
    const inicial = p[0][0];
    const grupo = grupos.get(inicial);
    if (grupo) grupo.push(i);
    else grupos.set(inicial, [i]);
  });

  const salida: string[] = new Array(nombres.length);
  for (const [inicial, indices] of grupos) {
    if (indices.length === 1) {
      salida[indices[0]] = inicial;
      continue;
    }
    if (indices.length > alfabeto.length) {
      const sufijos = etiquetasPistas(indices.length, alfabeto);
      indices.forEach((i, k) => (salida[i] = inicial + sufijos[k]));
      continue;
    }
    const usadas = new Set<string>();
    for (const i of indices) {
      // Siempre hay una libre: el grupo no es más grande que el alfabeto.
      const segunda = segundasLetras(palabras[i], alfabeto).find((c) => !usadas.has(c))!;
      usadas.add(segunda);
      salida[i] = inicial + segunda;
    }
  }

  if (sinNombre.length > 0) {
    const libres = [...alfabeto].filter((c) => !grupos.has(c)).join("");
    // Con una sola letra libre no se arma más de una etiqueta.
    if (libres.length === 0 || (libres.length === 1 && sinNombre.length > 1)) {
      return etiquetasPistas(nombres.length);
    }
    const resto = etiquetasPistas(sinNombre.length, libres);
    sinNombre.forEach((i, k) => (salida[i] = resto[k]));
  }
  return salida;
}

// ── el nombre junto al código ─────────────────────────────────────────────

/**
 * ¿El objetivo ya muestra su nombre? Sí si su texto visible tiene al menos
 * **dos** letras o números: un archivo del árbol, una pestaña, un botón con
 * rótulo. Un botón de solo ícono no tiene texto, o tiene un signo («×», «+»,
 * «⋯»), un emoji o una letra suelta (la «B» de negrita): esos llevan el nombre
 * junto al código.
 */
export function muestraTexto(textoVisible: string | null | undefined): boolean {
  return (textoVisible?.match(/[\p{L}\p{N}]/gu)?.length ?? 0) >= 2;
}

/** Largo máximo del nombre en una pista. */
export const LARGO_NOMBRE_PISTA = 24;

/** El nombre como se muestra en la pista: limpio y, si es largo, recortado con «…». */
export function recortarNombre(nombre: string, largo: number = LARGO_NOMBRE_PISTA): string {
  const limpio = limpiarNombre(nombre);
  const letras = [...limpio];
  if (letras.length <= largo) return limpio;
  return letras.slice(0, largo - 1).join("").trimEnd() + "…";
}

const sePisan = (a: CajaPista, b: CajaPista) =>
  a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1;

/** Una pista para decidir dónde va su nombre (o si va). */
export type PistaParaUbicar = {
  /** La caja de la pista solo con el código, donde se dibuja siempre. */
  codigo: CajaPista;
  /** La caja de la pista con el nombre en cada lugar posible, en orden; vacía si no lleva nombre. */
  alternativas: readonly CajaPista[];
  /** Coincide con lo escrito: las atenuadas ni muestran nombre ni estorban. */
  activa: boolean;
};

/**
 * Qué pistas muestran su nombre y en qué lugar: el índice de la alternativa
 * elegida, o `null` (solo el código). En orden, cada una toma el primer lugar
 * donde el nombre no pisa el código de otra pista activa ni el nombre de una
 * anterior. Al escribir, las que dejan de coincidir se apartan y las que
 * siguen tienen más lugar: se vuelve a calcular.
 */
export function ubicarNombres(pistas: readonly PistaParaUbicar[]): (number | null)[] {
  const ocupadas: { caja: CajaPista; de: number }[] = [];
  pistas.forEach((p, i) => {
    if (p.activa) ocupadas.push({ caja: p.codigo, de: i });
  });
  return pistas.map((p, i) => {
    if (!p.activa) return null;
    const k = p.alternativas.findIndex((caja) => !ocupadas.some((o) => o.de !== i && sePisan(caja, o.caja)));
    if (k < 0) return null;
    ocupadas.push({ caja: p.alternativas[k], de: i });
    return k;
  });
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
