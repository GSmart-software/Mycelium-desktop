/**
 * Construcción de la query FTS5 a partir del texto del usuario (HU-21 CA5/6/7).
 * Portado de `SearchEndpoints.BuildFtsQuery`: AND implícito, frases entre
 * comillas; cada término se entrecomilla para neutralizar operadores FTS y (en
 * modo coincidencia) se le añade `*` de prefijo. `tag:x` ya no llega al FTS: es
 * un filtro sobre la tabla `etiquetas` (`DEF-152`, ver `separarFiltrosPropiedad`).
 */
/**
 * Un filtro `clave:valor` sobre la tabla `propiedades` (FUN-M-04).
 *
 * `entero` dice si el valor vino **entre comillas** (`bancal:"Bancal 1"`,
 * `DEF-145`): entonces tiene que ser el valor completo de la propiedad. Sin
 * comillas alcanza con una palabra del valor (ver `condicionValor` en
 * `buscar.ts`).
 */
export type FiltroPropiedad = { clave: string; valor: string; entero: boolean };

/**
 * Texto plegado para comparar como compara la búsqueda de texto (`DEF-144`): sin
 * tildes ni mayúsculas. Imita al tokenizador `unicode61` de `notas_fts` (que por
 * defecto quita los diacríticos y pliega mayúsculas), así «pulgon» encuentra
 * «Pulgón» tanto en el texto como en un filtro `clave:valor`. La `ñ` también se
 * pliega a `n`, igual que en el FTS: si no, `piña` encontraría «pina» en el
 * cuerpo y no en una propiedad.
 *
 * > [!warning] Se pliega en JS, no en SQL
 * > `COLLATE NOCASE` y `lower()` de SQLite solo entienden ASCII («Á» ≠ «á»), y
 * > `tauri-plugin-sql` no deja registrar funciones propias. Por eso la tabla
 * > `propiedades` guarda la clave y el valor ya plegados (`clave_plegada`,
 * > `valor_plegado`) y la consulta pliega con esta misma función.
 */
export function plegar(texto: string): string {
  return texto.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

/**
 * Una etiqueta como se compara (`DEF-152`): plegada como el texto, sin el `#`
 * del principio (`tag:#x` y `tags: ["#x"]` son la etiqueta `x`) ni la barra
 * del final (`tag:huerta/` es `huerta`). Es la misma función para la columna
 * `etiquetas.tag_plegado` y para el valor de un `tag:x` de la búsqueda: si
 * plegaran distinto, una etiqueta con tilde no se encontraría.
 */
export function plegarEtiqueta(tag: string): string {
  return plegar(tag).replace(/^#+/, "").replace(/\/+$/, "");
}

/**
 * Los tokens de la consulta: un filtro con el valor entre comillas
 * (`bancal:"Bancal 1"`, `DEF-145`), frases entre comillas o tiras sin espacios.
 * Es el ÚNICO lugar donde se corta la consulta, para que separar los filtros y
 * armar la query FTS no puedan discrepar sobre qué es un token.
 *
 * La primera alternativa exige que lo de antes de `:` sea una clave (como
 * `FILTRO_RE`), así que solo puede empezar al principio de un token: una URL o
 * `a/b:"x y"` siguen cortándose por los espacios. `tag:"…"` queda afuera a
 * propósito: una etiqueta no lleva espacios.
 */
function tokensDeConsulta(raw: string): string[] {
  return raw.match(/(?![Tt][Aa][Gg]:)[\p{L}_][\p{L}\p{N}_-]*:"[^"]*"|"[^"]+"|\S+/gu) ?? [];
}

/**
 * Lo que separa palabras dentro del valor de una propiedad, para la
 * coincidencia por palabra de un filtro sin comillas (`DEF-145`). Imita a grandes
 * rasgos al tokenizador del FTS, que también corta en la puntuación: así
 * `luz:sombra` encuentra «semi-sombra» igual que la búsqueda de texto.
 *
 * Es una lista cerrada y no «todo lo que no sea letra» porque SQLite no sabe
 * de clases Unicode: la misma lista se aplica en SQL (`separadoresSql`) y en JS
 * (`aPalabras`), y las dos tienen que dar lo mismo.
 */
const SEPARADORES = ["-", "_", "/", ".", ",", ";", ":", "(", ")", "[", "]"];

/** El texto (ya plegado) con cada separador convertido en espacio. */
export function aPalabras(texto: string): string {
  let r = texto;
  for (const s of SEPARADORES) r = r.replaceAll(s, " ");
  return r;
}

/** Lo mismo que `aPalabras`, como expresión SQL sobre `columna`. */
export function separadoresSql(columna: string): string {
  return SEPARADORES.reduce((sql, s) => `replace(${sql}, '${s}', ' ')`, columna);
}

/**
 * Token que parece un filtro de propiedad: `estado:activo`. Se exige que la
 * clave sea una palabra y que el valor NO empiece con `/`, para no confundir una
 * URL pegada (`https://…`) con un filtro.
 */
const FILTRO_RE = /^([\p{L}_][\p{L}\p{N}_-]*):([^/].*)$/u;

/**
 * Separa los filtros de la consulta: los `clave:valor` sobre las propiedades y
 * los `tag:x` sobre las etiquetas; lo que queda es el texto libre.
 *
 * `tag:x` NO es un filtro de propiedad ni un término de texto (`DEF-152`): hasta
 * entonces se buscaba en el FTS como «#x», el tokenizador descartaba el `#` y
 * terminaba siendo la palabra `x` en cualquier lado —`tag:solanaceas` traía la
 * nota con `familia: solanáceas`, que no tiene esa etiqueta—. Ahora va a
 * `etiquetas`, ya plegado (`plegarEtiqueta`). Un `tag:` vacío (`tag:`, `tag:#`,
 * lo que se está escribiendo todavía) no filtra nada y se descarta.
 */
export function separarFiltrosPropiedad(raw: string): {
  filtros: FiltroPropiedad[];
  etiquetas: string[];
  resto: string;
} {
  const filtros: FiltroPropiedad[] = [];
  const etiquetas: string[] = [];
  const resto: string[] = [];

  for (const texto of tokensDeConsulta(raw)) {
    if (texto.toLowerCase().startsWith("tag:")) {
      // Las comillas no hacen falta (una etiqueta no lleva espacios), pero
      // tampoco estorban: `tag:"x"` es `tag:x`.
      const tag = plegarEtiqueta(texto.slice(4).replace(/^"|"$/g, ""));
      if (tag !== "" && !etiquetas.includes(tag)) etiquetas.push(tag);
      continue;
    }
    if (texto.startsWith('"')) {
      resto.push(texto);
      continue;
    }
    const filtro = FILTRO_RE.exec(texto);
    if (!filtro) {
      resto.push(texto);
      continue;
    }
    // Entre comillas (`bancal:"Bancal 1"`), el valor es entero. Una comilla
    // suelta —la que se está escribiendo todavía— se descarta y el filtro
    // sigue siendo por palabra, para que la búsqueda en vivo no quede vacía
    // mientras se tipea.
    const crudo = filtro[2];
    const entero = crudo.length >= 2 && crudo.startsWith('"') && crudo.endsWith('"');
    filtros.push({
      clave: filtro[1],
      valor: entero ? crudo.slice(1, -1) : crudo.replace(/^"|"$/g, ""),
      entero,
    });
  }

  return { filtros, etiquetas, resto: resto.join(" ") };
}

/**
 * Dónde busca la consulta (`FUN-M-20`).
 *
 * `ambos` es el comportamiento de siempre y el valor por defecto: no restringe
 * nada y deja que FTS mire el título y el cuerpo.
 */
export type CampoBusqueda = "nombre" | "contenido" | "ambos";

/**
 * La columna de `notas_fts` que le toca a cada modo. «Contenido» son dos: el
 * texto legible y `extra`, lo que se busca sin mostrarse (valores de
 * propiedades, destinos de enlaces con alias: `DEF-148`). Antes los dos iban en
 * la misma columna, así que buscar en el contenido los sigue encontrando.
 */
const COLUMNA: Record<CampoBusqueda, string | null> = {
  nombre: "titulo",
  contenido: "{contenido extra}",
  ambos: null,
};

/**
 * Texto del usuario → consulta FTS5.
 *
 * `campo` restringe la búsqueda a una columna (`FUN-M-20`). El filtro se aplica
 * **a cada término** y no a la consulta entera: `titulo : "a"* "b"*` limitaría
 * solo el primero —el operador de columna alcanza a la frase que le sigue, no a
 * lo que venga después— y el segundo se buscaría en todo el documento. Un
 * resultado que casi cumple el filtro es peor que ninguno: nadie lo mira dos
 * veces.
 */
export function buildFtsQuery(
  raw: string,
  prefix = false,
  campo: CampoBusqueda = "ambos",
): string {
  const parts: string[] = [];
  const star = prefix ? "*" : "";
  const col = COLUMNA[campo];
  const en = col === null ? "" : `${col} : `;

  for (const text of tokensDeConsulta(raw)) {
    if (text.startsWith('"') && text.endsWith('"') && text.length > 2) {
      parts.push(`${en}"${text.slice(1, -1).replaceAll('"', '""')}"${star}`);
      continue;
    }

    const sanitized = text.replaceAll('"', '""');
    if (sanitized.length > 0) parts.push(`${en}"${sanitized}"${star}`);
  }

  return parts.join(" ");
}

/**
 * Las dos consultas FTS sobre el TÍTULO con las que se ordenan los resultados
 * (`DEF-146`): el texto libre de la consulta —sin filtros `clave:valor` ni
 * `tag:x`, que buscan otra cosa y ya vienen separados— como
 *
 * - `empieza`: el título EMPIEZA con ese texto, como frase (`^` de FTS5: desde
 *   la primera palabra del título). El título idéntico a la consulta es el más
 *   corto de este grupo, y por eso la consulta ordena el grupo por largo.
 * - `contiene`: el título tiene todas las palabras, en cualquier lugar.
 *
 * Usan el mismo tokenizador que la búsqueda, así que «tomate» empieza
 * «Tómate un respiro» igual que encuentra «Tomate» en el cuerpo: sin tildes ni
 * mayúsculas. `prefix` (búsqueda NO exacta) le pone `*` a la última palabra,
 * como en `buildFtsQuery`.
 *
 * `null` si no hay texto libre con alguna letra o número: solo filtros, solo
 * etiquetas o pura puntuación no tienen título con el que compararse (y una
 * frase vacía en FTS5 es un error).
 */
export function consultasDeTitulo(
  raw: string,
  prefix = false,
): { empieza: string; contiene: string } | null {
  const libres = tokensDeConsulta(raw)
    .map((t) => (t.length > 2 && t.startsWith('"') && t.endsWith('"') ? t.slice(1, -1) : t))
    // Una comilla suelta o un guion no son palabras para el tokenizador: como
    // frase quedarían vacíos.
    .filter((t) => /[\p{L}\p{N}]/u.test(t));
  if (libres.length === 0) return null;
  const texto = libres.join(" ");
  const star = prefix ? "*" : "";
  return {
    empieza: `titulo : ^"${texto.replaceAll('"', '""')}"${star}`,
    contiene: libres.map((t) => `titulo : "${t.replaceAll('"', '""')}"${star}`).join(" "),
  };
}

/**
 * Las palabras del texto libre de la consulta, plegadas (`DEF-148`): para
 * saber en qué propiedad cayó una coincidencia y armar su fragmento
 * «clave: valor». Sin comillas y cortadas como corta el tokenizador: en todo
 * lo que no sea letra o número. Los filtros `clave:valor` y `tag:x` ya vienen
 * separados.
 */
export function palabrasDeConsulta(raw: string): string[] {
  const palabras: string[] = [];
  for (const t of tokensDeConsulta(raw)) {
    for (const p of plegar(t).split(/[^\p{L}\p{N}]+/u)) if (p !== "") palabras.push(p);
  }
  return palabras;
}
