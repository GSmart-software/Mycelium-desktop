/**
 * Indexador del "vault en carpeta" (fase 2): reconstruye el índice derivado
 * (SQLite) releyendo los archivos de la carpeta del vault. El índice NO es la
 * fuente de verdad —lo son los archivos en disco—; es un caché reconstruible
 * para que la búsqueda FTS5 y el grafo (que siguen resolviéndose en SQL) sigan
 * funcionando. Ver `docs/features/vault-en-carpeta.md`.
 *
 * Esta fase construye SOLO la infraestructura del índice: nada de esto se activa
 * todavía (el arranque y el dispatcher siguen usando `mycelium.db`).
 *
 * Convenciones del índice (decididas en la spec):
 *   - `notas.id` = ruta relativa POSIX del archivo (`Proyectos/2026/plan.md`).
 *   - `titulo`   = nombre del archivo sin extensión.
 *   - `tipo`     = `markdown` | `excalidraw` según la extensión.
 *   - `carpetas.id` = ruta POSIX de la carpeta; `padre_id` = carpeta padre o NULL.
 *   - `vault_id`  = constante `"vault"` (hay un índice por vault).
 */
import { execute, select } from "./client";
import { ahoraIso, byteLen } from "./util";

/** Id de vault constante: el índice es por vault, no hace falta distinguir. */
const VAULT_ID = "vault";

/**
 * Esquema del índice. ESPEJA `frontend/src-tauri/migrations/001_init.sql` para
 * las tablas que consultan los repos existentes (`carpetas`, `notas`,
 * `contenidos`, `notas_fts`, `papelera`, `diagramas`) y DEBE mantenerse en sync
 * con él. Diferencias intencionadas respecto a 001_init:
 *   - Se omiten las tablas `usuarios`/`vaults`/`membresias`/`css_snippets` y las
 *     claves foráneas hacia `vaults`/`usuarios`: el índice es autónomo y no las
 *     necesita (`vault_id` queda como TEXT plano).
 *   - `notas` añade una columna `mtime INTEGER` (propia del índice) para la
 *     validación incremental por fecha de modificación.
 * NO se usa `_sqlx_migrations`: el índice no se migra con sqlx, se crea con
 * estos `CREATE TABLE IF NOT EXISTS`.
 */
const ESQUEMA_INDICE: string[] = [
  `CREATE TABLE IF NOT EXISTS carpetas (
     id             TEXT PRIMARY KEY,
     vault_id       TEXT NOT NULL,
     padre_id       TEXT REFERENCES carpetas(id) ON DELETE CASCADE,
     nombre         TEXT NOT NULL,
     creado_en      TEXT NOT NULL,
     actualizado_en TEXT NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS idx_carpetas_vault ON carpetas(vault_id)`,
  `CREATE INDEX IF NOT EXISTS idx_carpetas_padre ON carpetas(padre_id)`,
  `CREATE TABLE IF NOT EXISTS notas (
     id             TEXT PRIMARY KEY,
     vault_id       TEXT NOT NULL,
     carpeta_id     TEXT REFERENCES carpetas(id) ON DELETE SET NULL,
     titulo         TEXT NOT NULL,
     tipo           TEXT NOT NULL DEFAULT 'markdown',
     tamano_bytes   INTEGER NOT NULL DEFAULT 0,
     mtime          INTEGER NOT NULL DEFAULT 0,
     creado_en      TEXT NOT NULL,
     actualizado_en TEXT NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS idx_notas_vault ON notas(vault_id)`,
  `CREATE INDEX IF NOT EXISTS idx_notas_carpeta ON notas(carpeta_id)`,
  `CREATE TABLE IF NOT EXISTS contenidos (
     nota_id        TEXT PRIMARY KEY REFERENCES notas(id) ON DELETE CASCADE,
     contenido      TEXT NOT NULL DEFAULT '',
     actualizado_en TEXT NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS diagramas (
     nota_id        TEXT NOT NULL REFERENCES notas(id) ON DELETE CASCADE,
     diag_id        TEXT NOT NULL,
     contenido      TEXT NOT NULL DEFAULT '',
     actualizado_en TEXT NOT NULL,
     PRIMARY KEY (nota_id, diag_id)
   )`,
  `CREATE TABLE IF NOT EXISTS papelera (
     id                  TEXT PRIMARY KEY,
     nota_id             TEXT NOT NULL UNIQUE REFERENCES notas(id) ON DELETE CASCADE,
     ruta_original       TEXT NOT NULL,
     carpeta_original_id TEXT,
     eliminado_en        TEXT NOT NULL
   )`,
  `CREATE VIRTUAL TABLE IF NOT EXISTS notas_fts USING fts5(
     nota_id UNINDEXED,
     titulo,
     contenido
   )`,
];

/** Crea el esquema del índice (idempotente) contra el executor activo. */
export async function crearEsquemaIndice(): Promise<void> {
  for (const sql of ESQUEMA_INDICE) {
    await execute(sql);
  }
}

/** Metadatos de un archivo devueltos por el comando Rust `listar_archivos_meta`. */
type ArchivoMeta = {
  rutaRelativa: string;
  contenido: string;
  mtime: number;
  tipo: string;
};

/** Carpeta derivada de una ruta: id (ruta POSIX), padre y nombre (basename). */
type CarpetaDerivada = { id: string; padre_id: string | null; nombre: string };

/**
 * Deriva todas las carpetas (y sus ancestros) implicadas por la ruta de un
 * archivo. Para `Proyectos/2026/plan.md` devuelve `Proyectos` (padre null) y
 * `Proyectos/2026` (padre `Proyectos`). Un archivo en la raíz no deriva carpetas.
 */
function carpetasDeRuta(ruta: string): CarpetaDerivada[] {
  const partes = ruta.split("/");
  partes.pop(); // quitar el nombre de archivo
  const out: CarpetaDerivada[] = [];
  for (let i = 0; i < partes.length; i++) {
    out.push({
      id: partes.slice(0, i + 1).join("/"),
      padre_id: i === 0 ? null : partes.slice(0, i).join("/"),
      nombre: partes[i],
    });
  }
  return out;
}

/** carpeta_id de un archivo (la carpeta que lo contiene) o null si está en raíz. */
function carpetaDeArchivo(ruta: string): string | null {
  const i = ruta.lastIndexOf("/");
  return i === -1 ? null : ruta.slice(0, i);
}

/** Título = nombre de archivo sin la extensión final. */
function tituloDeRuta(ruta: string): string {
  const nombre = ruta.slice(ruta.lastIndexOf("/") + 1);
  return nombre.replace(/\.[^.]+$/, "");
}

/**
 * Indexa la carpeta del vault en el índice (executor activo, que debe ser el
 * índice del vault: ver `abrirIndiceDeVault`). Estrategia incremental por
 * `mtime`: solo se reindexa lo nuevo o cambiado; lo que ya no existe en disco se
 * borra del índice. Debe llamarse con el índice del vault ya abierto.
 *
 * Nota Excalidraw: en fase 2 su escena se guarda en `contenidos` igual que el
 * markdown (no se separan aún los `diagramas`); se simplifica así a propósito.
 *
 * @returns totales: `notas` en disco, `carpetas` derivadas, `reindexadas`
 *          (notas nuevas o modificadas que se reescribieron en el índice).
 */
export async function indexarVault(
  vaultRuta: string,
  onProgress?: (hechas: number, total: number) => void,
): Promise<{ notas: number; carpetas: number; reindexadas: number }> {
  await crearEsquemaIndice();

  const { invoke } = await import("@tauri-apps/api/core");
  const archivos = await invoke<ArchivoMeta[]>("listar_archivos_meta", {
    origen: vaultRuta,
  });

  // Carpetas únicas derivadas de todas las rutas (padres antes que hijos).
  const carpetas = new Map<string, CarpetaDerivada>();
  for (const a of archivos) {
    for (const c of carpetasDeRuta(a.rutaRelativa)) carpetas.set(c.id, c);
  }

  // Estado actual del índice: mtime por nota y carpetas existentes (para limpieza).
  const notasExistentes = await select<{ id: string; mtime: number }>(
    "SELECT id, mtime FROM notas",
  );
  const mtimePorId = new Map(notasExistentes.map((r) => [r.id, r.mtime]));
  const carpetasExistentes = await select<{ id: string }>("SELECT id FROM carpetas");

  const now = ahoraIso();

  // 1) Upsert de carpetas, ordenadas por profundidad para respetar padre→hijo.
  const carpetasOrdenadas = [...carpetas.values()].sort(
    (a, b) => a.id.split("/").length - b.id.split("/").length,
  );
  for (const c of carpetasOrdenadas) {
    await execute(
      `INSERT INTO carpetas (id, vault_id, padre_id, nombre, creado_en, actualizado_en)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         padre_id = excluded.padre_id,
         nombre = excluded.nombre,
         actualizado_en = excluded.actualizado_en`,
      [c.id, VAULT_ID, c.padre_id, c.nombre, now, now],
    );
  }

  // 2) Upsert incremental de notas + contenido + FTS (saltando lo no cambiado).
  let reindexadas = 0;
  let hechas = 0;
  for (const a of archivos) {
    const id = a.rutaRelativa;
    const previo = mtimePorId.get(id);
    if (previo !== undefined && previo === a.mtime) {
      hechas++;
      onProgress?.(hechas, archivos.length);
      continue; // sin cambios en disco → no se reindexa
    }

    const titulo = tituloDeRuta(id);
    const carpetaId = carpetaDeArchivo(id);
    const bytes = byteLen(a.contenido);

    await execute(
      `INSERT INTO notas (id, vault_id, carpeta_id, titulo, tipo, tamano_bytes, mtime, creado_en, actualizado_en)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         carpeta_id = excluded.carpeta_id,
         titulo = excluded.titulo,
         tipo = excluded.tipo,
         tamano_bytes = excluded.tamano_bytes,
         mtime = excluded.mtime,
         actualizado_en = excluded.actualizado_en`,
      [id, VAULT_ID, carpetaId, titulo, a.tipo, bytes, a.mtime, now, now],
    );

    // Contenido: Excalidraw se guarda igual que el markdown (fase 2 no separa
    // diagramas). Upsert como en `contenido.ts`.
    await execute(
      `INSERT INTO contenidos (nota_id, contenido, actualizado_en) VALUES (?, ?, ?)
       ON CONFLICT(nota_id) DO UPDATE SET
         contenido = excluded.contenido,
         actualizado_en = excluded.actualizado_en`,
      [id, a.contenido, now],
    );

    // Reindex FTS (delete + insert), como `TouchNotaContenidoAsync`/`contenido.ts`.
    await execute("DELETE FROM notas_fts WHERE nota_id = ?", [id]);
    await execute("INSERT INTO notas_fts (nota_id, titulo, contenido) VALUES (?, ?, ?)", [
      id,
      titulo,
      a.contenido,
    ]);

    reindexadas++;
    hechas++;
    onProgress?.(hechas, archivos.length);
  }

  // 3) Limpieza: borrar del índice lo que ya no existe en disco.
  const rutasActuales = new Set(archivos.map((a) => a.rutaRelativa));
  for (const { id } of notasExistentes) {
    if (rutasActuales.has(id)) continue;
    await execute("DELETE FROM notas_fts WHERE nota_id = ?", [id]);
    await execute("DELETE FROM contenidos WHERE nota_id = ?", [id]);
    await execute("DELETE FROM diagramas WHERE nota_id = ?", [id]);
    await execute("DELETE FROM papelera WHERE nota_id = ?", [id]);
    await execute("DELETE FROM notas WHERE id = ?", [id]);
  }
  for (const { id } of carpetasExistentes) {
    if (carpetas.has(id)) continue;
    await execute("DELETE FROM carpetas WHERE id = ?", [id]);
  }

  return { notas: archivos.length, carpetas: carpetas.size, reindexadas };
}
