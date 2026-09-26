/**
 * Contenido de notas (HU-04) + reindex FTS5 (HU-21). Portado de
 * `NoteContentEndpoints` + `VaultRepository.TouchNotaContenidoAsync`. El archivo
 * en disco es la fuente de verdad; la tabla `contenidos` del índice es su copia
 * para búsqueda, grafo y bases.
 *
 * `actualizadoEn` que ve el cliente es SIEMPRE `notas.actualizado_en` (no el de la
 * tabla de contenido), igual que en el backend.
 */
import { execute, select } from "./client";
import { ftsPoner } from "./ftsIndice";
import { DbError } from "./errors";
import { derivarIndice, reindexarPropiedadesTanda } from "./propiedades";
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
  const vault = getVaultActual();
  const notas = await select<{ titulo: string; hash_indexable: string | null }>(
    "SELECT titulo, hash_indexable FROM notas WHERE id = ?",
    [id],
  );
  if (notas.length === 0) throw new DbError(404, "La nota no existe.");

  const texto = contenido ?? "";
  const bytes = byteLen(texto);
  const now = ahoraIso();

  // Los archivos son la fuente de verdad. El editor ya llega con debounce de
  // 800 ms, así que se escribe en disco en cada guardado (id = ruta). El `mtime`
  // con que quedó el archivo va a `notas.mtime` (`FUN-M-38`): sin esto, el índice
  // seguía con el `mtime` de la última lectura, el reindexado incremental veía la
  // nota como cambiada y la volvía a leer y a indexar.
  const mtime = await escribirNota(vault, id, texto);

  await execute(
    `INSERT INTO contenidos (nota_id, contenido, actualizado_en) VALUES (?, ?, ?)
     ON CONFLICT(nota_id) DO UPDATE SET contenido = excluded.contenido, actualizado_en = excluded.actualizado_en`,
    [id, texto, now],
  );
  // Lo que se indexa es el CUERPO + los VALORES de las propiedades: el YAML crudo
  // (las claves, los guiones) ensuciaba la búsqueda y los fragmentos de
  // resultado (FUN-M-04). Y solo si cambió (`FUN-M-38`, H10): la huella de lo
  // indexable se compara con la guardada, y si es la misma, ni `notas_fts` ni
  // `propiedades` se reescriben —en una nota de 500 KB, cientos de ms de FTS5
  // por cada guardado que no las tocaba—.
  const { indexable, propiedades, huella } = derivarIndice(texto);
  if (huella !== notas[0].hash_indexable) {
    await ftsPoner(id, notas[0].titulo, indexable);
    await reindexarPropiedadesTanda([{ id, propiedades }]);
  }
  // La huella se guarda DESPUÉS de reindexar: si `ftsPoner` o las propiedades
  // fallan, la nota queda con la huella vieja y el próximo guardado reintenta.
  await execute(
    "UPDATE notas SET tamano_bytes = ?, actualizado_en = ?, mtime = ?, hash_indexable = ? WHERE id = ?",
    [bytes, now, mtime, huella, id],
  );

  return { actualizadoEn: now };
}
