/**
 * Búsqueda full-text en el vault vía FTS5 (HU-21). Portado de
 * `SearchEndpoints` (`GET /vaults/{id}/buscar`). Por defecto la búsqueda es por
 * coincidencia (prefijo); `exacto=true` exige palabra completa (toggle DEF-035).
 */
import { select } from "./client";
import { buildFtsQuery } from "./fts";
import type { SearchResponse } from "./types";

export async function buscar(
  vaultId: string,
  q: string,
  exacto = false,
): Promise<SearchResponse> {
  const match = buildFtsQuery(q ?? "", !exacto);
  if (match.length === 0) return { resultados: [] };

  const resultados = await select<{
    nota_id: string;
    titulo: string;
    carpeta_id: string | null;
    fragmento: string;
  }>(
    `SELECT f.nota_id, n.titulo, n.carpeta_id,
            snippet(notas_fts, 2, '«', '»', '…', 10) AS fragmento
     FROM notas_fts f
     JOIN notas n ON n.id = f.nota_id
     WHERE notas_fts MATCH ?
       AND n.vault_id = ?
       AND n.id NOT IN (SELECT nota_id FROM papelera)
     ORDER BY rank
     LIMIT 50`,
    [match, vaultId],
  );
  return { resultados };
}
