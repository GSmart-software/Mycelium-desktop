/**
 * Búsqueda full-text en el vault vía FTS5 (HU-21). Portado de
 * `SearchEndpoints` (`GET /vaults/{id}/buscar`). Por defecto la búsqueda es por
 * coincidencia (prefijo); `exacto=true` exige palabra completa (toggle DEF-035).
 *
 * Acepta además filtros `clave:valor` sobre las propiedades del frontmatter
 * (`FUN-M-04`): restringen por la tabla `propiedades` y se pueden combinar con
 * términos de texto o usarse solos. `exacto` rige también la palabra de un
 * filtro sin comillas (ver `condicionValor`, `DEF-145`). Y filtros `tag:x`
 * sobre las etiquetas de la nota (`DEF-152`, ver `condicionEtiqueta`), que se
 * combinan igual.
 *
 * `campo` elige dónde mirar —nombre, contenido o los dos (`FUN-M-20`)— y se
 * resuelve en la propia consulta FTS, no filtrando después: `notas_fts` tiene el
 * título y el cuerpo en columnas separadas, así que restringir es gratis y el
 * `LIMIT 50` sigue devolviendo 50 resultados útiles en vez de 50 candidatos de
 * los que sobrevivan tres.
 */
import { select } from "./client";
import {
  aPalabras,
  buildFtsQuery,
  consultasDeTitulo,
  palabrasDeConsulta,
  plegar,
  plegarEtiqueta,
  separadoresSql,
  separarFiltrosPropiedad,
  type CampoBusqueda,
  type FiltroPropiedad,
} from "./fts";
import type { SearchResponse } from "./types";

/**
 * La condición sobre una fila `p` de `propiedades` para un filtro (`DEF-145`).
 *
 * - **Entre comillas** (`bancal:"Bancal 1"`): el valor completo, plegado.
 * - **Sin comillas** (`bancal:bancal`, `estado:crec`): una **palabra** del valor
 *   que empiece así —o que sea esa palabra, con «Búsqueda exacta»—, la misma
 *   regla que el texto. Las palabras se cortan en espacios y en la puntuación
 *   de `SEPARADORES`. No es un «contiene» como en Obsidian a propósito:
 *   `estado:activo` no debe traer «inactivo».
 *
 * Todo sobre las columnas PLEGADAS (`DEF-144`): sin tildes ni mayúsculas.
 *
 * Costo: la clave va siempre por igualdad, así que el índice
 * `idx_propiedades_plegado` (clave, valor) acota la búsqueda a las filas de
 * ESA clave; el `LIKE` se evalúa solo sobre ellas, leyendo el valor del propio
 * índice. Un `LIKE` con `%` adelante no usaría el índice por sí solo, pero acá
 * no lo necesita: es un recorrido de las notas que tienen esa propiedad, no
 * del vault. Medido (2026-10-07) con 20.000 notas que TODAS tienen la clave
 * (160.000 filas): igualdad 7,6 ms, palabra 20 ms con miles de coincidencias y
 * 2,5 ms sin ninguna (sin el `instr` previo eran 38 y 31 ms).
 */
export function condicionValor(
  { clave, valor, entero }: FiltroPropiedad,
  exacto = false,
): { sql: string; params: string[] } {
  if (entero) {
    return { sql: "p.clave_plegada = ? AND p.valor_plegado = ?", params: [plegar(clave), plegar(valor)] };
  }
  const palabra = aPalabras(plegar(valor)).trim();
  // Un valor que es todo puntuación (`x:-`) no tiene palabras: se compara entero.
  if (palabra.length === 0) {
    return { sql: "p.clave_plegada = ? AND p.valor_plegado = ?", params: [plegar(clave), plegar(valor)] };
  }
  // `%` y `_` del usuario son literales, no comodines del `LIKE` (se escapan
  // con `!`, que no exige pelearse con las barras de JS y de SQL).
  const literal = palabra.replace(/[!%_]/g, (c) => `!${c}`);
  // `instr` descarta antes, barato, las filas que ni contienen la primera
  // palabra (que aparece tal cual en el valor: los separadores no están dentro
  // de una palabra); solo las que quedan pagan los `replace` y el `LIKE`.
  const primera = palabra.split(" ")[0];
  return {
    sql: `p.clave_plegada = ? AND instr(p.valor_plegado, ?) > 0
          AND (' ' || ${separadoresSql("p.valor_plegado")} || ' ') LIKE ? ESCAPE '!'`,
    params: [plegar(clave), primera, `% ${literal}${exacto ? " " : ""}%`],
  };
}

/**
 * Una condición por filtro, encadenadas con AND.
 *
 * Va como `n.id IN (SELECT …)` y no como un `EXISTS` correlacionado: así la
 * subconsulta se resuelve una vez por el índice `idx_propiedades_plegado`
 * (clave y valor) en vez de recorrer las propiedades de cada nota del vault.
 */
export function condicionFiltros(
  filtros: FiltroPropiedad[],
  exacto = false,
): { sql: string; params: string[] } {
  const params: string[] = [];
  const sql = filtros
    .map((f) => {
      const c = condicionValor(f, exacto);
      params.push(...c.params);
      return ` AND n.id IN (SELECT p.nota_id FROM propiedades p WHERE ${c.sql})`;
    })
    .join("");
  return { sql, params };
}

/**
 * La condición sobre una fila `e` de `etiquetas` para un filtro `tag:x`
 * (`DEF-152`), con `tag` ya plegado (`plegarEtiqueta`): la etiqueta `x` o una
 * anidada debajo (`x/lo-que-sea`), como en Obsidian —`tag:huerta` trae
 * `#huerta/riego`; `tag:huerta/riego`, solo esa—. No es por prefijo de palabra
 * como el texto: `tag:huer` no trae `#huerta`.
 *
 * Las etiquetas son las de la tabla `etiquetas`, las mismas que ven el grafo y
 * la tabla de una base: `tags:` del frontmatter más los `#tag` del cuerpo,
 * fuera del código (`DEF-102`).
 *
 * Costo: la igualdad y el rango (`'x/' < t < 'x0'`: `0` es el carácter que
 * sigue a `/`) van los dos por el índice `idx_etiquetas_plegado`, que además
 * trae `nota_id`, así que la subconsulta no toca la tabla. Medido con 20.000
 * notas en `docs/features/bugs-progreso.md` (`DEF-152`).
 */
export function condicionEtiqueta(tag: string): { sql: string; params: string[] } {
  return {
    sql: "(e.tag_plegado = ? OR (e.tag_plegado > ? AND e.tag_plegado < ?))",
    params: [tag, `${tag}/`, `${tag}0`],
  };
}

/** Un `n.id IN (…)` por etiqueta, encadenados con AND: como `condicionFiltros`. */
export function condicionEtiquetas(etiquetas: string[]): { sql: string; params: string[] } {
  const params: string[] = [];
  const sql = etiquetas
    .map((t) => {
      const c = condicionEtiqueta(t);
      params.push(...c.params);
      return ` AND n.id IN (SELECT e.nota_id FROM etiquetas e WHERE ${c.sql})`;
    })
    .join("");
  return { sql, params };
}

export async function buscar(
  vaultId: string,
  q: string,
  exacto = false,
  campo: CampoBusqueda = "ambos",
): Promise<SearchResponse> {
  const { filtros, etiquetas, resto } = separarFiltrosPropiedad(q ?? "");
  const match = buildFtsQuery(resto, !exacto, campo);
  if (match.length === 0 && filtros.length === 0 && etiquetas.length === 0) return { resultados: [] };

  const props = condicionFiltros(filtros, exacto);
  const tags = condicionEtiquetas(etiquetas);
  const filtroSql = props.sql + tags.sql;
  const filtroParams = [...props.params, ...tags.params];

  // Solo filtros (`estado:activo` o `tag:x` a secas): no hay nada que buscar en
  // el FTS, así que se consulta directamente por propiedad o por etiqueta, y el
  // fragmento es la coincidencia.
  if (match.length === 0) {
    const primero = filtros.length > 0 ? condicionValor(filtros[0], exacto) : null;
    const fragmentoSql = primero
      ? `(SELECT p.clave || ': «' || p.valor || '»' FROM propiedades p
           WHERE p.nota_id = n.id AND ${primero.sql}
           LIMIT 1)`
      : "''";
    const resultados = await select<{
      nota_id: string;
      titulo: string;
      carpeta_id: string | null;
      fragmento: string;
    }>(
      `SELECT n.id AS nota_id, n.titulo, n.carpeta_id, ${fragmentoSql} AS fragmento
         FROM notas n
        WHERE n.vault_id = ?
          AND n.id NOT IN (SELECT nota_id FROM papelera)${filtroSql}
        ORDER BY n.titulo
        LIMIT 50`,
      [...(primero?.params ?? []), vaultId, ...filtroParams],
    );
    if (!primero) await fragmentosDeEtiqueta(resultados, etiquetas[0]);
    return { resultados };
  }

  // Buscando SOLO por nombre no se devuelve fragmento: la coincidencia es el
  // título, que ya se ve encima. Un `snippet` del cuerpo ahí sería el principio
  // del documento sin nada marcado — ruido que se lee como si el resaltado se
  // hubiera roto.
  const fragmento =
    campo === "nombre" ? "'' AS fragmento" : "snippet(notas_fts, 2, '«', '»', '…', 10) AS fragmento";

  const { sql: ordenSql, params: ordenParams } = ordenPorTitulo(resto, !exacto);

  const resultados = await select<{
    nota_id: string;
    titulo: string;
    carpeta_id: string | null;
    fragmento: string;
  }>(
    `SELECT f.nota_id, n.titulo, n.carpeta_id,
            ${fragmento}
     FROM notas_fts f
     JOIN notas n ON n.id = f.nota_id
     WHERE notas_fts MATCH ?
       AND n.vault_id = ?
       AND n.id NOT IN (SELECT nota_id FROM papelera)${filtroSql}
     ORDER BY ${ordenSql}
     LIMIT 50`,
    [match, vaultId, ...filtroParams, ...ordenParams],
  );
  if (campo !== "nombre") await completarFragmentos(resultados, resto, match, exacto);
  return { resultados };
}

/** Lo que `completarFragmentos` necesita de cada resultado. */
type ConFragmento = { nota_id: string; fragmento: string };

/**
 * El fragmento de una búsqueda solo por etiquetas (`DEF-152`): dónde está la
 * primera etiqueta de la consulta en cada nota.
 *
 * 1. En `tags:` del frontmatter → `tags: «x»`, como una propiedad que coincide.
 * 2. Si no, en el cuerpo: el `snippet()` del contenido con la etiqueta marcada
 *    (`… plantas vecinas. #«cultivo»`). Se busca como frase de sus palabras
 *    —el tokenizador corta `huerta/riego` en `huerta riego`—, solo entre las
 *    filas de los resultados.
 * 3. Si tampoco, `«#x»`.
 *
 * Dos consultas, sobre los 50 resultados de la página como mucho.
 */
async function fragmentosDeEtiqueta(resultados: ConFragmento[], tag: string): Promise<void> {
  if (resultados.length === 0) return;
  const porId = new Map(resultados.map((r) => [r.nota_id, r]));

  // El `+` saca a `clave_plegada` del índice: si no, SQLite elige
  // `idx_propiedades_plegado` y recorre las `tags` del vault entero (40.000
  // filas en la medición) en vez de las de estas notas.
  const enTags = await select<{ nota_id: string; clave: string; valor: string }>(
    `SELECT nota_id, clave, valor FROM propiedades
      WHERE nota_id IN (SELECT value FROM json_each(?)) AND +clave_plegada = 'tags'
      ORDER BY rowid`,
    [JSON.stringify([...porId.keys()])],
  );
  for (const p of enTags) {
    const r = porId.get(p.nota_id);
    const t = plegarEtiqueta(p.valor);
    if (r && !r.fragmento && (t === tag || t.startsWith(`${tag}/`))) r.fragmento = `${p.clave}: «${p.valor}»`;
  }

  const sinFragmento = resultados.filter((r) => !r.fragmento);
  const palabras = tag.split(/[^\p{L}\p{N}]+/u).filter((p) => p !== "");
  if (sinFragmento.length > 0 && palabras.length > 0) {
    // La frase de la etiqueta, palabra por palabra: `tag:huerta` marca también
    // `#huerta/riego`, que el tokenizador lee «huerta riego». Qué notas salen
    // ya lo decidió la tabla de etiquetas; esto solo elige qué resaltar.
    const filas = await select<{ nota_id: string; fragmento: string }>(
      `SELECT f.nota_id, snippet(notas_fts, 2, '«', '»', '…', 10) AS fragmento
         FROM notas_fts f
        WHERE notas_fts MATCH ?
          AND f.rowid IN (SELECT fila FROM fts_filas
                           WHERE nota_id IN (SELECT value FROM json_each(?)))`,
      [`contenido : "${palabras.join(" ")}"`, JSON.stringify(sinFragmento.map((r) => r.nota_id))],
    );
    for (const f of filas) {
      const r = porId.get(f.nota_id);
      if (r && f.fragmento?.includes("«")) r.fragmento = f.fragmento;
    }
  }
  for (const r of resultados) if (!r.fragmento) r.fragmento = `«#${tag}»`;
}

/**
 * Los resultados cuyo fragmento no marca nada (`DEF-148`): la coincidencia no
 * está en el texto legible de la nota sino en una propiedad, en un destino de
 * enlace con alias o solo en el título. El `snippet()` del contenido devuelve
 * entonces el principio de la nota sin resaltar, que se lee como si el
 * resaltado se hubiera roto. En orden:
 *
 * 1. Si la coincidencia es una **propiedad**, el fragmento es esa propiedad:
 *    `clave: valor`, con la palabra resaltada —lo mismo que muestra una
 *    búsqueda solo con filtros (`DEF-144`)—. Antes era el frontmatter entero,
 *    aplastado en una línea.
 * 2. Si no, lo que marca el `snippet()` de la columna `extra` (un destino de enlace, una
 *    URL), si marca algo.
 * 3. Si tampoco, queda el que había: la coincidencia es el título.
 *
 * Son a lo sumo dos consultas más, y solo sobre los resultados sin marca (como
 * mucho los 50 de la página): no se calcula un segundo `snippet()` para cada
 * coincidencia del vault antes de ordenar, que es lo que cuesta (`DEF-146`).
 */
async function completarFragmentos(
  resultados: ConFragmento[],
  resto: string,
  match: string,
  exacto: boolean,
): Promise<void> {
  let sinMarca = resultados.filter((r) => !r.fragmento?.includes("«"));
  if (sinMarca.length === 0) return;

  const palabras = palabrasDeConsulta(resto);
  if (palabras.length > 0) {
    const ids = sinMarca.map((r) => r.nota_id);
    const props = await select<{ nota_id: string; clave: string; valor: string }>(
      `SELECT nota_id, clave, valor FROM propiedades
        WHERE nota_id IN (SELECT value FROM json_each(?))
        ORDER BY rowid`,
      [JSON.stringify(ids)],
    );
    const porNota = new Map<string, { clave: string; valor: string }[]>();
    for (const p of props) {
      const lista = porNota.get(p.nota_id) ?? [];
      lista.push(p);
      porNota.set(p.nota_id, lista);
    }
    for (const r of sinMarca) {
      for (const p of porNota.get(r.nota_id) ?? []) {
        const marcado = marcarPalabras(p.valor, palabras, exacto);
        if (marcado !== null) {
          r.fragmento = `${p.clave}: ${marcado}`;
          break;
        }
      }
    }
    sinMarca = sinMarca.filter((r) => !r.fragmento?.includes("«"));
    if (sinMarca.length === 0) return;
  }

  const extras = await select<{ nota_id: string; fragmento: string }>(
    `SELECT f.nota_id, snippet(notas_fts, 3, '«', '»', '…', 10) AS fragmento
       FROM notas_fts f
      WHERE notas_fts MATCH ?
        AND f.rowid IN (SELECT fila FROM fts_filas
                         WHERE nota_id IN (SELECT value FROM json_each(?)))`,
    [match, JSON.stringify(sinMarca.map((r) => r.nota_id))],
  );
  const extraPorNota = new Map(extras.map((e) => [e.nota_id, e.fragmento]));
  // De `extra` se muestra solo lo marcado: alrededor hay valores de propiedades
  // y otros destinos sueltos, que como contexto no dicen nada.
  for (const r of sinMarca) {
    const marcas = extraPorNota.get(r.nota_id)?.match(/«[^»]*»/g);
    if (marcas) r.fragmento = [...new Set(marcas)].join(" · ");
  }
}

/**
 * `valor` con «» alrededor de cada palabra que coincide con alguna de las de la
 * consulta (ya plegadas): que empiece así o, con «Búsqueda exacta», que sea esa
 * palabra —la regla del FTS—. `null` si ninguna coincide.
 */
export function marcarPalabras(valor: string, palabras: string[], exacto: boolean): string | null {
  let alguna = false;
  const marcado = valor.replace(/[\p{L}\p{N}]+/gu, (w) => {
    const p = plegar(w);
    if (palabras.some((q) => (exacto ? p === q : p.startsWith(q)))) {
      alguna = true;
      return `«${w}»`;
    }
    return w;
  });
  return alguna ? marcado : null;
}

/**
 * El `ORDER BY` de la búsqueda con texto (`DEF-146`): primero el título, después
 * la relevancia.
 *
 * 1. Títulos que EMPIEZAN con el texto buscado, del más corto al más largo: el
 *    título idéntico a la consulta («Tomate» buscando «tomate») es el más corto
 *    posible, así que sale primero.
 * 2. Títulos que contienen todas las palabras.
 * 3. El resto, por `rank` (bm25 del FTS), como antes.
 *
 * Solo `rank` no alcanzaba: bm25 mide el documento entero (título y cuerpo como
 * una sola bolsa de palabras), así que la nota «Tomate» con un cuerpo largo que
 * no repite la palabra perdía contra cualquiera que la nombrara varias veces, y
 * con más de 50 coincidencias podía quedar afuera del `LIMIT`. Por eso el orden
 * se resuelve en la consulta y no reordenando en el cliente.
 *
 * Los grupos se calculan con dos subconsultas FTS restringidas al título (ver
 * `consultasDeTitulo`); no son correlacionadas, así que SQLite las resuelve una
 * vez cada una y después solo comprueba pertenencia por `rowid`.
 */
function ordenPorTitulo(resto: string, prefix: boolean): { sql: string; params: string[] } {
  const titulo = consultasDeTitulo(resto, prefix);
  if (!titulo) return { sql: "rank", params: [] };
  return {
    // Una sola clave de orden: el largo del título en el grupo 1, y en los
    // otros dos un número mayor que cualquier título.
    sql: `CASE WHEN f.rowid IN (SELECT rowid FROM notas_fts WHERE notas_fts MATCH ?) THEN length(n.titulo)
               WHEN f.rowid IN (SELECT rowid FROM notas_fts WHERE notas_fts MATCH ?) THEN 100000
               ELSE 200000 END,
          rank`,
    params: [titulo.empieza, titulo.contiene],
  };
}
