/**
 * Capa de datos del desktop (Tauri): acceso a SQLite nativo vía `tauri-plugin-sql`.
 *
 * Los repos (`lib/db/*`) NO importan el plugin directamente: hablan con un
 * `SqlExecutor` que se resuelve de forma perezosa. Esto:
 *   - mantiene los repos como lógica pura y **testeable** (se les puede inyectar
 *     un executor sobre cualquier SQLite en un test headless), y
 *   - encaja con el seam web/desktop (fase 4): la web podría inyectar otro
 *     executor sin tocar los repos.
 *
 * SQL portable: se usan placeholders posicionales `?` (los acepta tanto el
 * sqlx-SQLite del plugin —confirmado en el smoke test de fase 0— como los
 * SQLite de test). NUNCA `$1`.
 */

/** Fila genérica devuelta por un SELECT. */
export type Row = Record<string, unknown>;

/** Resultado de un INSERT/UPDATE/DELETE. */
export type ExecResult = { rowsAffected: number; lastInsertId?: number };

/** Puerto de acceso a SQLite. Lo implementa el plugin Tauri (y los tests). */
export interface SqlExecutor {
  select<T = Row>(sql: string, params?: unknown[]): Promise<T[]>;
  execute(sql: string, params?: unknown[]): Promise<ExecResult>;
}

/** URL de la base local; debe coincidir con `DB_URL` de `src-tauri/src/lib.rs`. */
const DB_URL = "sqlite:mycelium.db";

let injected: SqlExecutor | null = null;
let loading: Promise<SqlExecutor> | null = null;

/**
 * Inyecta un executor (para tests o para el adaptador web futuro). Si se pasa
 * `null`, se vuelve al executor Tauri por defecto.
 */
export function setExecutor(executor: SqlExecutor | null): void {
  injected = executor;
  loading = null;
}

/** Crea el executor por defecto sobre `tauri-plugin-sql` (carga perezosa). */
async function loadTauriExecutor(): Promise<SqlExecutor> {
  const { default: Database } = await import("@tauri-apps/plugin-sql");
  const db = await Database.load(DB_URL);
  return {
    select: (sql, params = []) => db.select(sql, params),
    execute: async (sql, params = []) => {
      const r = await db.execute(sql, params);
      return { rowsAffected: r.rowsAffected, lastInsertId: r.lastInsertId };
    },
  };
}

/** Devuelve el executor activo (inyectado o Tauri), cacheado. */
export async function getExecutor(): Promise<SqlExecutor> {
  if (injected) return injected;
  if (!loading) loading = loadTauriExecutor();
  return loading;
}

/** Atajo: SELECT contra el executor activo. */
export async function select<T = Row>(sql: string, params?: unknown[]): Promise<T[]> {
  return (await getExecutor()).select<T>(sql, params);
}

/** Atajo: INSERT/UPDATE/DELETE contra el executor activo. */
export async function execute(sql: string, params?: unknown[]): Promise<ExecResult> {
  return (await getExecutor()).execute(sql, params);
}
