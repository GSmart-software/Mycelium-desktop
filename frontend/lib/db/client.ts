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

/**
 * Crea un executor sobre `tauri-plugin-sql` (carga perezosa). Por defecto abre
 * `mycelium.db`; se le puede pasar otra URL (p. ej. el índice de un vault).
 */
async function loadTauriExecutor(dbUrl: string = DB_URL): Promise<SqlExecutor> {
  const { default: Database } = await import("@tauri-apps/plugin-sql");
  const db = await Database.load(dbUrl);
  return {
    select: (sql, params = []) => db.select(sql, params),
    execute: async (sql, params = []) => {
      const r = await db.execute(sql, params);
      return { rowsAffected: r.rowsAffected, lastInsertId: r.lastInsertId };
    },
  };
}

/**
 * Hash corto y estable de una ruta absoluta: los primeros 16 hex de su SHA-256
 * (vía SubtleCrypto). Se usa para nombrar el archivo del índice de cada vault
 * (`index-<hash>.db`) sin depender de la ruta absoluta —arbitraria en Windows—.
 */
async function hashRuta(ruta: string): Promise<string> {
  const datos = new TextEncoder().encode(ruta);
  const buf = await crypto.subtle.digest("SHA-256", datos);
  return Array.from(new Uint8Array(buf))
    .slice(0, 8) // 8 bytes = 16 caracteres hex
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Abre (creando si no existe) el índice derivado del vault ubicado en
 * `vaultRuta` y lo deja como executor activo. El índice vive en el app-data de
 * la app —NO dentro del vault—, un archivo por vault: `sqlite:index-<hash>.db`,
 * donde `<hash>` deriva de la ruta absoluta del vault. Nombre relativo → el
 * plugin lo resuelve dentro del app-data. El índice es desechable/reconstruible.
 *
 * Devuelve el executor y lo inyecta con `setExecutor`; sin llamar a esta función
 * todo sigue usando `mycelium.db` (el comportamiento por defecto no cambia).
 */
export async function abrirIndiceDeVault(vaultRuta: string): Promise<SqlExecutor> {
  const hash = await hashRuta(vaultRuta);
  const executor = await loadTauriExecutor(`sqlite:index-${hash}.db`);
  // WAL en el índice (FUN-M-12): el indexado hace miles de statements sueltos,
  // cada uno con su transacción implícita, y con `journal_mode=delete` eso es un
  // fsync por statement sobre un caché que es reconstruible por definición.
  // Va con `select` porque el pragma DEVUELVE una fila (con `execute` el driver
  // se queja). Best-effort: si falla, el índice funciona igual.
  try {
    await executor.select("PRAGMA journal_mode=WAL");
    // `synchronous` es POR CONEXIÓN y `tauri-plugin-sql` mantiene un pool de
    // hasta 10, así que esto solo afecta a la conexión que lo ejecutó: ayuda
    // poco y no se puede forzar en las demás. WAL, en cambio, se guarda en la
    // cabecera del archivo y SÍ persiste para todas.
    await executor.select("PRAGMA synchronous=NORMAL");
  } catch {
    // Sin WAL el índice sigue siendo correcto, solo más lento al escribir.
  }
  setExecutor(executor);
  return executor;
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
