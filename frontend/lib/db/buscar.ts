/**
 * Búsqueda full-text en el vault vía FTS5 (HU-21). Portado de
 * `SearchEndpoints` (`GET /vaults/{id}/buscar`). Por defecto la búsqueda es por
 * coincidencia (prefijo); `exacto=true` exige palabra completa (toggle DEF-035).
 *
 * Acepta además filtros `clave:valor` sobre las propiedades del frontmatter
 * (`FUN-M-04`): restringen por la tabla `propiedades` y se pueden combinar con
 * términos de texto o usarse solos.
 *
 * `campo` elige dónde mirar —nombre, contenido o los dos (`FUN-M-20`)— y se
 * resuelve en la propia consulta FTS, no filtrando después: `notas_fts` tiene el
 * título y el cuerpo en columnas separadas, así que restringir es gratis y el
 * `LIMIT 50` sigue devolviendo 50 resultados útiles en vez de 50 candidatos de
 * los que sobrevivan tres.
 */
import { select } from "./client";
import {
  buildFtsQuery,
  separarFiltrosPropiedad,
  type CampoBusqueda,
  type FiltroPropiedad,
} from "./fts";
import type { SearchResponse } from "./types";

/** `EXISTS (…)` por filtro, para encadenarlos con AND. */
function condicionFiltros(filtros: FiltroPropiedad[]): { sql: string; params: string[] } {
  const params: string[] = [];
  const sql = filtros
    .map(({ clave, valor }) => {
      params.push(clave, valor);
      return ` AND EXISTS (SELECT 1 FROM propiedades p
                 WHERE p.nota_id = n.id
                   AND p.clave = ? COLLATE NOCASE
                   AND p.valor = ? COLLATE NOCASE)`;
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
  const { filtros, resto } = separarFiltrosPropiedad(q ?? "");
  const match = buildFtsQuery(resto, !exacto, campo);
  if (match.length === 0 && filtros.length === 0) return { resultados: [] };

  const { sql: filtroSql, params: filtroParams } = condicionFiltros(filtros);

  // Solo filtros (`estado:activo` a secas): no hay nada que buscar en el FTS, así
  // que se consulta directamente por propiedad y el fragmento es la coincidencia.
  if (match.length === 0) {
    const resultados = await select<{
      nota_id: string;
      titulo: string;
      carpeta_id: string | null;
      fragmento: string;
    }>(
      `SELECT n.id AS nota_id, n.titulo, n.carpeta_id,
              (SELECT p.clave || ': «' || p.valor || '»' FROM propiedades p
                WHERE p.nota_id = n.id AND p.clave = ? COLLATE NOCASE
                LIMIT 1) AS fragmento
         FROM notas n
        WHERE n.vault_id = ?
          AND n.id NOT IN (SELECT nota_id FROM papelera)${filtroSql}
        ORDER BY n.titulo
        LIMIT 50`,
      [filtros[0].clave, vaultId, ...filtroParams],
    );
    return { resultados };
  }

  // Buscando SOLO por nombre no se devuelve fragmento: la coincidencia es el
  // título, que ya se ve encima. Un `snippet` del cuerpo ahí sería el principio
  // del documento sin nada marcado — ruido que se lee como si el resaltado se
  // hubiera roto.
  const fragmento =
    campo === "nombre" ? "'' AS fragmento" : "snippet(notas_fts, 2, '«', '»', '…', 10) AS fragmento";

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
     ORDER BY rank
     LIMIT 50`,
    [match, vaultId, ...filtroParams],
  );
  return { resultados };
}
