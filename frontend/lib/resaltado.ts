/**
 * `==resaltado==` (sintaxis de Obsidian, `FUN-S-33`).
 *
 * Una sola definición de qué es un delimitador y cómo se emparejan, que usan las
 * dos vistas: la de lectura (`lib/markdown.ts`, sobre los nodos del árbol de
 * markdown) y la vista en vivo (`lib/editor/livePreview.ts`, sobre el texto de
 * cada línea). Es la lección de `FUN-L-20`: con dos copias, una vista dibuja y
 * la otra no.
 *
 * Las reglas:
 * - El delimitador es exactamente `==`: una racha de tres o más `=` (`===`, una
 *   línea de `=====`) no cuenta, y un `=` escapado (`\=`) tampoco.
 * - Abre si lo que sigue no es un espacio; cierra si lo que precede no es un
 *   espacio. Así `a == b` (una comparación) no resalta nada.
 * - No cruza líneas ni entra en código: quien llama descarta los delimitadores
 *   que caen dentro de código.
 * - Empareja de izquierda a derecha: el primero que abre con el primero que
 *   cierra después de él, y el contenido no puede quedar vacío.
 */

export type Delimitador = {
  /** Índice del primer `=` del par. */
  pos: number;
  abre: boolean;
  cierra: boolean;
};

const esEspacio = (c: string | undefined): boolean => c === undefined || c === "" || /\s/.test(c);

/**
 * Los `==` de un texto. `antes` y `despues` son el carácter que rodea al texto
 * cuando es un trozo de algo mayor (un nodo entre otros): `undefined` = borde
 * real, que cuenta como espacio.
 */
export function delimitadoresResaltado(
  texto: string,
  antes?: string,
  despues?: string,
): Delimitador[] {
  const salida: Delimitador[] = [];
  let i = 0;
  while (i < texto.length) {
    if (texto[i] !== "=") {
      i++;
      continue;
    }
    let fin = i;
    while (fin < texto.length && texto[fin] === "=") fin++;
    const escapado = i > 0 && texto[i - 1] === "\\";
    if (fin - i === 2 && !escapado) {
      const previo = i > 0 ? texto[i - 1] : antes;
      const siguiente = fin < texto.length ? texto[fin] : despues;
      salida.push({ pos: i, abre: !esEspacio(siguiente), cierra: !esEspacio(previo) });
    }
    i = fin;
  }
  return salida;
}

/**
 * Empareja una lista de delimitadores ya ordenados. Devuelve pares de índices
 * de la lista. `vacio(a, b)` dice si entre el delimitador `a` y el `b` no hay
 * contenido (o hay un salto de línea): ese par no vale.
 */
export function emparejarResaltados<T extends { abre: boolean; cierra: boolean }>(
  ds: T[],
  invalido: (a: T, b: T) => boolean,
): [number, number][] {
  const pares: [number, number][] = [];
  let abierto = -1;
  for (let i = 0; i < ds.length; i++) {
    const d = ds[i];
    if (abierto < 0) {
      if (d.abre) abierto = i;
      continue;
    }
    if (d.cierra && !invalido(ds[abierto], d)) {
      pares.push([abierto, i]);
      abierto = -1;
    }
  }
  return pares;
}

export type TramoResaltado = {
  /** Inicio del `==` que abre. */
  desde: number;
  /** Fin (exclusivo) del `==` que cierra. */
  hasta: number;
};

/**
 * Los resaltados de UNA línea de texto crudo (la vista en vivo). `enCodigo(i)`
 * dice si el carácter `i` de la línea está dentro de código: esos `==` se
 * escribieron para mostrarse, no para resaltar.
 */
export function resaltadosEnLinea(
  linea: string,
  enCodigo: (i: number) => boolean = () => false,
): TramoResaltado[] {
  const ds = delimitadoresResaltado(linea).filter((d) => !enCodigo(d.pos));
  return emparejarResaltados(ds, (a, b) => b.pos <= a.pos + 2).map(([a, b]) => ({
    desde: ds[a].pos,
    hasta: ds[b].pos + 2,
  }));
}
