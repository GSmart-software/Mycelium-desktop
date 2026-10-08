/**
 * Indexador del vault en carpeta: reconstruye el índice derivado (SQLite)
 * releyendo los archivos de la carpeta del vault. El índice NO es la fuente de
 * verdad —lo son los archivos en disco—; es un caché reconstruible para que la
 * búsqueda FTS5, el grafo, las propiedades y las bases se resuelvan en SQL. La
 * única excepción es la tabla `papelera`, que se respalda en
 * `.mycelium/papelera.json` (ver `estadoVault.ts`). Ver
 * `docs/features/vault-en-carpeta.md` y `docs/arquitectura/Capa de datos del desktop.md`.
 *
 * Convenciones del índice:
 *   - `notas.id` = ruta relativa POSIX del archivo (`Proyectos/2026/plan.md`).
 *   - `titulo`   = nombre del archivo sin extensión.
 *   - `tipo`     = `markdown` | `excalidraw` | `base` | `canvas` | `drawio`
 *     según la extensión.
 *   - `carpetas.id` = ruta POSIX de la carpeta; `padre_id` = carpeta padre o NULL.
 *   - `vault_id`  = `LOCAL_VAULT_ID`: cada vault tiene su propio índice, así que
 *     dentro de uno es una constante (la que las rutas `/vaults/:id/...` de
 *     `api()` reciben de `authStore`).
 */
import { claveDeEnlace, clavesDeTitulo, derivarEnlaces, derivarEtiquetas } from "@/lib/enlacesNota";
import { otrosDesdeMeta, type OtroArchivo } from "@/lib/otrosArchivos";
import type { CambioVault } from "@/lib/arbolVivo";
import { execute, getExecutor, select, type SqlExecutor } from "./client";
import { escribirEnlacesTanda, huellaEnlaces, reResolverClaves, type EntradaEnlaces } from "./enlacesIndice";
import { crearFtsFilas, enTandas, ftsBorrar, ftsBorrarHuerfanas, ftsPonerTanda, marcadores, type FilaFts } from "./ftsIndice";
import {
  derivarIndice,
  plegarPropiedadesPendientes,
  reindexarPropiedadesTanda,
  type FilaPropiedad,
} from "./propiedades";
import { ahoraIso, byteLen } from "./util";
import { LOCAL_VAULT_ID } from "./vaultContext";

/** Id del vault en el índice (ver la cabecera). */
const VAULT_ID = LOCAL_VAULT_ID;

/**
 * Esquema del índice. Se crea con estos `CREATE TABLE IF NOT EXISTS` al abrir el
 * vault; NO hay migraciones sqlx (`_sqlx_migrations`) ni ningún otro esquema que
 * espejar. Un cambio de columnas va como `ALTER TABLE` defensivo en
 * `crearEsquemaIndice`, que es lo que hace abrir sin error un índice creado por
 * una versión anterior.
 *
 * - `carpetas` y `notas` no llevan claves foráneas hacia ninguna tabla de vaults
 *   o usuarios: `vault_id` es TEXT plano.
 * - `notas.mtime` es la validación incremental por fecha de modificación, y
 *   `hash_indexable` (`FUN-M-38`) la huella de lo que `notas_fts` y `propiedades`
 *   tienen de la nota, para no reescribirlas en un guardado que no las cambia;
 *   `hash_enlaces` (`FUN-L-25`), lo mismo para `enlaces` y `etiquetas`.
 * - `papelera.ruta_papelera`: dónde quedó el archivo en `.mycelium/.trash` para
 *   poder restaurarlo.
 *
 * > [!info] Tablas que un índice viejo tiene de más
 * > Hasta `FUN-L-24` (2026-09-26) el esquema incluía `usuarios`, `vaults`,
 * > `membresias` y `css_snippets`: la identidad interna heredada de web y la
 * > copia de la apariencia y los snippets. Un índice creado antes las conserva
 * > —`CREATE TABLE IF NOT EXISTS` no borra nada— y nadie las lee, salvo la
 * > migración única de `lib/db/legado.ts`, que saca de ahí la apariencia y los
 * > snippets de quien actualiza desde la 2.1.0. No se hace `DROP TABLE`: ver
 * > esa migración.
 * >
 * > `diagramas` (los dibujos de Excalidraw «embebidos» en una nota) salió del
 * > esquema con `FUN-M-40`: esa sí la borra la migración de `legado.ts`, después
 * > de exportar cada fila a un archivo `.excalidraw` del vault.
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
     hash_indexable TEXT,
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
  `CREATE TABLE IF NOT EXISTS papelera (
     id                  TEXT PRIMARY KEY,
     nota_id             TEXT NOT NULL UNIQUE REFERENCES notas(id) ON DELETE CASCADE,
     ruta_original       TEXT NOT NULL,
     carpeta_original_id TEXT,
     eliminado_en        TEXT NOT NULL,
     ruta_papelera       TEXT
   )`,
  // `contenido` es el texto LEGIBLE de la nota y `extra` lo que se busca sin
  // mostrarse —valores de propiedades, destinos de enlaces con alias—; el
  // fragmento de un resultado sale de `contenido` (`DEF-148`, ver
  // `derivarIndice`). Un índice anterior, con solo `contenido` y el texto
  // crudo, se rehace en `migrarFtsLegible`.
  `CREATE VIRTUAL TABLE IF NOT EXISTS notas_fts USING fts5(
     nota_id UNINDEXED,
     titulo,
     contenido,
     extra
   )`,
  // Propiedades del frontmatter YAML (FUN-M-04). Una fila POR ELEMENTO de lista
  // (`orden` = posición; 0 si es escalar), para poder filtrar con `=` en vez de
  // `LIKE`. Se deriva del contenido igual que `notas_fts`.
  //
  // `clave_plegada` y `valor_plegado` (`DEF-144`): lo mismo sin tildes ni
  // mayúsculas (`plegar`, en JS: el `lower()` y el `NOCASE` de SQLite solo
  // entienden ASCII). Es por donde filtra la búsqueda `clave:valor`, para que
  // compare como el texto. Un índice anterior las recibe por `ALTER TABLE` en
  // `crearEsquemaIndice`, que además las llena.
  `CREATE TABLE IF NOT EXISTS propiedades (
     nota_id       TEXT NOT NULL REFERENCES notas(id) ON DELETE CASCADE,
     clave         TEXT NOT NULL,
     valor         TEXT NOT NULL,
     tipo          TEXT NOT NULL,
     orden         INTEGER NOT NULL,
     clave_plegada TEXT,
     valor_plegado TEXT
   )`,
  `CREATE INDEX IF NOT EXISTS idx_propiedades_nota  ON propiedades(nota_id)`,
  `CREATE INDEX IF NOT EXISTS idx_propiedades_clave ON propiedades(clave, valor)`,
  // Enlaces y etiquetas de cada nota (`FUN-L-25`, `DEF-109`): lo que el grafo,
  // las conexiones y la barra de estado escaneaban del texto en CADA consulta
  // —el contenido del vault entero, 300 ms en la Tesina— se deriva una vez, al
  // indexar o al guardar (`lib/enlacesNota.ts`), y se lee de acá.
  //
  // - `destino_texto`: lo escrito en el `[[…]]`, sin alias y con el ancla si
  //   la tenía (o la ruta de una tarjeta de nota de un canvas, `tipo =
  //   'archivo'`). Resuelve entero y, si no, sin el ancla (`lib/enlacesNota.ts`).
  // - `clave`: su último segmento en minúsculas, calculado en JS: es por donde
  //   se re-resuelve cuando aparece o se va una nota con ese título. No es
  //   `lower(destino_texto)`: el `lower()` de SQLite solo entiende ASCII.
  //   `clave_ancla`: lo mismo sin el `#ancla`; NULL si no tiene.
  // - `destino_id`: la nota a la que resuelve, NULL si no resuelve (roto). Sin
  //   clave foránea a propósito: un enlace roto o a una nota borrada es un dato
  //   (es la lista de enlaces sin resolver), no una fila a borrar.
  // - `tipo`: `enlace` | `embed` | `canvas` | `archivo`; `n`: cuántas veces.
  `CREATE TABLE IF NOT EXISTS enlaces (
     desde_id      TEXT NOT NULL REFERENCES notas(id) ON DELETE CASCADE,
     destino_texto TEXT NOT NULL,
     clave         TEXT NOT NULL,
     clave_ancla   TEXT,
     destino_id    TEXT,
     tipo          TEXT NOT NULL,
     n             INTEGER NOT NULL DEFAULT 1
   )`,
  `CREATE INDEX IF NOT EXISTS idx_enlaces_desde   ON enlaces(desde_id)`,
  `CREATE INDEX IF NOT EXISTS idx_enlaces_destino ON enlaces(destino_id)`,
  `CREATE INDEX IF NOT EXISTS idx_enlaces_clave   ON enlaces(clave)`,
  `CREATE INDEX IF NOT EXISTS idx_enlaces_ancla   ON enlaces(clave_ancla)`,
  `CREATE TABLE IF NOT EXISTS etiquetas (
     nota_id TEXT NOT NULL REFERENCES notas(id) ON DELETE CASCADE,
     tag     TEXT NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS idx_etiquetas_nota ON etiquetas(nota_id)`,
];

/**
 * Versión del contenido DERIVADO del índice, en `PRAGMA user_version`. Cuando
 * una versión nueva de Mycelium deriva algo que un índice anterior no tiene
 * —una tabla que se llena leyendo los archivos—, sube este número, y el
 * indexador hace UNA pasada completa sobre un índice con un número menor.
 *
 * - `1` (`FUN-L-25`): las tablas `enlaces` y `etiquetas`.
 *
 * > [!warning] No sirve preguntar si la tabla existe
 * > Es lo que se hizo con `propiedades` (`FUN-M-04`), y dejó de funcionar sin
 * > que nadie lo notara: la apertura del vault llama a `crearEsquemaIndice`
 * > ANTES que a `indexarVault`, así que cuando el indexador pregunta, la tabla
 * > ya existe —vacía—. Y aunque el orden fuera el bueno, cerrar la app a mitad
 * > de la pasada dejaría la tabla creada y a medio llenar para siempre. El
 * > número se escribe solo al terminar una pasada completa.
 */
const VERSION_DERIVADO = 1;

/**
 * El executor (el índice abierto) sobre el que ya se creó el esquema en esta
 * sesión (`FUN-M-14`). El indexado lo creaba en CADA pasada —unas 25 sentencias
 * `CREATE … IF NOT EXISTS` y `ALTER` que no hacían nada, cada una un viaje por
 * el puente IPC— aunque la apertura del vault ya lo había creado. Se compara la
 * identidad del executor y no la ruta del vault: abrir otro vault (o el mismo
 * otra vez) crea uno nuevo, y con él el esquema se vuelve a asegurar.
 */
let esquemaCreadoEn: SqlExecutor | null = null;

/** Crea el esquema si en este índice todavía no se creó en esta sesión. */
async function asegurarEsquema(): Promise<void> {
  if (esquemaCreadoEn !== (await getExecutor())) await crearEsquemaIndice();
}

/** Crea el esquema del índice (idempotente) contra el executor activo. */
export async function crearEsquemaIndice(): Promise<void> {
  const executor = await getExecutor();
  await migrarFtsLegible();
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
  // Ídem `notas.hash_indexable` (`FUN-M-38`): en un índice anterior queda NULL
  // y cada nota se reindexa una vez más al guardarla, que es lo que hacía antes.
  try {
    await execute("ALTER TABLE notas ADD COLUMN hash_indexable TEXT");
  } catch {
    // La columna ya existe: nada que hacer.
  }
  // Ídem `notas.hash_enlaces` (`FUN-L-25`): la huella de sus filas de `enlaces`
  // y `etiquetas`, para no reescribirlas en un guardado que no las cambia.
  try {
    await execute("ALTER TABLE notas ADD COLUMN hash_enlaces TEXT");
  } catch {
    // La columna ya existe: nada que hacer.
  }
  // Ídem `propiedades.clave_plegada` y `valor_plegado` (`DEF-144`). El índice
  // por esas columnas va después del ALTER (no en `ESQUEMA_INDICE`): en un
  // índice anterior todavía no existen cuando corre la lista. Y las filas que ya
  // había se pliegan acá, sin releer archivos.
  try {
    await execute("ALTER TABLE propiedades ADD COLUMN clave_plegada TEXT");
  } catch {
    // La columna ya existe: nada que hacer.
  }
  try {
    await execute("ALTER TABLE propiedades ADD COLUMN valor_plegado TEXT");
  } catch {
    // La columna ya existe: nada que hacer.
  }
  await execute(
    "CREATE INDEX IF NOT EXISTS idx_propiedades_plegado ON propiedades(clave_plegada, valor_plegado)",
  );
  await plegarPropiedadesPendientes();
  // Qué `rowid` de `notas_fts` le toca a cada nota (`DEF-105`): sin esto, borrar
  // o actualizar una fila de búsqueda recorre la tabla entera. En un índice
  // anterior la llena a partir de lo que ya hay, una sola vez.
  await crearFtsFilas();
  esquemaCreadoEn = executor;
}

/**
 * Rehace la tabla de búsqueda de un índice anterior a `DEF-148`.
 *
 * Hasta entonces `notas_fts` tenía solo `titulo` y `contenido`, y en
 * `contenido` iba el texto crudo de la nota —con los valores de las propiedades
 * pegados delante—: de ahí salían fragmentos con el frontmatter aplastado, los
 * `[[enlaces]]` tal cual y el JSON de un canvas. Una tabla virtual FTS5 no
 * admite `ALTER TABLE … ADD COLUMN`, así que se BORRA (junto con `fts_filas`,
 * que apunta a sus filas) y `ESQUEMA_INDICE` la crea con la columna `extra`.
 *
 * No hace falta releer nada acá: sin fila de búsqueda, cada nota queda
 * INCOMPLETA para `estadoDeNotas` (`DEF-121`), y el indexado que sigue a abrir
 * el vault la relee y la indexa con el texto nuevo —una sola vez, como una
 * primera apertura—. Hasta que termina, la búsqueda no encuentra las notas que
 * todavía no pasó. Las huellas se anulan para que un guardado en ese hueco
 * tampoco se saltee la fila (`putContenido` ya la escribe si falta, pero así no
 * depende de eso).
 *
 * Detecta el índice viejo por las columnas de la tabla: en uno nuevo o ya
 * migrado no hace nada.
 */
async function migrarFtsLegible(): Promise<void> {
  const columnas = await select<{ name: string }>("SELECT name FROM pragma_table_info('notas_fts')");
  if (columnas.length === 0 || columnas.some((c) => c.name === "extra")) return;
  await execute("DROP TABLE IF EXISTS fts_filas");
  await execute("DROP TABLE notas_fts");
  try {
    await execute("UPDATE notas SET hash_indexable = NULL");
  } catch {
    // Un índice anterior a `FUN-M-38` no tiene la columna: no hay huella que anular.
  }
}

/**
 * Metadatos de un archivo devueltos por el comando Rust `recorrer_vault`.
 * **Sin contenido**: el texto se pide aparte con `leer_archivos`, y solo el de
 * los archivos que hay que reindexar (FUN-M-12).
 */
type ArchivoMeta = {
  rutaRelativa: string;
  mtime: number;
  tipo: string;
};

/**
 * Lo que devuelve `recorrer_vault` (`FUN-M-13`, `FUN-M-38`): las tres listas
 * que antes pedían tres comandos con tres recorridos del disco. `otros` no es
 * del índice —son los archivos que Mycelium no indexa— pero sale de la misma
 * pasada, y el explorador lo toma de acá en vez de recorrer el vault otra vez.
 */
type RecorridoVault = {
  archivosMeta: ArchivoMeta[];
  otros: { rutaRelativa: string; tipo: string }[];
  directorios: string[];
};

/**
 * Contenido de un archivo devuelto por el comando Rust `leer_archivos`.
 * OJO: sus campos van en `snake_case`: la struct `ArchivoLeido` de Rust no lleva
 * `rename_all`, a diferencia de `ArchivoMeta` (la compartía con el walker de la
 * importación, que la leía así; desde `FUN-M-40` importar es `copiar_arbol`).
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
  const dir = carpetaDeArchivo(ruta);
  return dir === null ? [] : carpetasDeDir(dir);
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
 * Es el indexado COMPLETO: recorre el vault entero. Lo usan la apertura, la
 * importación, «Reindexar» de los ajustes y la reconciliación (`FUN-M-42`). Un
 * cambio que avisa el watcher va por `indexarRutas`, que mira solo esas rutas.
 *
 * Va en DOS FASES (FUN-M-12), porque antes se traía por IPC el contenido de todo
 * el vault en cada apertura para descartar casi todo comparando `mtime`:
 *   (a) `recorrer_vault` → solo `(ruta, mtime, tipo)` de cada nota (más los
 *       directorios y los otros archivos, de la misma pasada); con eso se
 *       calcula la lista de rutas a reindexar;
 *   (b) `leer_archivos(rutas)` en tandas de `TANDA`, escribiendo el índice tanda
 *       a tanda (así el progreso avanza y no se acumula todo en memoria).
 * Reabrir un vault sin cambios transfiere 0 bytes de contenido.
 *
 * Y cada tanda se escribe con **una sentencia por tabla** (`FUN-M-38`, hallazgo
 * H1 de la auditoría): ver `escribirNotas`.
 *
 * Un `.excalidraw` se indexa como cualquier nota: su escena va a `contenidos`.
 *
 * @param recorrido el de `recorrer_vault`, si quien llama ya lo tiene (la
 *        reconciliación lo pidió para comparar el árbol): así el disco se
 *        recorre una sola vez.
 * @returns totales: `notas` en disco, `carpetas` derivadas, `reindexadas`
 *          (notas nuevas o modificadas que se reescribieron en el índice),
 *          `otros`, los archivos no indexados que vio el recorrido (para el
 *          explorador: `vaultStore.otros`), y `rutas`, las notas que cambiaron
 *          en el índice —reescritas o borradas—, para avisar a las pestañas.
 */
export async function indexarVault(
  vaultRuta: string,
  onProgress?: (hechas: number, total: number) => void,
  recorrido?: RecorridoVault,
): Promise<{ notas: number; carpetas: number; reindexadas: number; otros: OtroArchivo[]; rutas: string[] }> {
  // ¿El índice es anterior a las propiedades (FUN-M-04)? Se pregunta ANTES de
  // crear el esquema: si la tabla todavía no existe, ninguna nota tiene sus
  // propiedades indexadas y el `mtime` no cambió, así que el reindexado
  // incremental las saltaría todas. Una vez creada la tabla, esto no vuelve a
  // dispararse: es una reindexación completa y única.
  const tablaPropiedades = await select<{ n: number }>(
    "SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name = 'propiedades'",
  );
  // Y lo derivado que un índice anterior no tiene (`VERSION_DERIVADO`): hoy, los
  // enlaces y las etiquetas (`FUN-L-25`). Ver la advertencia de esa constante.
  const [version] = await select<{ user_version: number }>("PRAGMA user_version");
  const forzarTodo =
    (tablaPropiedades[0]?.n ?? 0) === 0 || Number(version?.user_version ?? 0) < VERSION_DERIVADO;

  // Una vez por sesión, no en cada pasada (`FUN-M-14`): la apertura del vault
  // ya lo creó, y el watcher indexa cada pocos segundos mientras algo escribe.
  await asegurarEsquema();

  // Un solo recorrido del disco (`FUN-M-13`): las notas con sus metadatos, los
  // directorios reales —incluidos los vacíos: sin ellos, una carpeta sin notas
  // desaparecería al reindexar, porque solo se derivarían carpetas de las rutas
  // de archivos— y los archivos que no se indexan, que van al explorador.
  if (!recorrido) {
    const { invoke } = await import("@tauri-apps/api/core");
    recorrido = await invoke<RecorridoVault>("recorrer_vault", { origen: vaultRuta });
  }
  const archivos = recorrido.archivosMeta;
  const directorios = recorrido.directorios;
  const otros = otrosDesdeMeta(recorrido.otros);

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
  //
  // Y qué notas están INCOMPLETAS (`DEF-121`): ver `estadoDeNotas`.
  const notasExistentes = await estadoDeNotas(null);
  const mtimePorId = new Map(notasExistentes.map((r) => [r.id, r.mtime]));
  // Solo cuentan las que siguen en disco: las demás no se releen (se van en la
  // limpieza, o están en la papelera), y contarlas repetiría la limpieza de
  // abajo en cada indexado.
  const enDisco = new Set(archivos.map((a) => a.rutaRelativa));
  const incompletas = new Set(
    notasExistentes.filter((r) => Number(r.incompleta) === 1 && enDisco.has(r.id)).map((r) => r.id),
  );
  // Antes de reescribirlas, las filas de búsqueda que nadie reclama: si no, la
  // de una nota sin anotar en `fts_filas` quedaría duplicada (`ftsBorrarHuerfanas`).
  if (incompletas.size > 0) await ftsBorrarHuerfanas();
  const carpetasExistentes = await select<{ id: string }>("SELECT id FROM carpetas");
  const idsCarpetasExistentes = new Set(carpetasExistentes.map((c) => c.id));

  const now = ahoraIso();

  // 1) Upsert de carpetas NUEVAS, ordenadas por profundidad (padre→hijo).
  await insertarCarpetas(
    [...carpetas.values()].filter((c) => !idsCarpetasExistentes.has(c.id)),
    now,
  );

  // 2) Fase (a): qué hay que reindexar. Solo se comparan `mtime`s: el contenido
  // todavía no cruzó el puente IPC.
  const porReindexar = archivos.filter((a) => {
    if (forzarTodo || incompletas.has(a.rutaRelativa)) return true;
    const previo = mtimePorId.get(a.rutaRelativa);
    return previo === undefined || previo !== a.mtime;
  });

  // El progreso se mide sobre el total de archivos del vault: lo no cambiado ya
  // está "hecho" antes de empezar, para que la barra refleje trabajo real.
  let hechas = archivos.length - porReindexar.length;
  onProgress?.(hechas, archivos.length);

  // Claves de `enlaces` que hay que (re)resolver al final (`FUN-L-25`): las de
  // las filas que se escriben en esta pasada —entran con `destino_id` NULL, porque
  // una nota de la primera tanda puede enlazar a una que todavía no se leyó— y
  // los títulos de las notas que aparecen o desaparecen, que pueden arreglar o
  // romper enlaces de notas que no cambiaron.
  const clavesPorResolver = new Set<string>();

  // 3) Fase (b): pedir el contenido en tandas y escribir el índice tanda a tanda.
  const reescritas = await escribirNotas(
    vaultRuta,
    porReindexar,
    (id) => !mtimePorId.has(id),
    clavesPorResolver,
    now,
    (pedidas) => {
      // El avance es POR TANDA (no por archivo): se cuentan las rutas pedidas, no
      // las devueltas, para que el progreso llegue al total aunque alguna se omita.
      hechas += pedidas;
      onProgress?.(hechas, archivos.length);
    },
  );

  // 4) Limpieza: borrar del índice lo que ya no existe en disco.
  //
  // OJO con la papelera (DEF-046): una nota enviada a la papelera TAMPOCO está en su
  // ruta —se movió a `.mycelium/.trash`, que `.mycignore` ignora siempre—, así que
  // caía en esta limpieza y se borraba su fila de `papelera` a los segundos. Como
  // mover el archivo dispara el watcher, el ciclo era: borrar → reindexar → la
  // entrada desaparece de la papelera. El archivo seguía en disco pero Mycelium ya no
  // sabía que existía, así que no había forma de recuperarlo desde la app.
  //
  // Su ausencia de la ruta original es INTENCIONAL: no es un archivo desaparecido.
  const enPapelera = new Set(
    (await select<{ nota_id: string }>("SELECT nota_id FROM papelera")).map((r) => r.nota_id),
  );
  const desaparecidas = notasExistentes
    .map((n) => n.id)
    .filter((id) => !enDisco.has(id) && !enPapelera.has(id));
  await borrarNotas(desaparecidas, clavesPorResolver);
  const carpetasIdas = carpetasExistentes.map((c) => c.id).filter((id) => !carpetas.has(id));
  await borrarCarpetas(carpetasIdas);

  // 5) Resolver los enlaces (`FUN-L-25`): con todas las notas ya en el índice.
  // En una pasada completa se resuelve todo; si no, solo lo que pudo cambiar.
  await reResolverClaves(forzarTodo ? null : clavesPorResolver);
  // La pasada terminó entera: lo derivado ya está al día con esta versión.
  if (forzarTodo) await execute(`PRAGMA user_version = ${VERSION_DERIVADO}`);

  if (desaparecidas.length > 0 || carpetasIdas.length > 0) await compactarSiHaceFalta();

  return {
    notas: archivos.length,
    carpetas: carpetas.size,
    reindexadas: reescritas.length,
    otros,
    rutas: [...reescritas, ...desaparecidas],
  };
}

/**
 * Indexado **dirigido** (`FUN-M-14`, `FUN-M-42`): pone el índice al día solo con
 * las rutas que avisó el watcher, en vez de recorrer el vault entero.
 *
 * Antes, cada cambio externo —una nota guardada por otro editor, una imagen
 * agregada— pagaba un `recorrer_vault` completo (170 KB de JSON en un vault de
 * 2.000 notas), la lectura del estado de TODAS las notas del índice, la de
 * todas las carpetas y la de la papelera. Ahora cuesta lo que cambió.
 *
 * Lo que hace con cada ruta según lo que hay en ella AHORA (`CambioVault`):
 *   - `nota`: se relee si es nueva, si su `mtime` no coincide o si está
 *     incompleta (`DEF-121`), igual que el completo; y se aseguran sus carpetas.
 *   - `otro` / `carpeta`: no se indexan, pero se aseguran sus carpetas; y si el
 *     índice tenía una nota en esa ruta exacta, se va.
 *   - `ausente`: se borra la nota de esa ruta y todo lo que cuelgue de ella
 *     —el watcher no dice si lo que se fue era una carpeta— salvo lo que está en
 *     la papelera (`DEF-046`: su archivo se movió a `.mycelium/.trash`).
 *
 * La misma escritura por tandas (`escribirNotas`) que el completo, con el
 * `mtime` al final (`DEF-121`), y la misma resolución de enlaces por claves.
 *
 * @returns `reindexadas` y `rutas`: las notas que cambiaron en el índice
 *          (reescritas o borradas), para avisar a las pestañas abiertas.
 */
export async function indexarRutas(
  vaultRuta: string,
  cambios: readonly CambioVault[],
): Promise<{ reindexadas: number; rutas: string[] }> {
  await asegurarEsquema();
  // Una ruta, un estado: el último que llegó.
  const porRuta = new Map<string, CambioVault>();
  for (const c of cambios) if (c.ruta !== "") porRuta.set(c.ruta, c);
  const ultimos = [...porRuta.values()];

  const notas: ArchivoMeta[] = ultimos
    .filter((c) => c.estado === "nota")
    .map((c) => ({ rutaRelativa: c.ruta, mtime: c.mtime, tipo: c.tipo }));
  const noNotas = ultimos.filter((c) => c.estado !== "nota").map((c) => c.ruta);
  const ausentes = ultimos.filter((c) => c.estado === "ausente").map((c) => c.ruta);

  const now = ahoraIso();
  const clavesPorResolver = new Set<string>();

  // 1) Carpetas: las de lo que existe (y sus ancestros), solo las que faltan.
  const carpetas = new Map<string, CarpetaDerivada>();
  for (const c of ultimos) {
    if (c.estado === "carpeta") for (const d of carpetasDeDir(c.ruta)) carpetas.set(d.id, d);
    else if (c.estado !== "ausente") for (const d of carpetasDeRuta(c.ruta)) carpetas.set(d.id, d);
  }
  if (carpetas.size > 0) {
    const ya = new Set<string>();
    for (const tanda of enTandas([...carpetas.keys()])) {
      const filas = await select<{ id: string }>(
        `SELECT id FROM carpetas WHERE id IN (${marcadores(tanda.length)})`,
        tanda,
      );
      for (const f of filas) ya.add(f.id);
    }
    await insertarCarpetas(
      [...carpetas.values()].filter((c) => !ya.has(c.id)),
      now,
    );
  }

  // 2) Notas: qué hay que releer, mirando solo estas en el índice.
  let reescritas: string[] = [];
  if (notas.length > 0) {
    const estado = await estadoDeNotas(notas.map((n) => n.rutaRelativa));
    const porId = new Map(estado.map((r) => [r.id, r]));
    const incompletas = estado.filter((r) => Number(r.incompleta) === 1);
    if (incompletas.length > 0) await ftsBorrarHuerfanas();
    const porReindexar = notas.filter((a) => {
      const previo = porId.get(a.rutaRelativa);
      return previo === undefined || Number(previo.incompleta) === 1 || previo.mtime !== a.mtime;
    });
    reescritas = await escribirNotas(vaultRuta, porReindexar, (id) => !porId.has(id), clavesPorResolver, now);
  }

  // De lo que se fue, qué era una carpeta: solo bajo esas hay que buscar
  // contenido. Toda nota tiene sus carpetas en el índice (se derivan de su
  // ruta), así que bajo una ruta que no es carpeta no cuelga nada; y borrar mil
  // archivos sueltos no hace mil búsquedas por prefijo.
  const carpetasAusentes: string[] = [];
  for (const tanda of enTandas(ausentes)) {
    const filas = await select<{ id: string }>(
      `SELECT id FROM carpetas WHERE id IN (${marcadores(tanda.length)})`,
      tanda,
    );
    for (const f of filas) carpetasAusentes.push(f.id);
  }

  // 3) Lo que ya no es una nota: la de esa ruta exacta y, si se fue una
  // carpeta, todo lo que colgaba de ella. Sin lo que está en la papelera.
  let borradas: string[] = [];
  if (noNotas.length > 0) {
    const ids = new Set<string>();
    for (const tanda of enTandas(noNotas)) {
      const filas = await select<{ id: string }>(
        `SELECT id FROM notas WHERE id IN (${marcadores(tanda.length)})
           AND id NOT IN (SELECT nota_id FROM papelera)`,
        tanda,
      );
      for (const f of filas) ids.add(f.id);
    }
    for (const tanda of enTandas(carpetasAusentes)) {
      // `substr` y no `LIKE`: una ruta puede tener `%` o `_`.
      const filas = await select<{ id: string }>(
        `SELECT n.id FROM notas n, json_each(?) j
         WHERE substr(n.id, 1, length(j.value) + 1) = j.value || '/'
           AND n.id NOT IN (SELECT nota_id FROM papelera)`,
        [JSON.stringify(tanda)],
      );
      for (const f of filas) ids.add(f.id);
    }
    borradas = [...ids];
    await borrarNotas(borradas, clavesPorResolver);
  }

  // 4) Carpetas que se fueron, con todo su subárbol.
  let carpetasIdas: string[] = [];
  if (carpetasAusentes.length > 0) {
    const ids = new Set<string>();
    for (const tanda of enTandas(carpetasAusentes)) {
      const filas = await select<{ id: string }>(
        `SELECT c.id FROM carpetas c, json_each(?) j
         WHERE c.id = j.value OR substr(c.id, 1, length(j.value) + 1) = j.value || '/'`,
        [JSON.stringify(tanda)],
      );
      for (const f of filas) ids.add(f.id);
    }
    carpetasIdas = [...ids];
    await borrarCarpetas(carpetasIdas);
  }

  // 5) Los enlaces que pudieron arreglarse o romperse.
  if (clavesPorResolver.size > 0) await reResolverClaves(clavesPorResolver);
  if (borradas.length > 0 || carpetasIdas.length > 0) await compactarSiHaceFalta();

  return { reindexadas: reescritas.length, rutas: [...reescritas, ...borradas] };
}

/**
 * Indexa una nota que el explorador ya muestra pero el índice todavía no tiene
 * (`FUN-M-42`): el árbol se actualiza con el evento del watcher, y el indexado
 * va unos cientos de milisegundos detrás. Si el usuario la abre en ese hueco, el
 * contenido se pediría a un índice que no la conoce. Devuelve si quedó indexada.
 *
 * Sin el `mtime` real (no hace falta otro viaje para pedirlo): entra con 0, y el
 * indexado del watcher, que sí lo trae, la relee una vez más.
 */
export async function indexarNotaADemanda(vaultRuta: string, id: string, tipo: string): Promise<boolean> {
  const r = await indexarRutas(vaultRuta, [{ ruta: id, mtime: 0, estado: "nota", tipo }]);
  return r.reindexadas > 0;
}

/**
 * Estado de las notas en el índice: su `mtime` y si están INCOMPLETAS
 * (`DEF-121`), sin su fila de `contenidos` o sin la de búsqueda. Un índice
 * dañado por una tanda que se cortó antes del arreglo tiene la nota con el
 * `mtime` al día, así que comparar `mtime`s la salteaba para siempre —y la app
 * la abría vacía—. Se releen aunque el `mtime` coincida: es la reparación de
 * esos índices.
 *
 * La fila de búsqueda se mira en `notas_fts_docsize`, la tabla sombra en la
 * que FTS5 anota una fila por documento con su mismo `id`, y no en `notas_fts`:
 * unir contra la tabla virtual hace que FTS5 lea cada documento, y en un índice
 * de 1.366 notas eran 1,9 s en CADA indexado; contra la sombra, 13 ms. Existe
 * siempre: `notas_fts` se crea sin `columnsize=0` (ver `ESQUEMA_INDICE`).
 *
 * @param ids las notas a mirar, o `null` para todas (el indexado completo).
 */
async function estadoDeNotas(
  ids: string[] | null,
): Promise<{ id: string; mtime: number; incompleta: number }[]> {
  const sql = `SELECT n.id, n.mtime,
            (c.nota_id IS NULL OR d.id IS NULL) AS incompleta
     FROM notas n
     LEFT JOIN contenidos c ON c.nota_id = n.id
     LEFT JOIN fts_filas f ON f.nota_id = n.id
     LEFT JOIN notas_fts_docsize d ON d.id = f.fila`;
  if (ids === null) return select(sql);
  const out: { id: string; mtime: number; incompleta: number }[] = [];
  for (const tanda of enTandas(ids)) {
    out.push(...(await select<{ id: string; mtime: number; incompleta: number }>(
      `${sql} WHERE n.id IN (${marcadores(tanda.length)})`,
      tanda,
    )));
  }
  return out;
}

/**
 * Inserta carpetas nuevas, ordenadas por profundidad (padre→hijo).
 *
 * Las que ya están en el índice las filtra quien llama (FUN-M-12): el `id` de
 * una carpeta ES su ruta POSIX, y `nombre`/`padre_id` se derivan de esa ruta,
 * así que si el id ya existe sus otras columnas no pueden haber cambiado.
 * Reescribirlas costaba un statement por carpeta en TODA apertura (4020 en un
 * vault sobre este repo). Y en tandas de una sentencia (`FUN-M-38`): en frío, un
 * vault con 445 carpetas eran 445 viajes por el puente IPC antes de leer la
 * primera nota.
 */
async function insertarCarpetas(nuevas: CarpetaDerivada[], now: string): Promise<void> {
  const ordenadas = [...nuevas].sort((a, b) => a.id.split("/").length - b.id.split("/").length);
  for (const tanda of enTandas(ordenadas)) {
    await execute(
      `INSERT INTO carpetas (id, vault_id, padre_id, nombre, creado_en, actualizado_en)
       SELECT json_extract(value, '$.id'), ?, json_extract(value, '$.padre_id'),
              json_extract(value, '$.nombre'), ?, ?
       FROM json_each(?) WHERE true
       ON CONFLICT(id) DO UPDATE SET
         padre_id = excluded.padre_id,
         nombre = excluded.nombre,
         actualizado_en = excluded.actualizado_en`,
      [VAULT_ID, now, now, JSON.stringify(tanda)],
    );
  }
}

/**
 * Lee del disco y escribe en el índice las notas `porReindexar`, en tandas de
 * `TANDA`. Devuelve las que se escribieron (`leer_archivos` puede devolver menos
 * de las pedidas: un archivo borrado entre medio, o que no es UTF-8).
 *
 * Cada tanda se escribe con **una sentencia por tabla** (`FUN-M-38`, hallazgo
 * H1 de la auditoría): la tanda entera viaja como un parámetro JSON que SQLite
 * despliega con `json_each`. Antes eran 5 sentencias por nota más una por
 * propiedad —13.496 viajes por el puente IPC en un vault de 1.300 notas, a
 * 4–5 ms cada uno—; ahora son unas pocas por tanda de 250. No se usa
 * `BEGIN`/`COMMIT`: el pool de conexiones de `tauri-plugin-sql` no garantiza que
 * caigan en la misma conexión, así que cada sentencia tiene que ser correcta por
 * sí sola. Y por lo mismo la tanda puede cortarse a la mitad: el `mtime` de cada
 * nota se escribe en la ÚLTIMA sentencia, para que una tanda cortada se relea
 * entera en el próximo indexado (`DEF-121`).
 *
 * @param esNueva si la nota no estaba en el índice: su título puede arreglar
 *        enlaces rotos de otras, así que sus claves se re-resuelven.
 * @param claves donde se acumulan las claves de enlace a re-resolver.
 * @param onTanda avance: cuántas rutas se pidieron en la tanda que terminó.
 */
async function escribirNotas(
  vaultRuta: string,
  porReindexar: ArchivoMeta[],
  esNueva: (id: string) => boolean,
  claves: Set<string>,
  now: string,
  onTanda?: (pedidas: number) => void,
): Promise<string[]> {
  if (porReindexar.length === 0) return [];
  const { invoke } = await import("@tauri-apps/api/core");
  const metaPorRuta = new Map(porReindexar.map((a) => [a.rutaRelativa, a]));
  const reescritas: string[] = [];
  for (let i = 0; i < porReindexar.length; i += TANDA) {
    const rutas = porReindexar.slice(i, i + TANDA).map((a) => a.rutaRelativa);
    const leidos = await invoke<ArchivoLeido[]>("leer_archivos", {
      origen: vaultRuta,
      rutas,
    });

    // Las filas de la tanda, por tabla. Se arman en memoria y se escriben con
    // una sentencia cada una: el JSON de la tanda es el único parámetro.
    const filasNotas: {
      id: string;
      carpetaId: string | null;
      titulo: string;
      tipo: string;
      bytes: number;
      mtime: number;
      huella: string;
      huellaEnlaces: string;
    }[] = [];
    const filasContenidos: { id: string; contenido: string }[] = [];
    const filasFts: FilaFts[] = [];
    const entradasPropiedades: { id: string; propiedades: FilaPropiedad[] }[] = [];
    const entradasEnlaces: EntradaEnlaces[] = [];

    for (const leido of leidos) {
      const id = leido.ruta_relativa;
      // `leer_archivos` puede devolver menos entradas de las pedidas (archivo
      // borrado entre las dos fases, o no UTF-8): se toma lo que llegó.
      const meta = metaPorRuta.get(id);
      if (!meta) continue;

      const titulo = tituloDeRuta(id);
      // Al índice de búsqueda va el CUERPO legible + los VALORES de las
      // propiedades, no el YAML ni la sintaxis cruda (`DEF-148`); la huella es lo
      // que `putContenido` compara al guardar.
      const { contenido: buscable, extra, propiedades, huella } = derivarIndice(leido.contenido, meta.tipo);
      // Los enlaces y las etiquetas (`FUN-L-25`): lo que el grafo antes sacaba
      // del texto en cada consulta. Entran sin resolver: ver abajo.
      const enlaces = derivarEnlaces(leido.contenido, meta.tipo);
      const etiquetas = derivarEtiquetas(leido.contenido, meta.tipo);
      for (const e of enlaces) claves.add(claveDeEnlace(e.texto));
      if (esNueva(id)) for (const c of clavesDeTitulo(titulo)) claves.add(c);
      filasNotas.push({
        id,
        carpetaId: carpetaDeArchivo(id),
        titulo,
        tipo: meta.tipo,
        bytes: byteLen(leido.contenido),
        mtime: meta.mtime,
        huella,
        huellaEnlaces: huellaEnlaces(enlaces, etiquetas),
      });
      // Contenido: Excalidraw se guarda igual que el markdown. Upsert como en
      // `contenido.ts`.
      filasContenidos.push({ id, contenido: leido.contenido });
      filasFts.push({ id, titulo, contenido: buscable, extra });
      entradasPropiedades.push({ id, propiedades });
      entradasEnlaces.push({ id, enlaces, etiquetas });
      reescritas.push(id);
    }

    if (filasNotas.length > 0) {
      // > [!warning] El `mtime` va AL FINAL de la tanda (`DEF-121`)
      // > El `mtime` de `notas` es la marca de «esta nota ya está indexada»: el
      // > próximo indexado solo relee las que no coinciden. Antes iba en esta
      // > primera sentencia, junto con las huellas, y las demás —`contenidos`,
      // > búsqueda, propiedades, enlaces— después, sueltas y sin transacción
      // > (ver arriba). Si algo cortaba la tanda en el medio —una sentencia que
      // > falla con el índice ocupado, la ventana que se recarga—, la nota
      // > quedaba con el `mtime` al día y SIN contenido, y nadie la volvía a
      // > leer: la app la abría vacía, y guardar pisaba el disco. Ahora la fila
      // > de `notas` entra primero —las demás tablas la referencian— con `mtime`
      // > 0 si es nueva, o con el que tenía si ya estaba, y el `mtime` real y las
      // > huellas se escriben en la ÚLTIMA sentencia: un corte en cualquier
      // > punto deja el `mtime` desfasado, y el próximo indexado la relee entera.
      await execute(
        `INSERT INTO notas (id, vault_id, carpeta_id, titulo, tipo, tamano_bytes, mtime, creado_en, actualizado_en)
         SELECT json_extract(value, '$.id'), ?, json_extract(value, '$.carpetaId'),
                json_extract(value, '$.titulo'), json_extract(value, '$.tipo'),
                json_extract(value, '$.bytes'), 0, ?, ?
         FROM json_each(?) WHERE true
         ON CONFLICT(id) DO UPDATE SET
           carpeta_id = excluded.carpeta_id,
           titulo = excluded.titulo,
           tipo = excluded.tipo,
           tamano_bytes = excluded.tamano_bytes,
           actualizado_en = excluded.actualizado_en`,
        [VAULT_ID, now, now, JSON.stringify(filasNotas)],
      );
      await execute(
        `INSERT INTO contenidos (nota_id, contenido, actualizado_en)
         SELECT json_extract(value, '$.id'), json_extract(value, '$.contenido'), ?
         FROM json_each(?) WHERE true
         ON CONFLICT(nota_id) DO UPDATE SET
           contenido = excluded.contenido,
           actualizado_en = excluded.actualizado_en`,
        [now, JSON.stringify(filasContenidos)],
      );
      await ftsPonerTanda(filasFts);
      await reindexarPropiedadesTanda(entradasPropiedades);
      await escribirEnlacesTanda(entradasEnlaces);
      // La tanda entera ya está escrita: recién ahora el `mtime` del disco y las
      // huellas (ver el aviso de arriba). `UPDATE … FROM` como en `enlacesIndice.ts`.
      await execute(
        `UPDATE notas SET
           mtime = json_extract(j.value, '$.mtime'),
           hash_indexable = json_extract(j.value, '$.huella'),
           hash_enlaces = json_extract(j.value, '$.huellaEnlaces')
         FROM json_each(?) AS j
         WHERE notas.id = json_extract(j.value, '$.id')`,
        [JSON.stringify(filasNotas.map(({ id, mtime, huella, huellaEnlaces }) => ({ id, mtime, huella, huellaEnlaces })))],
      );
    }
    onTanda?.(rutas.length);
  }
  return reescritas;
}

/**
 * Borra del índice estas notas y todo lo derivado de ellas, y anota sus títulos
 * para re-resolver los enlaces que apuntaban a ellas.
 *
 * Va POR CONJUNTOS (`DEF-105`): se borra por tandas de ids. Antes eran seis
 * sentencias por nota, cada una un viaje por el puente IPC, y la de `notas_fts`
 * recorría la tabla entera: tras un `git worktree remove` de 5.000 notas con la
 * app cerrada, la apertura se quedaba horas en «Leyendo los archivos… N de N».
 */
async function borrarNotas(ids: string[], claves: Set<string>): Promise<void> {
  if (ids.length === 0) return;
  await ftsBorrar(ids);
  for (const id of ids) for (const c of clavesDeTitulo(tituloDeRuta(id))) claves.add(c);
  for (const tanda of enTandas(ids)) {
    const q = marcadores(tanda.length);
    await execute(`DELETE FROM propiedades WHERE nota_id IN (${q})`, tanda);
    await execute(`DELETE FROM enlaces WHERE desde_id IN (${q})`, tanda);
    await execute(`DELETE FROM etiquetas WHERE nota_id IN (${q})`, tanda);
    await execute(`DELETE FROM contenidos WHERE nota_id IN (${q})`, tanda);
    await execute(`DELETE FROM papelera WHERE nota_id IN (${q})`, tanda);
    await execute(`DELETE FROM notas WHERE id IN (${q})`, tanda);
  }
}

/** Borra del índice estas carpetas. */
async function borrarCarpetas(ids: string[]): Promise<void> {
  for (const tanda of enTandas(ids)) {
    await execute(`DELETE FROM carpetas WHERE id IN (${marcadores(tanda.length)})`, tanda);
  }
}

/**
 * Proporción de páginas libres a partir de la cual se compacta, y el mínimo de
 * espacio recuperable que lo justifica (`DEF-108`).
 */
const UMBRAL_LIBRE = 0.25;
const MINIMO_RECUPERABLE = 16 * 1024 * 1024;

/**
 * Devuelve al disco el espacio de lo borrado (`DEF-108`).
 *
 * SQLite no achica el archivo al borrar: las páginas quedan libres **adentro**,
 * para reusarlas, y el archivo conserva su tamaño máximo histórico. Medido en un
 * índice al que se le borraron 3.000 de 3.340 notas: **134 MB, con el 93 % de
 * las páginas libres; compactado, 0,36 MB**. En la PC del incidente de
 * `DEF-105`, 479 MB que no bajaban después de borrar 5.000 notas.
 *
 * Son tres pasos, y los tres hacen falta (medido sobre el mismo índice):
 *
 *   1. `optimize` de FTS5: la tabla de búsqueda NO suelta lo borrado al borrar;
 *      lo marca y lo conserva en sus segmentos hasta fusionarlos. Sin esto, el
 *      `VACUUM` dejaba el índice en 10 MB en vez de 0,36.
 *   2. `VACUUM`: devuelve al disco las páginas libres.
 *   3. `wal_checkpoint(TRUNCATE)`: en modo WAL el `VACUUM` escribe la base nueva
 *      en el `-wal`, que quedaba en 12 MB; el checkpoint la pasa al archivo y lo
 *      vacía.
 *
 * `VACUUM` reescribe la base entera, así que solo se hace cuando vale la pena:
 * tras una limpieza que dejó libre al menos un cuarto del archivo y 16 MB. Si
 * no se puede —otra conexión del pool en plena lectura—, no pasa nada: el índice
 * sigue siendo correcto y se intentará en la próxima limpieza.
 */
async function compactarSiHaceFalta(): Promise<void> {
  try {
    const [total] = await select<{ page_count: number }>("PRAGMA page_count");
    const [libres] = await select<{ freelist_count: number }>("PRAGMA freelist_count");
    const [pagina] = await select<{ page_size: number }>("PRAGMA page_size");
    const n = total?.page_count ?? 0;
    const l = libres?.freelist_count ?? 0;
    const bytesLibres = l * (pagina?.page_size ?? 4096);
    if (n === 0 || l / n < UMBRAL_LIBRE || bytesLibres < MINIMO_RECUPERABLE) return;
    await execute("INSERT INTO notas_fts(notas_fts) VALUES('optimize')");
    await execute("VACUUM");
    // El pragma devuelve una fila: va por `select`, como `journal_mode` en `client.ts`.
    await select("PRAGMA wal_checkpoint(TRUNCATE)");
  } catch (e) {
    console.warn("[Mycelium] indexado · no se pudo compactar el índice; se reintenta en la próxima limpieza", e);
  }
}
