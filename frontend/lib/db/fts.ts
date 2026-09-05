/**
 * Construcción de la query FTS5 a partir del texto del usuario (HU-21 CA5/6/7).
 * Portado 1:1 de `SearchEndpoints.BuildFtsQuery`: AND implícito, frases entre
 * comillas, `tag:x`/`#x` buscan el tag; cada término se entrecomilla para
 * neutralizar operadores FTS y (en modo coincidencia) se le añade `*` de prefijo.
 */
/** Un filtro `clave:valor` sobre la tabla `propiedades` (FUN-M-04). */
export type FiltroPropiedad = { clave: string; valor: string };

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
  const re = /"[^"]+"|\S+/g;

  for (let m = re.exec(raw); m !== null; m = re.exec(raw)) {
    const texto = m[0];
    if (texto.startsWith('"') || texto.toLowerCase().startsWith("tag:")) {
      resto.push(texto);
      continue;
    }
    const filtro = FILTRO_RE.exec(texto);
    if (filtro) filtros.push({ clave: filtro[1], valor: filtro[2].replace(/^"|"$/g, "") });
    else resto.push(texto);
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
  const re = /"[^"]+"|\S+/g;

  for (let m = re.exec(raw); m !== null; m = re.exec(raw)) {
    let text = m[0];

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
