/**
 * Contenido de notas (HU-04) + reindex FTS5 (HU-21). Portado de
 * `NoteContentEndpoints` + `VaultRepository.TouchNotaContenidoAsync`. En el modelo
 * desktop el contenido vive en la tabla `contenidos` (antes blob en disco).
 *
 * `actualizadoEn` que ve el cliente es SIEMPRE `notas.actualizado_en` (no el de la
 * tabla de contenido), igual que en el backend.
 */
import { execute, select } from "./client";
import { DbError } from "./errors";
import { reindexarPropiedades, textoIndexable } from "./propiedades";
import type { ContenidoResponse, PutContenidoResponse } from "./types";
import { ahoraIso, byteLen } from "./util";
import { getVaultActual } from "./vaultContext";
import { escribirNota } from "./vaultFs";

/** `GET /notas/{id}/contenido`. */
export async function getContenido(id: string): Promise<ContenidoResponse> {
  const rows = await select<{ actualizado_en: string; contenido: string | null }>(
    `SELECT n.actualizado_en, c.contenido
     FROM notas n LEFT JOIN contenidos c ON c.nota_id = n.id
     WHERE n.id = ?`,
    [id],
  );
  if (rows.length === 0) throw new DbError(404, "La nota no existe.");
  return { contenido: rows[0].contenido ?? "", actualizadoEn: rows[0].actualizado_en };
}

/** `PUT /notas/{id}/contenido`: upsert contenido, actualiza metadatos y reindexa FTS. */
export async function putContenido(id: string, contenido: string | null): Promise<PutContenidoResponse> {
  const notas = await select<{ titulo: string }>("SELECT titulo FROM notas WHERE id = ?", [id]);
  if (notas.length === 0) throw new DbError(404, "La nota no existe.");

  const texto = contenido ?? "";
  const bytes = byteLen(texto);
  const now = ahoraIso();

  // Modo carpeta: los archivos son la fuente de verdad. El editor ya llega con
  // debounce de 800 ms, así que se escribe en disco en cada guardado (id = ruta).
  const vault = getVaultActual();
  if (vault !== null) {
    await escribirNota(vault, id, texto);
  }

  await execute(
    `INSERT INTO contenidos (nota_id, contenido, actualizado_en) VALUES (?, ?, ?)
     ON CONFLICT(nota_id) DO UPDATE SET contenido = excluded.contenido, actualizado_en = excluded.actualizado_en`,
    [id, texto, now],
  );
  await execute("UPDATE notas SET tamano_bytes = ?, actualizado_en = ? WHERE id = ?", [
    bytes,
    now,
    id,
  ]);
  // Reindex FTS (delete + insert), como TouchNotaContenidoAsync. Lo que se indexa
  // es el CUERPO + los VALORES de las propiedades: el YAML crudo (las claves, los
  // guiones) ensuciaba la búsqueda y los fragmentos de resultado (FUN-M-04).
  await execute("DELETE FROM notas_fts WHERE nota_id = ?", [id]);
  await execute("INSERT INTO notas_fts (nota_id, titulo, contenido) VALUES (?, ?, ?)", [
    id,
    notas[0].titulo,
    textoIndexable(texto),
  ]);
  await reindexarPropiedades(id, texto);

  return { actualizadoEn: now };
}
