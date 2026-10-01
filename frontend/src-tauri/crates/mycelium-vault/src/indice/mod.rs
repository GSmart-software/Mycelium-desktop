//! El índice de recuperación: SQLite + FTS5 **por sección**
//! (`docs/arquitectura/MCP de Mycelium - memoria.md`).
//!
//! Es un **caché reconstruible** del vault, no una base de datos: la fuente de
//! verdad son los archivos, y el texto que se le devuelve a un agente se lee
//! **siempre del disco** (ver [`leer`]). El índice decide *qué* devolver.
//!
//! > [!important] No es el índice de la app
//! > La app escribe `index-<hash>.db`; este módulo escribe el archivo que le
//! > pasen (el MCP usa `mcp-<hash>.db`, en el mismo app-data). Son dos archivos
//! > con dueños y contenidos distintos: lo que se comparte es **este código**.
//!
//! Concurrencia (§ 2 de la nota): `journal_mode=WAL`, `busy_timeout=5000`, cada
//! nota se reindexa en **su propia transacción**, y un **cerrojo consultivo** en
//! `meta` evita que dos procesos sobre el mismo vault hagan la misma pasada. La
//! corrección la da WAL; el cerrojo solo ahorra trabajo repetido.

pub mod buscar;
pub mod citar;
pub mod leer;

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use rusqlite::{params, Connection, OptionalExtension, TransactionBehavior};

use crate::frontmatter;
use crate::markdown;
use crate::recorrido::{self, ArchivoMeta};
use crate::tipos;

/// Si no coincide con el de `meta`, el índice se descarta y se reconstruye:
/// es un caché, migrar no vale la pena.
pub const VERSION_ESQUEMA: &str = "1";

/// Antes de servir una consulta se revalida si pasó más que esto desde la
/// última comprobación (§ 9 de la nota).
pub const TECHO_REVALIDACION: Duration = Duration::from_millis(2000);

/// El cerrojo consultivo caduca solo: un proceso que murió a mitad de pasada no
/// deja el vault trabado.
const CADUCIDAD_CERROJO_MS: i64 = 30_000;

/// Cuánto se espera a que otro proceso termine su pasada antes de hacerla
/// igual (lo que haya escrito el otro ya no aparece como cambiado).
const ESPERA_CERROJO: Duration = Duration::from_secs(5);

pub type Resultado<T> = Result<T, String>;

fn e<E: std::fmt::Display>(err: E) -> String {
    format!("índice: {err}")
}

pub(crate) fn ahora_ms() -> i64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as i64).unwrap_or(0)
}

/// Lo que hizo una revalidación.
#[derive(Debug, Clone, Default)]
pub struct Revalidacion {
    /// Archivos que vio el walker.
    pub archivos: usize,
    pub reindexadas: usize,
    pub borradas: usize,
    /// Duración total (recorrido + reindexado).
    pub ms: u128,
    /// Solo la pasada de `stat` (el recorrido): es el número que decide si hace
    /// falta un watcher (umbral de ~50 ms, § 9 de la nota).
    pub ms_recorrido: u128,
}

/// Qué le pasó a una nota al revalidarla sola (antes de `vault_leer`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EstadoNota {
    /// El `mtime` coincide con el indexado.
    AlDia,
    /// Cambió en disco y se reindexó.
    Reindexada,
    /// Ya no existe (o ya no es del vault): se borró del índice.
    Borrada,
}

/// El índice abierto sobre un vault.
pub struct Indice {
    pub(crate) conn: Connection,
    pub(crate) raiz: PathBuf,
    ultima_comprobacion: Option<Instant>,
    /// La última revalidación que encontró algo para hacer, o la última a secas.
    pub ultima: Option<Revalidacion>,
}

const ESQUEMA: &str = "
CREATE TABLE IF NOT EXISTS meta (
  clave TEXT PRIMARY KEY,
  valor TEXT
);
CREATE TABLE IF NOT EXISTS notas (
  id          TEXT PRIMARY KEY,   -- ruta relativa POSIX
  titulo      TEXT NOT NULL,      -- nombre sin extensión
  titulo_norm TEXT NOT NULL,      -- minúsculas: contra esto resuelven los enlaces
  tipo        TEXT NOT NULL,      -- markdown, canvas, base, excalidraw, drawio
  mtime       INTEGER NOT NULL,   -- epoch ms: valida lo incremental
  bytes       INTEGER NOT NULL,
  secciones   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS notas_titulo_norm ON notas(titulo_norm);
CREATE TABLE IF NOT EXISTS secciones (
  id               INTEGER PRIMARY KEY,  -- = rowid de secciones_fts
  nota_id          TEXT NOT NULL,
  orden            INTEGER NOT NULL,     -- 0 = preámbulo; la ref es nota#s<orden>
  nivel            INTEGER NOT NULL,     -- 1 a 6; 0 sin encabezado
  encabezado       TEXT NOT NULL,
  ruta_encabezados TEXT NOT NULL,        -- migas: Nota > H2 > H3
  linea_ini        INTEGER NOT NULL,     -- 1-based, inclusiva
  linea_fin        INTEGER NOT NULL,
  bytes            INTEGER NOT NULL,
  parcial          INTEGER NOT NULL,     -- 1 si es un trozo de una sección > 4 KB
  UNIQUE (nota_id, orden)
);
-- La columna `encabezados` guarda la cadena COMPLETA de ancestros (plan § 4.4):
-- cada sección queda indexada con el lugar que ocupa. El `cuerpo` es la única
-- copia del texto en el índice, y existe para que funcione `snippet()`.
CREATE VIRTUAL TABLE IF NOT EXISTS secciones_fts USING fts5(
  titulo_nota, encabezados, cuerpo,
  tokenize = 'unicode61 remove_diacritics 2'
);
CREATE TABLE IF NOT EXISTS enlaces (
  origen_id     TEXT NOT NULL,
  seccion_orden INTEGER NOT NULL,
  destino_bruto TEXT NOT NULL,   -- lo escrito entre corchetes
  destino       TEXT NOT NULL,   -- sin alias (con ruta y ancla)
  destino_norm  TEXT NOT NULL,   -- último segmento, sin ancla, minúsculas
  alias         TEXT,
  ancla         TEXT,
  embed         INTEGER NOT NULL,
  linea         INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS enlaces_origen ON enlaces(origen_id);
CREATE INDEX IF NOT EXISTS enlaces_destino ON enlaces(destino_norm);
-- El texto con que los demás nombran a una nota (plan § 4.1): aparte y no en la
-- fila destino, para no romper la localidad del reindexado.
CREATE VIRTUAL TABLE IF NOT EXISTS enlaces_fts USING fts5(
  destino_norm UNINDEXED, texto,
  tokenize = 'unicode61 remove_diacritics 2'
);
CREATE TABLE IF NOT EXISTS propiedades (
  nota_id TEXT NOT NULL,
  clave   TEXT NOT NULL,
  valor   TEXT NOT NULL,
  tipo    TEXT NOT NULL,
  orden   INTEGER NOT NULL        -- una fila por elemento de lista
);
CREATE INDEX IF NOT EXISTS propiedades_nota ON propiedades(nota_id);
CREATE INDEX IF NOT EXISTS propiedades_clave ON propiedades(clave, valor);
CREATE TABLE IF NOT EXISTS tags (
  nota_id TEXT NOT NULL,
  tag     TEXT NOT NULL,
  fuente  TEXT NOT NULL           -- frontmatter | cuerpo
);
CREATE INDEX IF NOT EXISTS tags_nota ON tags(nota_id);
CREATE INDEX IF NOT EXISTS tags_tag ON tags(tag);
";

const TABLAS: [&str; 8] =
    ["meta", "notas", "secciones", "secciones_fts", "enlaces", "enlaces_fts", "propiedades", "tags"];

impl Indice {
    /// Abre (o crea) el índice en `ruta_db` para el vault de `raiz`.
    /// `ruta_registrada` es la cadena de `vaults.json`: si el índice fue de otro
    /// vault o de otra versión del esquema, se descarta y se empieza de cero.
    pub fn abrir(ruta_db: &Path, raiz: &Path, ruta_registrada: &str) -> Resultado<Indice> {
        if let Some(padre) = ruta_db.parent() {
            std::fs::create_dir_all(padre).map_err(e)?;
        }
        let conn = Connection::open(ruta_db).map_err(e)?;
        conn.busy_timeout(Duration::from_millis(5000)).map_err(e)?;
        let indice = Indice { conn, raiz: raiz.to_path_buf(), ultima_comprobacion: None, ultima: None };
        // Pasar a WAL y preparar el esquema puede chocar con otra sesión que está
        // haciendo lo mismo en ese instante, y ese choque SQLite lo devuelve
        // como «locked» **sin** pasar por `busy_timeout` (el cambio de modo de
        // journal no espera). Se reintenta un rato, como haría el timeout.
        let hasta = Instant::now() + Duration::from_millis(5000);
        loop {
            match indice.preparar(ruta_registrada) {
                Ok(()) => return Ok(indice),
                Err(err) if (err.contains("locked") || err.contains("busy")) && Instant::now() < hasta => {
                    std::thread::sleep(Duration::from_millis(50));
                }
                Err(err) => return Err(err),
            }
        }
    }

    /// WAL, y el esquema al día (descartando el índice si es de otra versión o
    /// de otro vault).
    fn preparar(&self, ruta_registrada: &str) -> Resultado<()> {
        // `journal_mode` DEVUELVE una fila: va por `query_row`.
        let _: String = self.conn.query_row("PRAGMA journal_mode=WAL", [], |r| r.get(0)).map_err(e)?;
        self.conn.execute_batch("PRAGMA synchronous=NORMAL;").map_err(e)?;
        let indice = self;
        // Comprobar la versión y, si hace falta, descartar y recrear, en UNA
        // transacción `IMMEDIATE`: con dos sesiones arrancando a la vez sobre un
        // índice nuevo, la segunda podría ver el esquema a medio escribir, darlo
        // por viejo y borrarle las tablas a la primera mientras indexa.
        indice.conn.execute_batch("BEGIN IMMEDIATE").map_err(e)?;
        let r = (|| {
            let vigente = indice.meta("version_esquema")?.as_deref() == Some(VERSION_ESQUEMA)
                && indice.meta("ruta_vault")?.as_deref() == Some(ruta_registrada);
            if !vigente {
                indice.descartar()?;
            }
            indice.conn.execute_batch(ESQUEMA).map_err(e)?;
            indice.poner_meta("version_esquema", VERSION_ESQUEMA)?;
            indice.poner_meta("ruta_vault", ruta_registrada)
        })();
        indice.conn.execute_batch(if r.is_ok() { "COMMIT" } else { "ROLLBACK" }).map_err(e)?;
        r
    }

    /// La carpeta del vault.
    pub fn raiz(&self) -> &Path {
        &self.raiz
    }

    fn descartar(&self) -> Resultado<()> {
        for t in TABLAS {
            self.conn.execute_batch(&format!("DROP TABLE IF EXISTS {t};")).map_err(e)?;
        }
        Ok(())
    }

    pub(crate) fn meta(&self, clave: &str) -> Resultado<Option<String>> {
        let existe: bool = self
            .conn
            .query_row(
                "SELECT COUNT(*) > 0 FROM sqlite_master WHERE type = 'table' AND name = 'meta'",
                [],
                |r| r.get(0),
            )
            .map_err(e)?;
        if !existe {
            return Ok(None);
        }
        self.conn
            .query_row("SELECT valor FROM meta WHERE clave = ?", [clave], |r| r.get(0))
            .optional()
            .map_err(e)
    }

    fn poner_meta(&self, clave: &str, valor: &str) -> Resultado<()> {
        self.conn
            .execute("INSERT OR REPLACE INTO meta (clave, valor) VALUES (?, ?)", params![clave, valor])
            .map_err(e)?;
        Ok(())
    }

    /// Cuántas notas y secciones hay indexadas.
    pub fn conteos(&self) -> Resultado<(usize, usize)> {
        let notas: i64 = self.conn.query_row("SELECT COUNT(*) FROM notas", [], |r| r.get(0)).map_err(e)?;
        let secs: i64 = self.conn.query_row("SELECT COUNT(*) FROM secciones", [], |r| r.get(0)).map_err(e)?;
        Ok((notas as usize, secs as usize))
    }

    /// Hace cuánto se comprobó el disco por última vez.
    pub fn desde_ultima_comprobacion(&self) -> Option<Duration> {
        self.ultima_comprobacion.map(|t| t.elapsed())
    }

    /// Revalidación **perezosa**: si pasaron menos de [`TECHO_REVALIDACION`]
    /// desde la última, no hace nada (`Ok(None)`). Si no, recorre el vault
    /// pidiendo solo `(ruta, mtime)` y reindexa lo que cambió.
    pub fn revalidar_si_hace_falta(&mut self) -> Resultado<Option<Revalidacion>> {
        if self.desde_ultima_comprobacion().is_some_and(|d| d < TECHO_REVALIDACION) {
            return Ok(None);
        }
        self.revalidar(&mut |_, _| {}).map(Some)
    }

    /// Revalidación completa, sin techo. `progreso(hechas, total)` se llama al
    /// reindexar cada nota (para el arranque en frío).
    pub fn revalidar(&mut self, progreso: &mut dyn FnMut(usize, usize)) -> Resultado<Revalidacion> {
        let t0 = Instant::now();
        let archivos = recorrido::notas_del_vault(&self.raiz)?;
        let ms_recorrido = t0.elapsed().as_millis();

        let (mut cambiadas, mut borradas) = self.diferencias(&archivos)?;
        if !cambiadas.is_empty() || !borradas.is_empty() {
            // Otro proceso puede estar haciendo esta misma pasada: se lo espera
            // un rato y se vuelve a comparar, porque lo que él ya escribió deja
            // de aparecer como cambiado.
            if !self.tomar_cerrojo_esperando()? {
                // Venció la espera: se hace igual. Cada nota es una transacción
                // idempotente (borrar + insertar), así que no rompe nada.
            }
            (cambiadas, borradas) = self.diferencias(&archivos)?;
            let total = cambiadas.len();
            for (i, a) in cambiadas.iter().enumerate() {
                self.reindexar_nota(a)?;
                progreso(i + 1, total);
                if i % 50 == 49 {
                    self.renovar_cerrojo()?;
                }
            }
            for id in &borradas {
                self.borrar_nota(id)?;
            }
            self.poner_meta("ultimo_indexado", &ahora_ms().to_string())?;
            self.soltar_cerrojo()?;
        }

        self.ultima_comprobacion = Some(Instant::now());
        let r = Revalidacion {
            archivos: archivos.len(),
            reindexadas: cambiadas.len(),
            borradas: borradas.len(),
            ms: t0.elapsed().as_millis(),
            ms_recorrido,
        };
        self.ultima = Some(r.clone());
        Ok(r)
    }

    /// Qué archivos cambiaron (o son nuevos) y qué notas indexadas ya no están.
    fn diferencias(&self, archivos: &[ArchivoMeta]) -> Resultado<(Vec<ArchivoMeta>, Vec<String>)> {
        let mut indexadas: HashMap<String, i64> = HashMap::new();
        let mut st = self.conn.prepare("SELECT id, mtime FROM notas").map_err(e)?;
        let filas = st.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?))).map_err(e)?;
        for f in filas {
            let (id, mtime) = f.map_err(e)?;
            indexadas.insert(id, mtime);
        }
        let mut cambiadas = Vec::new();
        for a in archivos {
            match indexadas.remove(&a.ruta_relativa) {
                Some(m) if m == a.mtime => {}
                _ => cambiadas.push(a.clone()),
            }
        }
        Ok((cambiadas, indexadas.into_keys().collect()))
    }

    /// Revalida **una** nota (lo hace `vault_leer` antes de resolver una `ref`,
    /// para no devolver líneas de otra versión del archivo: revisión crítica
    /// § 2.5).
    pub fn revalidar_nota(&mut self, id: &str) -> Resultado<EstadoNota> {
        let ruta = self.raiz.join(id);
        let indexado: Option<i64> = self
            .conn
            .query_row("SELECT mtime FROM notas WHERE id = ?", [id], |r| r.get(0))
            .optional()
            .map_err(e)?;
        let meta = std::fs::metadata(&ruta).ok().filter(|m| m.is_file());
        let Some(meta) = meta else {
            if indexado.is_some() {
                self.borrar_nota(id)?;
            }
            return Ok(EstadoNota::Borrada);
        };
        let mtime = recorrido::mtime_ms(&meta);
        if indexado == Some(mtime) {
            return Ok(EstadoNota::AlDia);
        }
        let a = ArchivoMeta {
            ruta_relativa: id.to_string(),
            mtime,
            tipo: tipos::tipo_de(Path::new(id)),
        };
        self.reindexar_nota(&a)?;
        Ok(EstadoNota::Reindexada)
    }

    /// Reescribe las filas de una nota, en **una** transacción: borrar todo lo
    /// suyo, reparsear, reinsertar. Nada de otras notas se toca (los enlaces se
    /// resuelven por join al consultar, § 5 de la nota).
    fn reindexar_nota(&mut self, a: &ArchivoMeta) -> Resultado<()> {
        let id = a.ruta_relativa.as_str();
        let bytes = std::fs::read(self.raiz.join(id)).map_err(|err| format!("No se pudo leer {id}: {err}"))?;
        let texto = String::from_utf8_lossy(&bytes);
        let titulo = tipos::titulo_de_ruta(id);

        // Solo el Markdown tiene secciones y enlaces. Un `.canvas`, `.base`,
        // `.excalidraw` o `.drawio` entra como nodo sin secciones: así
        // `[[Mi base]]` resuelve y no cuenta como roto (memoria § 12.4).
        let (secciones, enlaces, props, tags) = if a.tipo == "markdown" {
            let fm = frontmatter::separar_frontmatter(&texto);
            (
                markdown::secciones(&titulo, &texto, &fm),
                markdown::extraer_enlaces(&texto),
                frontmatter::filas_indexables(&fm),
                markdown::etiquetas(&texto, &fm),
            )
        } else {
            (Vec::new(), Vec::new(), Vec::new(), Vec::new())
        };

        // IMMEDIATE y no DEFERRED: en WAL, una transacción que empieza leyendo y
        // después quiere escribir recibe «locked» SIN esperar si otra sesión
        // escribió en el medio. Pidiendo la escritura al empezar, `busy_timeout`
        // hace su trabajo y la segunda sesión espera su turno.
        let tx = self.conn.transaction_with_behavior(TransactionBehavior::Immediate).map_err(e)?;
        borrar_filas(&tx, id)?;
        tx.execute(
            "INSERT OR REPLACE INTO notas (id, titulo, titulo_norm, tipo, mtime, bytes, secciones)
             VALUES (?, ?, ?, ?, ?, ?, ?)",
            params![id, titulo, titulo.to_lowercase(), a.tipo, a.mtime, bytes.len() as i64, secciones.len() as i64],
        )
        .map_err(e)?;
        {
            let mut ins_sec = tx
                .prepare(
                    "INSERT INTO secciones (nota_id, orden, nivel, encabezado, ruta_encabezados,
                                            linea_ini, linea_fin, bytes, parcial)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                )
                .map_err(e)?;
            let mut ins_fts = tx
                .prepare("INSERT INTO secciones_fts (rowid, titulo_nota, encabezados, cuerpo) VALUES (?, ?, ?, ?)")
                .map_err(e)?;
            for s in &secciones {
                ins_sec
                    .execute(params![
                        id,
                        s.orden as i64,
                        s.nivel as i64,
                        s.encabezado,
                        s.ruta_encabezados,
                        s.linea_ini as i64,
                        s.linea_fin as i64,
                        s.bytes as i64,
                        s.parcial as i64
                    ])
                    .map_err(e)?;
                let rowid = tx.last_insert_rowid();
                ins_fts.execute(params![rowid, titulo, s.ruta_encabezados, s.texto_indexable]).map_err(e)?;
            }

            let mut ins_enl = tx
                .prepare(
                    "INSERT INTO enlaces (origen_id, seccion_orden, destino_bruto, destino, destino_norm,
                                          alias, ancla, embed, linea)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                )
                .map_err(e)?;
            let mut ins_enl_fts =
                tx.prepare("INSERT INTO enlaces_fts (rowid, destino_norm, texto) VALUES (?, ?, ?)").map_err(e)?;
            for en in &enlaces {
                // La sección que contiene la línea del enlace.
                let orden = secciones
                    .iter()
                    .rev()
                    .find(|s| s.linea_ini <= en.linea)
                    .map(|s| s.orden)
                    .unwrap_or(0);
                ins_enl
                    .execute(params![
                        id,
                        orden as i64,
                        en.bruto,
                        en.destino,
                        en.destino_norm,
                        en.alias,
                        en.ancla,
                        en.embed as i64,
                        en.linea as i64
                    ])
                    .map_err(e)?;
                let rowid = tx.last_insert_rowid();
                // Cómo llaman a la nota: el alias si lo hay; si no, lo escrito.
                let texto_ancla = en.alias.clone().unwrap_or_else(|| en.destino.clone());
                ins_enl_fts.execute(params![rowid, en.destino_norm, texto_ancla]).map_err(e)?;
            }

            let mut ins_prop = tx
                .prepare("INSERT INTO propiedades (nota_id, clave, valor, tipo, orden) VALUES (?, ?, ?, ?, ?)")
                .map_err(e)?;
            for (clave, valor, tipo, orden) in &props {
                ins_prop.execute(params![id, clave, valor, tipo, *orden as i64]).map_err(e)?;
            }
            let mut ins_tag = tx.prepare("INSERT INTO tags (nota_id, tag, fuente) VALUES (?, ?, ?)").map_err(e)?;
            for (tag, fuente) in &tags {
                ins_tag.execute(params![id, tag, fuente]).map_err(e)?;
            }
        }
        tx.commit().map_err(e)
    }

    fn borrar_nota(&mut self, id: &str) -> Resultado<()> {
        let tx = self.conn.transaction_with_behavior(TransactionBehavior::Immediate).map_err(e)?;
        borrar_filas(&tx, id)?;
        tx.execute("DELETE FROM notas WHERE id = ?", [id]).map_err(e)?;
        tx.commit().map_err(e)
    }

    // ── Cerrojo consultivo ───────────────────────────────────────────────────

    fn propio(&self) -> String {
        std::process::id().to_string()
    }

    /// Intenta tomar el cerrojo de reindexado; lo reintenta durante
    /// [`ESPERA_CERROJO`]. `true` si lo tomó.
    fn tomar_cerrojo_esperando(&self) -> Resultado<bool> {
        let hasta = Instant::now() + ESPERA_CERROJO;
        loop {
            if self.tomar_cerrojo()? {
                return Ok(true);
            }
            if Instant::now() >= hasta {
                return Ok(false);
            }
            std::thread::sleep(Duration::from_millis(100));
        }
    }

    fn tomar_cerrojo(&self) -> Resultado<bool> {
        // `BEGIN IMMEDIATE`: leer y escribir el cerrojo sin que otro se meta en
        // el medio.
        self.conn.execute_batch("BEGIN IMMEDIATE").map_err(e)?;
        let r = (|| {
            let actual: Option<String> = self
                .conn
                .query_row("SELECT valor FROM meta WHERE clave = 'reindex_en_curso'", [], |r| r.get(0))
                .optional()
                .map_err(e)?;
            if let Some(v) = actual {
                let (pid, desde) = v.split_once(':').unwrap_or(("", "0"));
                let vigente = ahora_ms() - desde.parse::<i64>().unwrap_or(0) < CADUCIDAD_CERROJO_MS;
                if pid != self.propio() && vigente {
                    return Ok(false);
                }
            }
            self.poner_meta("reindex_en_curso", &format!("{}:{}", self.propio(), ahora_ms()))?;
            Ok(true)
        })();
        self.conn.execute_batch(if r.is_ok() { "COMMIT" } else { "ROLLBACK" }).map_err(e)?;
        r
    }

    fn renovar_cerrojo(&self) -> Resultado<()> {
        self.conn
            .execute(
                "UPDATE meta SET valor = ? WHERE clave = 'reindex_en_curso' AND valor LIKE ?",
                params![format!("{}:{}", self.propio(), ahora_ms()), format!("{}:%", self.propio())],
            )
            .map_err(e)?;
        Ok(())
    }

    fn soltar_cerrojo(&self) -> Resultado<()> {
        self.conn
            .execute(
                "DELETE FROM meta WHERE clave = 'reindex_en_curso' AND valor LIKE ?",
                [format!("{}:%", self.propio())],
            )
            .map_err(e)?;
        Ok(())
    }
}

/// Borra todas las filas derivadas de una nota (no su fila de `notas`).
fn borrar_filas(tx: &rusqlite::Transaction, id: &str) -> Resultado<()> {
    tx.execute("DELETE FROM secciones_fts WHERE rowid IN (SELECT id FROM secciones WHERE nota_id = ?)", [id])
        .map_err(e)?;
    tx.execute("DELETE FROM secciones WHERE nota_id = ?", [id]).map_err(e)?;
    tx.execute("DELETE FROM enlaces_fts WHERE rowid IN (SELECT rowid FROM enlaces WHERE origen_id = ?)", [id])
        .map_err(e)?;
    tx.execute("DELETE FROM enlaces WHERE origen_id = ?", [id]).map_err(e)?;
    tx.execute("DELETE FROM propiedades WHERE nota_id = ?", [id]).map_err(e)?;
    tx.execute("DELETE FROM tags WHERE nota_id = ?", [id]).map_err(e)?;
    Ok(())
}

#[cfg(test)]
pub(crate) mod pruebas {
    use super::*;

    /// Un vault temporal con archivos y su índice.
    pub struct VaultDePrueba {
        pub raiz: PathBuf,
        pub db: PathBuf,
    }

    impl VaultDePrueba {
        pub fn nuevo(nombre: &str) -> Self {
            // Los tests corren en paralelo en el mismo proceso: el contador
            // hace único cada directorio.
            static N: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);
            let n = N.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
            let base = std::env::temp_dir().join(format!("mycelium-indice-{nombre}-{}-{n}", std::process::id()));
            let _ = std::fs::remove_dir_all(&base);
            let raiz = base.join("vault");
            std::fs::create_dir_all(&raiz).unwrap();
            VaultDePrueba { db: base.join("mcp.db"), raiz }
        }
        pub fn escribir(&self, rel: &str, texto: &str) {
            let p = self.raiz.join(rel);
            std::fs::create_dir_all(p.parent().unwrap()).unwrap();
            std::fs::write(p, texto).unwrap();
        }
        pub fn abrir(&self) -> Indice {
            Indice::abrir(&self.db, &self.raiz, &self.raiz.to_string_lossy()).unwrap()
        }
    }

    impl Drop for VaultDePrueba {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(self.raiz.parent().unwrap());
        }
    }

    /// Fuerza un `mtime` distinto sin esperar al reloj del sistema de archivos.
    pub fn tocar(v: &VaultDePrueba, rel: &str, texto: &str) {
        v.escribir(rel, texto);
        let f = std::fs::File::options().write(true).open(v.raiz.join(rel)).unwrap();
        let t = SystemTime::now() + Duration::from_secs(5);
        f.set_modified(t).unwrap();
    }

    #[test]
    fn indexa_y_revalida_solo_lo_que_cambio() {
        let v = VaultDePrueba::nuevo("incremental");
        v.escribir("a.md", "# A\nuno [[B]]\n## A2\ndos");
        v.escribir("sub/B.md", "texto de b");
        v.escribir("tabla.base", "views:");
        v.escribir(".oculta/x.md", "no entra");
        let mut ix = v.abrir();
        let r = ix.revalidar(&mut |_, _| {}).unwrap();
        assert_eq!((r.archivos, r.reindexadas, r.borradas), (3, 3, 0));
        assert_eq!(ix.conteos().unwrap(), (3, 3)); // a: 2 secciones, B: 1, base: 0

        // Sin cambios: nada que hacer.
        let r = ix.revalidar(&mut |_, _| {}).unwrap();
        assert_eq!((r.reindexadas, r.borradas), (0, 0));

        // Cambia una, se borra otra.
        tocar(&v, "a.md", "# A\nsolo una");
        std::fs::remove_file(v.raiz.join("tabla.base")).unwrap();
        let r = ix.revalidar(&mut |_, _| {}).unwrap();
        assert_eq!((r.reindexadas, r.borradas), (1, 1));
        assert_eq!(ix.conteos().unwrap(), (2, 2));
        let enlaces: i64 = ix.conn.query_row("SELECT COUNT(*) FROM enlaces", [], |r| r.get(0)).unwrap();
        assert_eq!(enlaces, 0, "el enlace de la versión vieja no queda colgado");
    }

    #[test]
    fn el_techo_evita_revalidar_dos_veces_seguidas() {
        let v = VaultDePrueba::nuevo("techo");
        v.escribir("a.md", "hola");
        let mut ix = v.abrir();
        assert!(ix.revalidar_si_hace_falta().unwrap().is_some());
        assert!(ix.revalidar_si_hace_falta().unwrap().is_none());
    }

    #[test]
    fn otra_version_del_esquema_o_de_vault_se_descarta() {
        let v = VaultDePrueba::nuevo("esquema");
        v.escribir("a.md", "hola");
        {
            let mut ix = v.abrir();
            ix.revalidar(&mut |_, _| {}).unwrap();
            ix.poner_meta("version_esquema", "0").unwrap();
        }
        let ix = v.abrir();
        assert_eq!(ix.conteos().unwrap(), (0, 0));
    }

    #[test]
    fn revalidar_una_nota_detecta_cambio_y_borrado() {
        let v = VaultDePrueba::nuevo("una");
        v.escribir("a.md", "# A\nuno");
        let mut ix = v.abrir();
        ix.revalidar(&mut |_, _| {}).unwrap();
        assert_eq!(ix.revalidar_nota("a.md").unwrap(), EstadoNota::AlDia);
        tocar(&v, "a.md", "# A\nuno\n# B\ndos");
        assert_eq!(ix.revalidar_nota("a.md").unwrap(), EstadoNota::Reindexada);
        assert_eq!(ix.conteos().unwrap(), (1, 2));
        std::fs::remove_file(v.raiz.join("a.md")).unwrap();
        assert_eq!(ix.revalidar_nota("a.md").unwrap(), EstadoNota::Borrada);
        assert_eq!(ix.conteos().unwrap(), (0, 0));
    }

    /// Dos sesiones que arrancan a la vez sobre el mismo índice nuevo: ninguna
    /// le borra el esquema a la otra y el resultado es el mismo índice.
    #[test]
    fn dos_sesiones_en_frio_sobre_el_mismo_indice() {
        let v = VaultDePrueba::nuevo("dos");
        for i in 0..30 {
            v.escribir(&format!("n{i}.md"), &format!("# N{i}\ntexto {i} [[n{}]]", (i + 1) % 30));
        }
        let hilos: Vec<_> = (0..2)
            .map(|_| {
                let (db, raiz) = (v.db.clone(), v.raiz.clone());
                std::thread::spawn(move || {
                    let mut ix = Indice::abrir(&db, &raiz, &raiz.to_string_lossy()).unwrap();
                    ix.revalidar(&mut |_, _| {}).unwrap();
                })
            })
            .collect();
        for h in hilos {
            h.join().unwrap();
        }
        let ix = v.abrir();
        assert_eq!(ix.conteos().unwrap(), (30, 30));
        let enlaces: i64 = ix.conn.query_row("SELECT COUNT(*) FROM enlaces", [], |r| r.get(0)).unwrap();
        assert_eq!(enlaces, 30);
    }

    #[test]
    fn el_cerrojo_de_otro_proceso_se_respeta_hasta_que_caduca() {
        let v = VaultDePrueba::nuevo("cerrojo");
        let ix = v.abrir();
        ix.poner_meta("reindex_en_curso", &format!("999999:{}", ahora_ms())).unwrap();
        assert!(!ix.tomar_cerrojo().unwrap());
        ix.poner_meta("reindex_en_curso", &format!("999999:{}", ahora_ms() - 60_000)).unwrap();
        assert!(ix.tomar_cerrojo().unwrap());
        ix.soltar_cerrojo().unwrap();
        assert_eq!(ix.meta("reindex_en_curso").unwrap(), None);
    }
}
