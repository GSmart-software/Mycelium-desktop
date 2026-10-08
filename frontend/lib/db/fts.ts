/**
 * Construcción de la query FTS5 a partir del texto del usuario (HU-21 CA5/6/7).
 * Portado 1:1 de `SearchEndpoints.BuildFtsQuery`: AND implícito, frases entre
 * comillas, `tag:x`/`#x` buscan el tag; cada término se entrecomilla para
 * neutralizar operadores FTS y (en modo coincidencia) se le añade `*` de prefijo.
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
 * Los tokens de la consulta: un filtro con el valor entre comillas
 * (`bancal:"Bancal 1"`, `DEF-145`), frases entre comillas o tiras sin espacios.
 * Es el ÚNICO lugar donde se corta la consulta, para que separar los filtros y
 * armar la query FTS no puedan discrepar sobre qué es un token.
 *
 * La primera alternativa exige que lo de antes de `:` sea una clave (como
 * `FILTRO_RE`), así que solo puede empezar al principio de un token: una URL o
 * `a/b:"x y"` siguen cortándose por los espacios. `tag:"…"` queda afuera a
 * propósito: una etiqueta no lleva espacios y `tag:` lo resuelve el FTS.
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
 * Separa los filtros `clave:valor` del resto de la consulta. `tag:` NO es un
 * filtro de propiedad: lo resuelve el propio FTS (ver abajo) y así sigue
 * encontrando tanto los `#tag` del cuerpo como los valores de `tags:`.
 */
export function separarFiltrosPropiedad(raw: string): {
  filtros: FiltroPropiedad[];
  resto: string;
} {
  const filtros: FiltroPropiedad[] = [];
  const resto: string[] = [];

  for (const texto of tokensDeConsulta(raw)) {
    if (texto.startsWith('"') || texto.toLowerCase().startsWith("tag:")) {
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

  return { filtros, resto: resto.join(" ") };
}

/**
 * Dónde busca la consulta (`FUN-M-20`).
 *
 * `ambos` es el comportamiento de siempre y el valor por defecto: no restringe
 * nada y deja que FTS mire el título y el cuerpo.
 */
export type CampoBusqueda = "nombre" | "contenido" | "ambos";

/** La columna de `notas_fts` que le toca a cada modo. */
const COLUMNA: Record<CampoBusqueda, string | null> = {
  nombre: "titulo",
  contenido: "contenido",
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

  for (let text of tokensDeConsulta(raw)) {

    if (text.startsWith('"') && text.endsWith('"') && text.length > 2) {
      parts.push(`${en}"${text.slice(1, -1).replaceAll('"', '""')}"${star}`);
      continue;
    }

    if (text.toLowerCase().startsWith("tag:") && text.length > 4) {
      text = "#" + text.slice(4);
    }

    const sanitized = text.replaceAll('"', '""');
    if (sanitized.length > 0) parts.push(`${en}"${sanitized}"${star}`);
  }

  return parts.join(" ");
}
