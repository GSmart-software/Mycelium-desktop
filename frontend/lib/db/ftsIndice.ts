/**
 * Escritura de la tabla de búsqueda `notas_fts` (`DEF-105`, `DEF-106`).
 *
 * Todo lo que agrega, cambia o borra filas de `notas_fts` pasa por acá. Antes
 * cada sitio escribía su propio `DELETE FROM notas_fts WHERE nota_id = ?`, y
 * ese es el problema: `nota_id` es una columna `UNINDEXED` de FTS5, así que
 * filtrar por ella **recorre la tabla entera** —con el contenido de cada nota—
 * en cada borrado. Medido en SQLite con 20.000 notas chicas: 16 ms por borrado
 * por `nota_id`, 0,02 ms por `rowid`. En un índice de cientos de MB, borrar las
 * 5.000 notas de un `git worktree remove` eran horas: el cuelgue de `DEF-105`.
 * Y cada guardado de una nota pagaba un recorrido completo.
 *
 * La salida es buscar por `rowid`, que FTS5 resuelve con su clave primaria.
 * `fts_filas` guarda qué `rowid` le toca a cada nota. Es una tabla propia y no
 * el `rowid` de `notas`, porque ese **no es estable**: `notas` tiene clave
 * `TEXT`, y SQLite puede renumerar su `rowid` en un `VACUUM`. El de
 * `notas_fts` sí lo es (su tabla de contenido tiene clave entera explícita).
 */
import { execute, select } from "./client";

/**
 * Cuántos ids van en cada `IN (…)`. SQLite admite miles de parámetros; 500 deja
 * margen de sobra y hace que 5.000 borrados sean diez sentencias, no 5.000.
 */
const TANDA_IDS = 500;

/** Parte una lista en tandas de `TANDA_IDS`. */
export function enTandas<T>(lista: T[]): T[][] {
  const tandas: T[][] = [];
  for (let i = 0; i < lista.length; i += TANDA_IDS) tandas.push(lista.slice(i, i + TANDA_IDS));
  return tandas;
}

/** `?, ?, ?` para una tanda. */
export const marcadores = (n: number): string => Array(n).fill("?").join(", ");

/**
 * Crea `fts_filas` y, si el índice es anterior a ella, la llena con lo que ya
 * hay en `notas_fts`. Idempotente: solo trabaja la primera vez.
 *
 * La migración es un solo recorrido de `notas_fts`, no uno por nota. Si una nota
 * quedó con dos filas —de algún camino viejo que insertó sin borrar—, se queda
 * la última y las demás se eliminan: ya estaban de más.
 */
export async function crearFtsFilas(): Promise<void> {
  const existe = await select<{ n: number }>(
    "SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name = 'fts_filas'",
  );
  if ((existe[0]?.n ?? 0) > 0) return;
  await execute(
    `CREATE TABLE IF NOT EXISTS fts_filas (
       nota_id TEXT PRIMARY KEY,
       fila    INTEGER NOT NULL UNIQUE
     )`,
  );
  await execute(
    `INSERT OR IGNORE INTO fts_filas (nota_id, fila)
     SELECT nota_id, MAX(rowid) FROM notas_fts GROUP BY nota_id`,
  );
  await execute("DELETE FROM notas_fts WHERE rowid NOT IN (SELECT fila FROM fts_filas)");
}

/**
 * Pone (o reemplaza) la fila de búsqueda de una nota.
 *
 * Son dos sentencias sueltas a propósito: `tauri-plugin-sql` reparte las
 * sentencias entre un pool de conexiones, así que un `BEGIN … COMMIT` no
 * garantiza caer en la misma. Por eso cada una es correcta por sí sola:
 *   1. reservar un `rowid` para la nota, si no tiene (`MAX + 1` en la MISMA
 *      sentencia, así dos inserciones concurrentes no eligen el mismo);
 *   2. `INSERT OR REPLACE` en ese `rowid`: si ya había fila, FTS5 la reemplaza.
 */
export async function ftsPoner(id: string, titulo: string, contenido: string): Promise<void> {
  await execute(
    `INSERT INTO fts_filas (nota_id, fila)
     VALUES (?, (SELECT COALESCE(MAX(fila), 0) + 1 FROM fts_filas))
     ON CONFLICT(nota_id) DO NOTHING`,
    [id],
  );
  await execute(
    `INSERT OR REPLACE INTO notas_fts (rowid, nota_id, titulo, contenido)
     VALUES ((SELECT fila FROM fts_filas WHERE nota_id = ?), ?, ?, ?)`,
    [id, id, titulo, contenido],
  );
}

/** Cambia solo el título indexado de una nota. */
export async function ftsRetitular(id: string, titulo: string): Promise<void> {
  await execute(
    "UPDATE notas_fts SET titulo = ? WHERE rowid = (SELECT fila FROM fts_filas WHERE nota_id = ?)",
    [titulo, id],
  );
}

/** Borra las filas de búsqueda de estas notas, por tandas. */
export async function ftsBorrar(ids: string[]): Promise<void> {
  for (const tanda of enTandas(ids)) {
    const q = marcadores(tanda.length);
    await execute(
      `DELETE FROM notas_fts WHERE rowid IN (SELECT fila FROM fts_filas WHERE nota_id IN (${q}))`,
      tanda,
    );
    await execute(`DELETE FROM fts_filas WHERE nota_id IN (${q})`, tanda);
  }
}
