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
 *   - `vault_id`  = `LOCAL_VAULT_ID` (fase 3): el índice reutiliza el vault
 *     sembrado por `ensureSeed()` para que `tree(LOCAL_VAULT_ID)` y toda la capa
 *     de datos funcionen contra el índice igual que contra `mycelium.db`.
 */
import { LOCAL_VAULT_ID } from "./auth";
import { execute, select } from "./client";
import { reindexarPropiedades, textoIndexable } from "./propiedades";
import { ahoraIso, byteLen } from "./util";

/**
 * Id del vault en el índice. Coincide con el vault sembrado (`LOCAL_VAULT_ID`)
 * para que `tree(LOCAL_VAULT_ID)` devuelva las notas indexadas. Antes era la
 * constante `"vault"`; se reconcilió en fase 3.
 */
const VAULT_ID = LOCAL_VAULT_ID;

/**
 * Esquema del índice. ESPEJA `frontend/src-tauri/migrations/001_init.sql`
 * (esquema COMPLETO desde fase 3) y DEBE mantenerse en sync con él, para que
 * TODA la capa de datos (`session`/`me`/`tree`/CSS…) funcione contra el índice
 * igual que contra `mycelium.db`. Incluye `usuarios`/`vaults`/`membresias`/
 * `css_snippets`, que `ensureSeed()` puebla antes de indexar. Diferencias
 * intencionadas respecto a 001_init:
 *   - Se omiten las claves foráneas hacia `vaults`/`usuarios` en `carpetas`/
 *     `notas` (`vault_id`/`carpeta_id` quedan como TEXT plano): las filas del
 *     índice se upsertan por ruta y no se quiere el coste de validar la FK.
 *   - `notas` añade una columna `mtime INTEGER` (propia del índice) para la
 *     validación incremental por fecha de modificación.
 *   - `papelera` añade `ruta_papelera TEXT` (fase 4): dónde quedó el archivo en
 *     `.mycelium/.trash` para poder restaurarlo (solo se usa en modo carpeta).
 * NO se usa `_sqlx_migrations`: el índice no se migra con sqlx, se crea con
 * estos `CREATE TABLE IF NOT EXISTS`.
 */
const ESQUEMA_INDICE: string[] = [
  `CREATE TABLE IF NOT EXISTS usuarios (
     id                TEXT PRIMARY KEY,
     email             TEXT NOT NULL UNIQUE,
     nombre            TEXT NOT NULL,
     password_hash     TEXT,
     github_id         TEXT,
     avatar_url        TEXT,
     email_verificado  INTEGER NOT NULL DEFAULT 0,
     tema              TEXT NOT NULL DEFAULT 'bioluminiscencia',
     modo_oscuro       INTEGER NOT NULL DEFAULT 1,
     preferencias_json TEXT,
     creado_en         TEXT NOT NULL,
     actualizado_en    TEXT NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS vaults (
     id             TEXT PRIMARY KEY,
     nombre         TEXT NOT NULL,
     propietario_id TEXT NOT NULL REFERENCES usuarios(id),
     creado_en      TEXT NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS membresias (
     id           TEXT PRIMARY KEY,
     usuario_id   TEXT NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
     recurso_tipo TEXT NOT NULL CHECK (recurso_tipo IN ('vault', 'carpeta')),
     recurso_id   TEXT NOT NULL,
     rol          TEXT NOT NULL CHECK (rol IN ('lector', 'editor', 'propietario')),
     creado_en    TEXT NOT NULL,
     UNIQUE (usuario_id, recurso_tipo, recurso_id)
   )`,
  `CREATE INDEX IF NOT EXISTS idx_membresias_usuario ON membresias(usuario_id)`,
  `CREATE INDEX IF NOT EXISTS idx_membresias_recurso ON membresias(recurso_tipo, recurso_id)`,
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
     eliminado_en        TEXT NOT NULL,
     ruta_papelera       TEXT
   )`,
  `CREATE VIRTUAL TABLE IF NOT EXISTS notas_fts USING fts5(
     nota_id UNINDEXED,
     titulo,
     contenido
   )`,
  // Propiedades del frontmatter YAML (FUN-M-04). Una fila POR ELEMENTO de lista
  // (`orden` = posición; 0 si es escalar), para poder filtrar con `=` en vez de
  // `LIKE`. Es una tabla NUEVA del índice: no existe en `001_init.sql`, porque
  // se deriva del contenido igual que `notas_fts`.
  `CREATE TABLE IF NOT EXISTS propiedades (
     nota_id TEXT NOT NULL REFERENCES notas(id) ON DELETE CASCADE,
     clave   TEXT NOT NULL,
     valor   TEXT NOT NULL,
     tipo    TEXT NOT NULL,
     orden   INTEGER NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS idx_propiedades_nota  ON propiedades(nota_id)`,
  `CREATE INDEX IF NOT EXISTS idx_propiedades_clave ON propiedades(clave, valor)`,
  `CREATE TABLE IF NOT EXISTS css_snippets (
     id          TEXT PRIMARY KEY,
     usuario_id  TEXT NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
     nombre      TEXT NOT NULL,
     activo      INTEGER NOT NULL DEFAULT 1,
     contenido   TEXT NOT NULL DEFAULT '',
     creado_en   TEXT NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS idx_css_snippets_usuario ON css_snippets(usuario_id)`,
];

/** Crea el esquema del índice (idempotente) contra el executor activo. */
export async function crearEsquemaIndice(): Promise<void> {
  for (const sql of ESQUEMA_INDICE) {
    await execute(sql);
  }
  // Migración defensiva: los índices creados en fases anteriores no tienen la
  // columna `papelera.ruta_papelera` (fase 4) y `CREATE TABLE IF NOT EXISTS` no
  // la añade. El ALTER falla si ya existe → se ignora (es idempotente así).
  try {
    await execute("ALTER TABLE papelera ADD COLUMN ruta_papelera TEXT");
  } catch {
    // La columna ya existe: nada que hacer.
  }
}

/**
 * Metadatos de un archivo devueltos por el comando Rust `listar_archivos_meta`.
 * **Sin contenido**: el texto se pide aparte con `leer_archivos`, y solo el de
 * los archivos que hay que reindexar (FUN-M-12).
 */
type ArchivoMeta = {
  rutaRelativa: string;
  mtime: number;
  tipo: string;
};

/**
 * Contenido de un archivo devuelto por el comando Rust `leer_archivos`.
 * OJO: sus campos van en `snake_case` (la struct `ArchivoLeido` de Rust no lleva
 * `rename_all`, a diferencia de `ArchivoMeta`); se respeta para no romper
 * `leer_carpeta`, que comparte la struct.
 */
type ArchivoLeido = { ruta_relativa: string; contenido: string };

/**
 * Cuántas rutas se piden por llamada a `leer_archivos`. Compromiso entre
 * round-trips del puente IPC (menos tandas = menos cruces) y memoria/latencia
 * de cada respuesta (una tanda entera se serializa a JSON de una vez). También
 * es el grano con el que avanza `onProgress`.
 */
const TANDA = 250;

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

/**
 * Deriva una carpeta (por su ruta POSIX) y todos sus ancestros. Para
 * `Proyectos/2026` devuelve `Proyectos` (padre null) y `Proyectos/2026` (padre
 * `Proyectos`). A diferencia de `carpetasDeRuta`, NO descarta el último segmento:
 * la entrada YA es una carpeta (no un archivo), así que la propia carpeta cuenta.
 * Se usa para persistir las carpetas VACÍAS enumeradas por `listar_directorios`.
 */
function carpetasDeDir(dir: string): CarpetaDerivada[] {
  const partes = dir.split("/");
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
export function carpetaDeArchivo(ruta: string): string | null {
  const i = ruta.lastIndexOf("/");
  return i === -1 ? null : ruta.slice(0, i);
}

/** Título = nombre de archivo sin la extensión final. */
export function tituloDeRuta(ruta: string): string {
  const nombre = ruta.slice(ruta.lastIndexOf("/") + 1);
  return nombre.replace(/\.[^.]+$/, "");
}

/**
 * Indexa la carpeta del vault en el índice (executor activo, que debe ser el
 * índice del vault: ver `abrirIndiceDeVault`). Estrategia incremental por
 * `mtime`: solo se reindexa lo nuevo o cambiado; lo que ya no existe en disco se
 * borra del índice. Debe llamarse con el índice del vault ya abierto.
 *
 * Va en DOS FASES (FUN-M-12), porque antes se traía por IPC el contenido de todo
 * el vault en cada apertura para descartar casi todo comparando `mtime`:
 *   (a) `listar_archivos_meta` → solo `(ruta, mtime, tipo)`; con eso se calcula
 *       la lista de rutas a reindexar;
 *   (b) `leer_archivos(rutas)` en tandas de `TANDA`, escribiendo el índice tanda
 *       a tanda (así el progreso avanza y no se acumula todo en memoria).
 * Reabrir un vault sin cambios transfiere 0 bytes de contenido.
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
  // ¿El índice es anterior a las propiedades (FUN-M-04)? Se pregunta ANTES de
  // crear el esquema: si la tabla todavía no existe, ninguna nota tiene sus
  // propiedades indexadas y el `mtime` no cambió, así que el reindexado
  // incremental las saltaría todas. Una vez creada la tabla, esto no vuelve a
  // dispararse: es una reindexación completa y única.
  const tablaPropiedades = await select<{ n: number }>(
    "SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name = 'propiedades'",
  );
  const forzarTodo = (tablaPropiedades[0]?.n ?? 0) === 0;

  await crearEsquemaIndice();

  const { invoke } = await import("@tauri-apps/api/core");
  const archivos = await invoke<ArchivoMeta[]>("listar_archivos_meta", {
    origen: vaultRuta,
  });
  // Directorios reales del vault (incluidos los vacíos): sin esto, una carpeta sin
  // notas desaparecería al reindexar (solo se derivarían carpetas de las rutas de
  // archivos). Ver `listar_directorios` (fase 7, frente 4).
  const directorios = await invoke<string[]>("listar_directorios", {
    origen: vaultRuta,
  });

  // Carpetas únicas: las derivadas de las rutas de archivos MÁS los directorios
  // reales (que cubren además las carpetas vacías). Padres antes que hijos.
  const carpetas = new Map<string, CarpetaDerivada>();
  for (const a of archivos) {
    for (const c of carpetasDeRuta(a.rutaRelativa)) carpetas.set(c.id, c);
  }
  for (const dir of directorios) {
    for (const c of carpetasDeDir(dir)) carpetas.set(c.id, c);
  }

  // Estado actual del índice: mtime por nota y carpetas existentes (para limpieza).
  const notasExistentes = await select<{ id: string; mtime: number }>(
    "SELECT id, mtime FROM notas",
  );
  const mtimePorId = new Map(notasExistentes.map((r) => [r.id, r.mtime]));
  const carpetasExistentes = await select<{ id: string }>("SELECT id FROM carpetas");
  const idsCarpetasExistentes = new Set(carpetasExistentes.map((c) => c.id));

  const now = ahoraIso();

  // 1) Upsert de carpetas NUEVAS, ordenadas por profundidad (padre→hijo).
  // Las que ya están en el índice se saltan (FUN-M-12): el `id` de una carpeta ES
  // su ruta POSIX, y `nombre`/`padre_id` se derivan de esa ruta, así que si el id
  // ya existe sus otras columnas no pueden haber cambiado. Reescribirlas costaba
  // un statement por carpeta en TODA apertura (4020 en un vault sobre este repo).
  const carpetasOrdenadas = [...carpetas.values()]
    .filter((c) => !idsCarpetasExistentes.has(c.id))
    .sort((a, b) => a.id.split("/").length - b.id.split("/").length);
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

  // 2) Fase (a): qué hay que reindexar. Solo se comparan `mtime`s: el contenido
  // todavía no cruzó el puente IPC.
  const porReindexar = archivos.filter((a) => {
    if (forzarTodo) return true;
    const previo = mtimePorId.get(a.rutaRelativa);
    return previo === undefined || previo !== a.mtime;
  });
  const metaPorRuta = new Map(archivos.map((a) => [a.rutaRelativa, a]));

  // El progreso se mide sobre el total de archivos del vault: lo no cambiado ya
  // está "hecho" antes de empezar, para que la barra refleje trabajo real.
  let hechas = archivos.length - porReindexar.length;
  onProgress?.(hechas, archivos.length);

  // 3) Fase (b): pedir el contenido en tandas y escribir el índice tanda a tanda.
  let reindexadas = 0;
  for (let i = 0; i < porReindexar.length; i += TANDA) {
    const rutas = porReindexar.slice(i, i + TANDA).map((a) => a.rutaRelativa);
    const leidos = await invoke<ArchivoLeido[]>("leer_archivos", {
      origen: vaultRuta,
      rutas,
    });

    for (const leido of leidos) {
      const id = leido.ruta_relativa;
      // `leer_archivos` puede devolver menos entradas de las pedidas (archivo
      // borrado entre las dos fases, o no UTF-8): se toma lo que llegó.
      const meta = metaPorRuta.get(id);
      if (!meta) continue;

      const titulo = tituloDeRuta(id);
      const carpetaId = carpetaDeArchivo(id);
      const bytes = byteLen(leido.contenido);

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
        [id, VAULT_ID, carpetaId, titulo, meta.tipo, bytes, meta.mtime, now, now],
      );

      // Contenido: Excalidraw se guarda igual que el markdown (fase 2 no separa
      // diagramas). Upsert como en `contenido.ts`.
      await execute(
        `INSERT INTO contenidos (nota_id, contenido, actualizado_en) VALUES (?, ?, ?)
         ON CONFLICT(nota_id) DO UPDATE SET
           contenido = excluded.contenido,
           actualizado_en = excluded.actualizado_en`,
        [id, leido.contenido, now],
      );

      // Reindex FTS (delete + insert), como `TouchNotaContenidoAsync`/`contenido.ts`.
      // Al índice va el CUERPO + los VALORES de las propiedades, no el YAML crudo.
      await execute("DELETE FROM notas_fts WHERE nota_id = ?", [id]);
      await execute("INSERT INTO notas_fts (nota_id, titulo, contenido) VALUES (?, ?, ?)", [
        id,
        titulo,
        textoIndexable(leido.contenido),
      ]);
      await reindexarPropiedades(id, leido.contenido);

      reindexadas++;
    }

    // El avance es POR TANDA (no por archivo): se cuentan las rutas pedidas, no
    // las devueltas, para que el progreso llegue al total aunque alguna se omita.
    hechas += rutas.length;
    onProgress?.(hechas, archivos.length);
  }

  // 3) Limpieza: borrar del índice lo que ya no existe en disco.
  const rutasActuales = new Set(archivos.map((a) => a.rutaRelativa));
  for (const { id } of notasExistentes) {
    if (rutasActuales.has(id)) continue;
    await execute("DELETE FROM notas_fts WHERE nota_id = ?", [id]);
    await execute("DELETE FROM propiedades WHERE nota_id = ?", [id]);
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
