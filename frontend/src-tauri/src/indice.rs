//! Abrir el índice SQLite del vault **desde Rust** (`DEF-166`).
//!
//! Hasta `DEF-166` el frontend abría el índice con `Database.load("sqlite:…")`
//! del plugin `sql`. El plugin resuelve la ruta con `PathBuf::push` sobre el
//! config-dir, y `push` de una ruta **absoluta** reemplaza la base: con
//! `sql:allow-load` la webview podía crear y escribir una base SQLite en
//! cualquier carpeta del disco (`sqlite:C:/…/Startup/x.bat`), y con
//! `sql:allow-execute` un `ATTACH` o un `VACUUM INTO` hacían lo mismo desde el
//! índice legítimo.
//!
//! Ahora:
//!
//! 1. La capability ya no da `sql:allow-load`: la webview no abre bases.
//! 2. El índice lo abre este comando, con el nombre derivado del vault **de la
//!    ventana** (`index-<hash>.db`, el `hashRuta` de la cadena registrada), y se
//!    lo entrega al plugin por su estado público (`DbInstances`) con la misma
//!    clave que usaba `Database.load`. `select`/`execute` del plugin siguen
//!    funcionando igual: toda la capa `lib/db/*` queda intacta.
//! 3. Cada conexión del pool lleva un **autorizador** de SQLite que niega
//!    `ATTACH` de un archivo (y con él `VACUUM INTO`, que adjunta el destino por
//!    dentro). El `VACUUM` normal sigue andando: adjunta una base temporal sin
//!    nombre, y esa se permite.

use std::ffi::{c_char, c_int, c_void, CStr};
use std::path::Path;
use std::str::FromStr;

use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
use sqlx::{Pool, Sqlite};
use tauri::Manager;
use tauri_plugin_sql::{DbInstances, DbPool};

/// Autorizador de SQLite: niega adjuntar un archivo. Permite el `ATTACH ''`
/// (una base temporal, sin archivo) que hace `VACUUM` por dentro.
///
/// `ATTACH` llega con el nombre del archivo en el primer argumento si es un
/// literal; si es una expresión, llega `NULL` y también se niega.
unsafe extern "C" fn autorizador(
    _datos: *mut c_void,
    accion: c_int,
    arg1: *const c_char,
    _arg2: *const c_char,
    _arg3: *const c_char,
    _arg4: *const c_char,
) -> c_int {
    if accion != libsqlite3_sys::SQLITE_ATTACH {
        return libsqlite3_sys::SQLITE_OK;
    }
    if arg1.is_null() {
        return libsqlite3_sys::SQLITE_DENY;
    }
    // SAFETY: SQLite pasa una cadena C válida mientras dura la llamada.
    let archivo = unsafe { CStr::from_ptr(arg1) };
    if archivo.to_bytes().is_empty() {
        libsqlite3_sys::SQLITE_OK
    } else {
        libsqlite3_sys::SQLITE_DENY
    }
}

/// Pool sobre `archivo` con el autorizador puesto en cada conexión. Mismas
/// opciones que el `Pool::connect` del plugin (crear si falta, 10 conexiones).
pub(crate) async fn abrir_pool(archivo: &Path) -> Result<Pool<Sqlite>, String> {
    let url = format!("sqlite:{}", archivo.to_string_lossy());
    let opciones = SqliteConnectOptions::from_str(&url)
        .map_err(|e| format!("Ruta del índice inválida: {e}"))?
        .create_if_missing(true);
    SqlitePoolOptions::new()
        .after_connect(|conexion, _| {
            Box::pin(async move {
                let mut manija = conexion.lock_handle().await?;
                // SAFETY: la manija es una conexión abierta y bloqueada para
                // nosotros; el autorizador no guarda estado (`pUserData` nulo).
                let rc = unsafe {
                    libsqlite3_sys::sqlite3_set_authorizer(
                        manija.as_raw_handle().as_ptr(),
                        Some(autorizador),
                        std::ptr::null_mut(),
                    )
                };
                if rc != libsqlite3_sys::SQLITE_OK {
                    return Err(sqlx::Error::Protocol(format!("no se pudo instalar el autorizador ({rc})")));
                }
                Ok(())
            })
        })
        .connect_with(opciones)
        .await
        .map_err(|e| format!("No se pudo abrir el índice del vault: {e}"))
}

/// Abre (creando si falta) el índice del vault de ESTA ventana y lo deja a
/// disposición del plugin `sql`. Devuelve el nombre con el que el frontend lo
/// usa (`sqlite:index-<hash>.db`, el mismo que antes pasaba a `Database.load`).
///
/// `vault_ruta` tiene que ser el vault registrado por la ventana
/// (`ventanas::base_de_ventana`); el hash se calcula sobre la cadena
/// **registrada**, la misma que nombra el canal del MCP.
#[tauri::command]
pub async fn abrir_indice_vault(ventana: tauri::Window, vault_ruta: String) -> Result<String, String> {
    let registrada = crate::ventanas::base_de_ventana(&ventana, &vault_ruta)?;
    let nombre = mycelium_vault::rutas::nombre_indice_app(&registrada);
    let clave = format!("sqlite:{nombre}");

    let instancias = ventana.state::<DbInstances>();
    {
        let mapa = instancias.0.read().await;
        if let Some(DbPool::Sqlite(pool)) = mapa.get(&clave) {
            if !pool.is_closed() {
                return Ok(clave); // ya abierto (recarga de la ventana)
            }
        }
    }

    let dir = ventana
        .app_handle()
        .path()
        .app_config_dir()
        .map_err(|e| format!("No se pudo resolver el config-dir: {e}"))?;
    std::fs::create_dir_all(&dir).map_err(|e| format!("No se pudo crear {}: {e}", dir.display()))?;
    let pool = abrir_pool(&dir.join(&nombre)).await?;

    let mut mapa = instancias.0.write().await;
    // Otra llamada pudo ganarle mientras se abría: se queda la que ya está.
    if let Some(DbPool::Sqlite(existente)) = mapa.get(&clave) {
        if !existente.is_closed() {
            pool.close().await;
            return Ok(clave);
        }
    }
    mapa.insert(clave.clone(), DbPool::Sqlite(pool));
    Ok(clave)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temporal(nombre: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("mic-indice-{nombre}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn el_indice_no_puede_crear_bases_en_otra_carpeta() {
        let dir = temporal("attach");
        let afuera = dir.join("afuera.bat");
        let vacuum = dir.join("copia.db");
        let rt = tokio::runtime::Builder::new_current_thread().enable_all().build().unwrap();
        rt.block_on(async {
            let pool = abrir_pool(&dir.join("index-prueba.db")).await.unwrap();
            sqlx::query("CREATE TABLE IF NOT EXISTS t (x TEXT)").execute(&pool).await.unwrap();
            sqlx::query("INSERT INTO t VALUES ('hola')").execute(&pool).await.unwrap();

            // ATTACH de un archivo: negado, y el archivo no aparece.
            let sql = format!("ATTACH DATABASE '{}' AS x", afuera.to_string_lossy().replace('\'', "''"));
            assert!(sqlx::query(&sql).execute(&pool).await.is_err(), "ATTACH tiene que fallar");
            // Con el nombre armado por una expresión, también.
            let sql = format!("ATTACH DATABASE '{}' || '' AS y", afuera.to_string_lossy().replace('\'', "''"));
            assert!(sqlx::query(&sql).execute(&pool).await.is_err(), "ATTACH con expresión");
            // VACUUM INTO adjunta el destino por dentro: negado.
            let sql = format!("VACUUM INTO '{}'", vacuum.to_string_lossy().replace('\'', "''"));
            assert!(sqlx::query(&sql).execute(&pool).await.is_err(), "VACUUM INTO tiene que fallar");

            // El VACUUM normal, que el indexador usa para compactar, sigue andando.
            sqlx::query("VACUUM").execute(&pool).await.expect("VACUUM normal");
            // Y el índice, también.
            let (x,): (String,) = sqlx::query_as("SELECT x FROM t").fetch_one(&pool).await.unwrap();
            assert_eq!(x, "hola");
            pool.close().await;
        });
        assert!(!afuera.exists(), "ATTACH creó el archivo");
        assert!(!vacuum.exists(), "VACUUM INTO creó el archivo");
        let _ = std::fs::remove_dir_all(dir);
    }
}
