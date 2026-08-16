/**
 * Tablas markdown (`FUN-L-19`, `EDITOR-TABLAS-EN-SITIO`): el motor puro que
 * lee una tabla del documento, la deja en una estructura editable y la vuelve a
 * escribir. Ver `docs/features/edicion-en-el-render.md` § 5.
 *
 * Es el equivalente para tablas de lo que `lib/frontmatter.ts` es para las
 * propiedades: la interfaz (el widget del editor en vivo) no sabe de markdown,
 * solo pide operaciones —insertar fila, mover columna, alinear, escribir una
 * celda— sobre una `Tabla`.
 *
 * Tres reglas que son la mitad del trabajo:
 *
 * 1. **Las celdas guardan markdown**, no texto plano: `**negrita**`,
 *    `[[wikilinks]]`, `` `código` `` viajan enteros.
 * 2. **El `|` de una celda va escapado (`\|`) en el documento y SIN escapar en
 *    la estructura.** Partir por `|` a lo bruto rompe cualquier tabla con un
 *    `[[destino\|alias]]` adentro, que en este vault es el pan de cada día (es
 *    lo mismo que rompe `DEF-045`, por otro camino).
 * 3. **No se pierde texto del usuario.** Una fila con menos celdas que el
 *    encabezado se completa; una con más ENSANCHA la tabla (columnas nuevas
 *    vacías) en vez de tirar las de sobra en silencio. Y lo que no sepamos
 *    reescribir con seguridad devuelve `null`: el editor lo deja como está.
 *
 * Además se preserva el fin de línea (CRLF/LF) y el prefijo de cita/sangría
 * (`> ` de un callout), y al serializar se realinean las columnas: es lo que
 * hace legible el crudo sin tener que emparejarlo a mano.
 *
 * > OJO: este módulo es **puro y sin imports** a propósito — así
 * > `scripts/test-tablas.mjs` puede transpilarlo e importarlo sin build, igual
 * > que `lib/frontmatter.ts`, `lib/canvas.ts`, `lib/bases.ts` y
 * > `lib/enlaces.ts`. Un solo `import` lo rompe.
 */

export type Alineacion = "izquierda" | "centro" | "derecha" | "sin";

export type Tabla = {
  /** Celdas de la fila de títulos, en markdown y con los `|` sin escapar. */
  encabezado: string[];
  /** Una por columna; siempre del mismo largo que `encabezado`. */
  alineaciones: Alineacion[];
  /** Filas de datos; todas del mismo largo que `encabezado`. */
  filas: string[][];
  /** Fin de línea del bloque original: `"\n"` o `"\r\n"`. */
  eol: string;
  /** Prefijo común de todas las líneas: el `> ` de una cita/callout, o sangría. */
  sangria: string;
};

/** Ancho mínimo de una columna al serializar: lo que ocupa `---` / `:-:`. */
const ANCHO_MINIMO = 3;

/** Prefijo de cita (`>`, anidados) y/o sangría con el que arranca una línea. */
const SANGRIA_RE = /^(?:[ \t]*>)*[ \t]*/;

/** Celda de la fila separadora: `---`, `:--`, `--:`, `:-:`. */
const DELIMITADOR_RE = /^:?-+:?$/;

/** Una línea sin su `\r` final (los documentos con CRLF llegan así al split). */
const sinCr = (linea: string): string => (linea.endsWith("\r") ? linea.slice(0, -1) : linea);

/**
 * `\|` → `|` al leer, `|` → `\|` al escribir. Son inversas exactas para todo lo
 * que salga de `desescapar`, que es lo único que la estructura contiene.
 */
const desescapar = (celda: string): string => celda.replace(/\\\|/g, "|");
const escapar = (celda: string): string => celda.replace(/\|/g, "\\|");

/**
 * Parte una fila en celdas respetando el escape: `\|` (y cualquier otro `\x`)
 * no separa. Las barras de los extremos son opcionales en GFM, así que la
 * primera y la última celda se descartan solo si están vacías.
 *
 * Ojo: dentro de una tabla, un `|` en un tramo de código (`` `a|b` ``) TAMBIÉN
 * separa —así lo define GFM—, por eso no hay un caso especial para los backticks.
 */
function partirCeldas(linea: string): string[] {
  const celdas: string[] = [];
  let actual = "";
  for (let i = 0; i < linea.length; i++) {
    const c = linea[i];
    if (c === "\\" && i + 1 < linea.length) {
      actual += c + linea[i + 1];
      i++;
      continue;
    }
    if (c === "|") {
      celdas.push(actual);
      actual = "";
      continue;
    }
    actual += c;
  }
  celdas.push(actual);
  if (celdas.length > 1 && celdas[0].trim() === "") celdas.shift();
  if (celdas.length > 1 && celdas[celdas.length - 1].trim() === "") celdas.pop();
  return celdas.map((c) => desescapar(c.trim()));
}

/** La alineación que declara una celda del delimitador, o null si no lo es. */
function alineacionDe(celda: string): Alineacion | null {
  const s = celda.trim();
  if (!DELIMITADOR_RE.test(s)) return null;
  const izquierda = s.startsWith(":");
  const derecha = s.endsWith(":");
  if (izquierda && derecha) return "centro";
  if (izquierda) return "izquierda";
  if (derecha) return "derecha";
  return "sin";
}

/**
 * Lee el markdown de una tabla. Devuelve `null` para lo que no sepamos
 * reescribir con seguridad —el editor entonces se comporta como hasta ahora: la
 * muestra renderizada y sin controles—, que es preferible a corromper el
 * documento de alguien.
 */
export function parsear(md: string): Tabla | null {
  const eol = md.includes("\r\n") ? "\r\n" : "\n";
  const lineas = md.split("\n").map(sinCr);
  // El slice del documento puede terminar en salto de línea: esa línea vacía no
  // es parte de la tabla.
  while (lineas.length > 0 && lineas[lineas.length - 1].trim() === "") lineas.pop();
  if (lineas.length < 2) return null;

  // El prefijo de cita tiene que ser IDÉNTICO en todas las líneas: si varía no
  // sabemos reconstruirlo, y romper la indentación de los `>` de un callout
  // sería romper el documento.
  const sangria = SANGRIA_RE.exec(lineas[0])?.[0] ?? "";
  if (!lineas.every((l) => l.startsWith(sangria))) return null;
  const cuerpo = lineas.map((l) => l.slice(sangria.length));
  if (cuerpo.some((l) => !l.includes("|"))) return null;

  const encabezado = partirCeldas(cuerpo[0]);
  const delimitador = partirCeldas(cuerpo[1]);
  if (delimitador.length !== encabezado.length) return null;
  const alineaciones: Alineacion[] = [];
  for (const celda of delimitador) {
    const a = alineacionDe(celda);
    if (a === null) return null;
    alineaciones.push(a);
  }

  const filas = cuerpo.slice(2).map(partirCeldas);
  // Filas irregulares: la tabla se ensancha hasta la fila más larga y las
  // cortas se completan. Las celdas de sobra quedan a la vista en una columna
  // nueva en vez de desaparecer.
  const ancho = Math.max(encabezado.length, ...filas.map((f) => f.length));
  return {
    encabezado: rellenar(encabezado, ancho),
    alineaciones: rellenarCon(alineaciones, ancho, "sin"),
    filas: filas.map((f) => rellenar(f, ancho)),
    eol,
    sangria,
  };
}

/**
 * Escribe la tabla, con las columnas emparejadas. La estructura manda: lo que
 * salga de acá es la tabla entera, lista para reemplazar su bloque.
 */
export function serializar(t: Tabla): string {
  const columnas = t.encabezado.length;
  const encabezado = t.encabezado.map(escapar);
  const filas = t.filas.map((f) => rellenar(f, columnas).map(escapar));

  const anchos: number[] = [];
  for (let j = 0; j < columnas; j++) {
    let ancho = Math.max(ANCHO_MINIMO, encabezado[j].length);
    for (const fila of filas) ancho = Math.max(ancho, fila[j].length);
    anchos.push(ancho);
  }

  const linea = (celdas: string[]): string =>
    `${t.sangria}| ${celdas.map((c, j) => c.padEnd(anchos[j])).join(" | ")} |`;
  const delimitador = `${t.sangria}| ${t.alineaciones
    .map((a, j) => guiones(a, anchos[j]))
    .join(" | ")} |`;

  return [linea(encabezado), delimitador, ...filas.map(linea)].join(t.eol);
}

/** La celda del delimitador de una columna, del ancho de la columna. */
function guiones(a: Alineacion, ancho: number): string {
  if (a === "centro") return `:${"-".repeat(Math.max(1, ancho - 2))}:`;
  if (a === "izquierda") return `:${"-".repeat(Math.max(1, ancho - 1))}`;
  if (a === "derecha") return `${"-".repeat(Math.max(1, ancho - 1))}:`;
  return "-".repeat(Math.max(1, ancho));
}

const rellenar = (celdas: string[], ancho: number): string[] => rellenarCon(celdas, ancho, "");

function rellenarCon<T>(valores: T[], ancho: number, relleno: T): T[] {
  const copia = valores.slice(0, ancho);
  while (copia.length < ancho) copia.push(relleno);
  return copia;
}

/** Copia de la tabla, para que ninguna operación mute la que recibe. */
function clonar(t: Tabla): Tabla {
  return {
    encabezado: [...t.encabezado],
    alineaciones: [...t.alineaciones],
    filas: t.filas.map((f) => [...f]),
    eol: t.eol,
    sangria: t.sangria,
  };
}

/** Nº de columnas de la tabla. */
export function columnasDe(t: Tabla): number {
  return t.encabezado.length;
}

const enRango = (i: number, largo: number): boolean => Number.isInteger(i) && i >= 0 && i < largo;

// ── Filas ────────────────────────────────────────────────────────────────────

/** Inserta una fila vacía; `indice` es la posición FINAL de la fila nueva. */
export function insertarFila(t: Tabla, indice: number): Tabla {
  const nueva = clonar(t);
  const donde = Math.min(Math.max(0, indice), nueva.filas.length);
  nueva.filas.splice(donde, 0, new Array(columnasDe(nueva)).fill(""));
  return nueva;
}

/**
 * Elimina una fila de datos. Quedarse sin filas es válido (encabezado y
 * delimitador siguen siendo una tabla), así que no hay caso especial para la
 * última.
 */
export function eliminarFila(t: Tabla, indice: number): Tabla {
  if (!enRango(indice, t.filas.length)) return t;
  const nueva = clonar(t);
  nueva.filas.splice(indice, 1);
  return nueva;
}

export function moverFila(t: Tabla, desde: number, hasta: number): Tabla {
  if (!enRango(desde, t.filas.length) || !enRango(hasta, t.filas.length)) return t;
  if (desde === hasta) return t;
  const nueva = clonar(t);
  const [fila] = nueva.filas.splice(desde, 1);
  nueva.filas.splice(hasta, 0, fila);
  return nueva;
}

// ── Columnas ─────────────────────────────────────────────────────────────────

/** Inserta una columna vacía; `indice` es la posición FINAL de la columna. */
export function insertarColumna(t: Tabla, indice: number): Tabla {
  const nueva = clonar(t);
  const donde = Math.min(Math.max(0, indice), columnasDe(nueva));
  nueva.encabezado.splice(donde, 0, "");
  nueva.alineaciones.splice(donde, 0, "sin");
  for (const fila of nueva.filas) fila.splice(donde, 0, "");
  return nueva;
}

/**
 * Elimina una columna. La ÚLTIMA no se elimina: una tabla sin columnas no es
 * una tabla, y borrar el bloque entero es trabajo del editor, no de acá.
 */
export function eliminarColumna(t: Tabla, indice: number): Tabla {
  if (!enRango(indice, columnasDe(t)) || columnasDe(t) <= 1) return t;
  const nueva = clonar(t);
  nueva.encabezado.splice(indice, 1);
  nueva.alineaciones.splice(indice, 1);
  for (const fila of nueva.filas) fila.splice(indice, 1);
  return nueva;
}

export function moverColumna(t: Tabla, desde: number, hasta: number): Tabla {
  const columnas = columnasDe(t);
  if (!enRango(desde, columnas) || !enRango(hasta, columnas)) return t;
  if (desde === hasta) return t;
  const nueva = clonar(t);
  const mover = <T>(xs: T[]) => {
    const [x] = xs.splice(desde, 1);
    xs.splice(hasta, 0, x);
  };
  mover(nueva.encabezado);
  mover(nueva.alineaciones);
  for (const fila of nueva.filas) mover(fila);
  return nueva;
}

export function alinear(t: Tabla, columna: number, a: Alineacion): Tabla {
  if (!enRango(columna, columnasDe(t))) return t;
  if (t.alineaciones[columna] === a) return t;
  const nueva = clonar(t);
  nueva.alineaciones[columna] = a;
  return nueva;
}

// ── Celdas ───────────────────────────────────────────────────────────────────

/**
 * Escribe una celda. `fila === -1` es el ENCABEZADO: la estructura lo guarda
 * aparte de los datos, así que el índice negativo es lo que lo nombra.
 *
 * El texto entra tal cual (markdown, con los `|` sin escapar): escaparlos es
 * cosa de `serializar`. Los saltos de línea sí se aplanan — una celda es una
 * línea, y meter un `\n` partiría la tabla en dos.
 */
export function ponerCelda(t: Tabla, fila: number, columna: number, texto: string): Tabla {
  if (!enRango(columna, columnasDe(t))) return t;
  const limpio = texto.replace(/\r?\n/g, " ").trim();
  if (fila === -1) {
    if (t.encabezado[columna] === limpio) return t;
    const nueva = clonar(t);
    nueva.encabezado[columna] = limpio;
    return nueva;
  }
  if (!enRango(fila, t.filas.length)) return t;
  if (t.filas[fila][columna] === limpio) return t;
  const nueva = clonar(t);
  nueva.filas[fila][columna] = limpio;
  return nueva;
}

/** La celda `[fila, columna]` (con `fila === -1` para el encabezado), o `""`. */
export function celdaDe(t: Tabla, fila: number, columna: number): string {
  if (!enRango(columna, columnasDe(t))) return "";
  if (fila === -1) return t.encabezado[columna];
  return enRango(fila, t.filas.length) ? t.filas[fila][columna] : "";
}
