//! Mutaciones del "vault en carpeta" sobre el sistema de archivos real
//! (fase 4 del vault en carpeta, solo-desktop).
//!
//! En modo carpeta los archivos `.md`/`.excalidraw` son la fuente de verdad: al
//! guardar contenido o crear/renombrar/mover/borrar notas y carpetas hay que
//! reflejar el cambio en disco (el índice SQLite es solo un caché derivado). La
//! E/S se hace aquí (Rust) por el mismo motivo que en `archivos.rs`: el scope de
//! `tauri-plugin-fs` no cubre bien rutas arbitrarias elegidas en runtime.
//!
//! TODAS las rutas relativas se validan con `archivos::ruta_segura` contra path
//! traversal, porque el frontend las arma a partir de títulos del usuario. La
//! carpeta base es siempre `vault_ruta` (la carpeta del vault abierto).

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, OnceLock};

use crate::archivos::ruta_segura;

/// Subcarpeta del vault donde vive la papelera (equivalente a `.obsidian/`).
const DIR_PAPELERA: &str = ".mycelium/.trash";

/// Valida `vault_ruta` como carpeta existente y devuelve su `PathBuf`.
fn base_vault(vault_ruta: &str) -> Result<PathBuf, String> {
    let base = PathBuf::from(vault_ruta);
    if !base.is_dir() {
        return Err(format!("La carpeta del vault no existe: {vault_ruta}"));
    }
    Ok(base)
}

/// Crea el directorio padre de `ruta` si hace falta.
fn asegurar_padre(ruta: &Path) -> Result<(), String> {
    if let Some(padre) = ruta.parent() {
        std::fs::create_dir_all(padre)
            .map_err(|e| format!("No se pudo crear {}: {e}", padre.display()))?;
    }
    Ok(())
}

/// Sufijo de desambiguación (ms epoch) para colisiones en la papelera.
fn sufijo_timestamp() -> String {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis().to_string())
        .unwrap_or_else(|_| "0".to_string())
}

/// Contador de temporales de esta ejecución (`FUN-M-58`): junto con el pid, hace
/// único el nombre de cada temporal de `escribir_atomico`.
static TEMPORALES: AtomicU64 = AtomicU64::new(0);

/// Un candado por archivo destino de `escribir_atomico` (`FUN-M-58`). La entrada
/// vive mientras alguien escribe o espera ese archivo; el último en salir la
/// borra, así que el mapa no crece con cada nota que se guardó alguna vez.
fn candados() -> &'static Mutex<HashMap<PathBuf, Arc<Mutex<()>>>> {
    static CANDADOS: OnceLock<Mutex<HashMap<PathBuf, Arc<Mutex<()>>>>> = OnceLock::new();
    CANDADOS.get_or_init(Default::default)
}

/// Escritura **atómica** sobre `destino`: escribe a un temporal hermano y hace
/// `rename`, de modo que un corte a mitad de escritura nunca deja el archivo a
/// medias — o está el contenido viejo entero, o el nuevo entero.
///
/// `pub(crate)` porque no la usa solo el guardado de notas: el editor de los
/// archivos que no son notas (`FUN-M-26`) escribe por el mismo camino, y ahí la
/// garantía pesa **más** todavía —esos archivos no van a la papelera ni tienen
/// historial, así que dejar uno truncado no se deshace desde la app—.
///
/// > [!important] Puede correr en paralelo (`FUN-M-58`)
/// > Hasta `FUN-M-58` los comandos que la llaman corrían en el hilo de la
/// > ventana, uno detrás de otro. Ahora corren en el pool de hilos de Tauri, y
/// > dos guardados de la misma nota pueden cruzarse. Por eso: el temporal lleva
/// > pid **y** un contador (`nota.md.tmp-<pid>-<n>`; antes solo el pid, y dos
/// > escrituras simultáneas compartían el temporal: una podía renombrar el
/// > contenido de la otra a medio escribir, y la segunda fallaba sin temporal
/// > que renombrar), y las escrituras de un mismo destino se hacen de a una
/// > (candado por ruta), para que un `rename` no choque con otro sobre el mismo
/// > archivo —en Windows eso puede fallar con «acceso denegado»—. Gana la
/// > última que toma el candado; el archivo queda entero con uno de los
/// > contenidos y no sobra ningún temporal.
pub(crate) fn escribir_atomico(destino: &Path, contenido: &str) -> Result<(), String> {
    let tmp = temporal_de(destino);
    con_turno(destino, || escribir_y_renombrar(&tmp, destino, contenido))
}

/// Temporal hermano del destino (mismo directorio → el rename es atómico y no
/// cruza sistemas de archivos). En Windows `rename` reemplaza el destino.
fn temporal_de(destino: &Path) -> PathBuf {
    let n = TEMPORALES.fetch_add(1, Ordering::Relaxed);
    destino.with_extension(format!(
        "{}tmp-{}-{n}",
        destino
            .extension()
            .and_then(|e| e.to_str())
            .map(|e| format!("{e}."))
            .unwrap_or_default(),
        std::process::id()
    ))
}

/// Corre `f` con el turno de `destino` tomado: las escrituras de un mismo
/// archivo se hacen de a una (ver `escribir_atomico`). Lo usa también
/// `guardar_nota_en`, que **compara y escribe** dentro del mismo turno.
fn con_turno<T>(destino: &Path, f: impl FnOnce() -> T) -> T {
    let clave = destino.to_path_buf();
    let candado = {
        let mut mapa = candados().lock().unwrap_or_else(|e| e.into_inner());
        mapa.entry(clave.clone()).or_default().clone()
    };
    let resultado = {
        let _turno = candado.lock().unwrap_or_else(|e| e.into_inner());
        f()
    };
    {
        let mut mapa = candados().lock().unwrap_or_else(|e| e.into_inner());
        // 2 = la del mapa + la nuestra: nadie más espera este archivo. Los demás
        // solo clonan el `Arc` con el mapa tomado, así que no hay carrera.
        if Arc::strong_count(&candado) == 2 {
            mapa.remove(&clave);
        }
    }
    resultado
}

/// El cuerpo de `escribir_atomico`, ya con el turno del destino tomado. Si algo
/// falla, el temporal no queda: tampoco uno escrito a medias.
fn escribir_y_renombrar(tmp: &Path, destino: &Path, contenido: &str) -> Result<(), String> {
    std::fs::write(tmp, contenido.as_bytes()).map_err(|e| {
        let _ = std::fs::remove_file(tmp);
        format!("No se pudo escribir {}: {e}", tmp.display())
    })?;
    std::fs::rename(tmp, destino).map_err(|e| {
        let _ = std::fs::remove_file(tmp);
        format!("No se pudo renombrar a {}: {e}", destino.display())
    })?;
    Ok(())
}

/// Escritura **atómica** de una nota. Crea los subdirectorios necesarios y
/// sobrescribe el destino si ya existe.
///
/// Devuelve el `mtime` (ms epoch, el mismo cálculo que el recorrido del índice)
/// del archivo ya escrito (`FUN-M-38`, `FUN-M-14`). El frontend lo guarda en
/// `notas.mtime` para que el reindexado incremental vea la nota como al día, y
/// lo anota para que el watcher reconozca el evento que esta misma escritura va
/// a provocar y no reindexe el vault por un guardado propio. Si el SO no lo
/// expone, 0: la nota se reindexará una vez de más, nada peor.
pub(crate) fn escribir_nota_en(vault_ruta: String, ruta_rel: String, contenido: String) -> Result<i64, String> {
    let base = base_vault(&vault_ruta)?;
    let destino = ruta_segura(&base, &ruta_rel)?;
    asegurar_padre(&destino)?;
    escribir_atomico(&destino, &contenido)?;
    Ok(std::fs::metadata(&destino)
        .map(|m| crate::archivos::mtime_ms(&m))
        .unwrap_or(0))
}

/// Huella de un contenido (`FUN-M-58`, B9): el SHA-256 de sus bytes, en hex.
/// El frontend calcula la misma sobre el UTF-8 del texto (`huellaDeTexto` en
/// `lib/conflictoExterno.ts`): un archivo leído y vuelto a escribir tal cual
/// tiene la misma huella de los dos lados.
pub(crate) fn huella_de(bytes: &[u8]) -> String {
    use sha2::{Digest, Sha256};
    format!("{:x}", Sha256::digest(bytes))
}

/// Lo que devuelve `guardar_nota`.
#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NotaGuardada {
    /// `mtime` con que quedó el archivo (como `escribir_nota`); 0 si no se escribió.
    pub mtime: i64,
    /// El disco cambió desde la base de quien guarda: **no se escribió nada**.
    pub conflicto: bool,
    /// Huella de lo escrito, para que el próximo guardado la mande como base sin
    /// recalcularla. `None` en conflicto.
    pub huella: Option<String>,
}

/// El disco ¿cambió desde la base? El mismo criterio que `decidirAlGuardar`
/// (`lib/conflictoExterno.ts`, `DEF-138`), con huellas en vez de textos:
/// archivo inexistente → se escribe (se recrea); el disco ya tiene lo que se va a
/// escribir → se escribe («ya está»: el `mtime` y el eco del watcher quedan como
/// siempre); el disco tiene la base → se escribe; cualquier otra cosa → conflicto.
fn cambio_por_fuera(destino: &Path, esperada: &str, huella_nueva: &str) -> Result<bool, String> {
    match std::fs::read(destino) {
        Ok(bytes) => {
            let disco = huella_de(&bytes);
            Ok(disco != esperada && disco != huella_nueva)
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(false),
        Err(e) => Err(format!("No se pudo leer {}: {e}", destino.display())),
    }
}

/// Guardado de una nota **con la comparación de `DEF-138` hecha acá**
/// (`FUN-M-58`, B9).
///
/// Hasta B9 el guardado con base leía el archivo entero desde el frontend
/// (`leer_archivo_texto`), lo comparaba en JS con la base y recién después
/// mandaba el texto a `escribir_nota`: el texto cruzaba el puente dos veces
/// (ida y vuelta) por guardado —en una nota de 450 KB, 900 KB de JSON cada
/// 10 s— y entre la lectura y la escritura quedaba un viaje IPC entero de
/// ventana. Ahora el frontend manda solo la **huella** de su base; la lectura,
/// la comparación y la escritura se hacen acá, **dentro del turno del archivo**
/// (`con_turno`): otro guardado de la app no puede colarse entre la
/// comparación y la escritura. (Un programa de afuera sí, en los microsegundos
/// que van de una a otra: es la ventana de cualquier editor que no bloquea el
/// archivo.)
///
/// Sin `huella_esperada` escribe siempre, como `escribir_nota`.
pub(crate) fn guardar_nota_en(
    vault_ruta: String,
    ruta_rel: String,
    contenido: String,
    huella_esperada: Option<String>,
) -> Result<NotaGuardada, String> {
    let base = base_vault(&vault_ruta)?;
    let destino = ruta_segura(&base, &ruta_rel)?;
    asegurar_padre(&destino)?;
    let huella = huella_de(contenido.as_bytes());
    let tmp = temporal_de(&destino);
    let escrito = con_turno(&destino, || -> Result<bool, String> {
        if let Some(esperada) = huella_esperada.as_deref() {
            if cambio_por_fuera(&destino, esperada, &huella)? {
                return Ok(false);
            }
        }
        escribir_y_renombrar(&tmp, &destino, &contenido)?;
        Ok(true)
    })?;
    if !escrito {
        return Ok(NotaGuardada { mtime: 0, conflicto: true, huella: None });
    }
    let mtime = std::fs::metadata(&destino)
        .map(|m| crate::archivos::mtime_ms(&m))
        .unwrap_or(0);
    Ok(NotaGuardada { mtime, conflicto: false, huella: Some(huella) })
}

/// Renombra o mueve un archivo O carpeta dentro del vault. Sirve tanto para
/// renombrar (mismo directorio, nombre distinto) como para mover (otro
/// directorio). Crea el directorio padre del destino.
pub(crate) fn mover_ruta_en(vault_ruta: String, origen_rel: String, destino_rel: String) -> Result<(), String> {
    let base = base_vault(&vault_ruta)?;
    let origen = ruta_segura(&base, &origen_rel)?;
    let destino = ruta_segura(&base, &destino_rel)?;
    if !origen.exists() {
        return Err(format!("No existe el origen: {origen_rel}"));
    }
    // Red de seguridad contra colisiones: NO se sobrescribe un destino existente
    // (el frontend ya rechaza la colisión antes con un mensaje claro, pero un
    // `rename` de Rust pisaría el destino en silencio). Se permite el caso especial
    // de un renombrado que solo cambia mayúsculas/minúsculas en un sistema de
    // archivos insensible (Windows/macOS): ahí origen y destino canonicalizan al
    // MISMO archivo, y bloquearlo impediría corregir el uso de mayúsculas.
    if destino.exists() {
        let mismo_archivo = match (std::fs::canonicalize(&origen), std::fs::canonicalize(&destino)) {
            (Ok(a), Ok(b)) => a == b,
            _ => false,
        };
        if !mismo_archivo {
            return Err(format!("Ya existe algo en el destino: {destino_rel}"));
        }
    }
    asegurar_padre(&destino)?;
    std::fs::rename(&origen, &destino)
        .map_err(|e| format!("No se pudo mover {origen_rel} → {destino_rel}: {e}"))
}

/// Crea un directorio (y sus ancestros) dentro del vault. Idempotente.
pub(crate) fn crear_directorio_en(vault_ruta: String, ruta_rel: String) -> Result<(), String> {
    let base = base_vault(&vault_ruta)?;
    let destino = ruta_segura(&base, &ruta_rel)?;
    std::fs::create_dir_all(&destino)
        .map_err(|e| format!("No se pudo crear {}: {e}", destino.display()))
}

/// Copia un archivo dentro del vault (para duplicar notas). Crea el padre.
pub(crate) fn copiar_archivo_en(vault_ruta: String, origen_rel: String, destino_rel: String) -> Result<(), String> {
    let base = base_vault(&vault_ruta)?;
    let origen = ruta_segura(&base, &origen_rel)?;
    let destino = ruta_segura(&base, &destino_rel)?;
    asegurar_padre(&destino)?;
    std::fs::copy(&origen, &destino)
        .map(|_| ())
        .map_err(|e| format!("No se pudo copiar {origen_rel} → {destino_rel}: {e}"))
}

/// Mueve un archivo o carpeta a la papelera del vault
/// (`<vault>/.mycelium/.trash/<ruta_rel>`), creando los directorios necesarios.
/// Si ya existe algo con esa ruta en la papelera, añade un sufijo con timestamp.
/// Devuelve la **ruta relativa dentro del vault** donde quedó (p. ej.
/// `.mycelium/.trash/Proyectos/plan.md`) para poder restaurarla luego.
pub(crate) fn borrar_a_papelera_en(vault_ruta: String, ruta_rel: String) -> Result<String, String> {
    let base = base_vault(&vault_ruta)?;
    let origen = ruta_segura(&base, &ruta_rel)?;
    if !origen.exists() {
        return Err(format!("No existe: {ruta_rel}"));
    }

    let mut papelera_rel = format!("{DIR_PAPELERA}/{ruta_rel}");
    let mut destino = ruta_segura(&base, &papelera_rel)?;
    if destino.exists() {
        // Colisión en la papelera: desambiguar con un sufijo de timestamp.
        papelera_rel = format!("{papelera_rel}.{}", sufijo_timestamp());
        destino = ruta_segura(&base, &papelera_rel)?;
    }
    asegurar_padre(&destino)?;
    std::fs::rename(&origen, &destino)
        .map_err(|e| format!("No se pudo mover a la papelera {ruta_rel}: {e}"))?;
    Ok(papelera_rel)
}

/// Restaura un elemento de la papelera a `destino_rel` dentro del vault.
pub(crate) fn restaurar_de_papelera_en(
    vault_ruta: String,
    ruta_papelera_rel: String,
    destino_rel: String,
) -> Result<(), String> {
    let base = base_vault(&vault_ruta)?;
    let origen = ruta_segura(&base, &ruta_papelera_rel)?;
    let destino = ruta_segura(&base, &destino_rel)?;
    if !origen.exists() {
        return Err(format!("No existe en la papelera: {ruta_papelera_rel}"));
    }
    asegurar_padre(&destino)?;
    std::fs::rename(&origen, &destino)
        .map_err(|e| format!("No se pudo restaurar {ruta_papelera_rel} → {destino_rel}: {e}"))
}

/// Elimina los directorios ANCESTROS de `desde` que hayan quedado vacíos, sin
/// pasar de `tope` (la raíz de la papelera). Evita que purgar/borrar archivos deje
/// un esqueleto de subcarpetas vacías dentro de `.mycelium/.trash`. Best-effort:
/// cualquier error (dir no vacío, permisos) detiene la poda en silencio.
fn podar_ancestros_vacios(desde: &Path, tope: &Path) {
    let mut actual = desde.parent();
    while let Some(dir) = actual {
        if !dir.starts_with(tope) || dir == tope {
            break; // no subir más allá de la raíz de la papelera
        }
        // `remove_dir` solo borra si está vacío; si no lo está, paramos.
        if std::fs::remove_dir(dir).is_err() {
            break;
        }
        actual = dir.parent();
    }
}

/// Saca un elemento de la papelera de Mycelium mandándolo a la **papelera del
/// sistema operativo** (`DEF-046`), para que quede una última red de recuperación
/// fuera de la app.
///
/// Si el sistema no puede aceptarlo —una unidad de red, un sistema de archivos sin
/// papelera— se borra de forma permanente igualmente: el usuario pidió sacarlo de
/// ahí y la operación tiene que completarse. Lo que no se hace es fingir que fue a
/// la papelera del sistema cuando no fue, así que el motivo se registra en el log.
fn a_papelera_del_sistema(destino: &Path) -> std::io::Result<()> {
    match trash::delete(destino) {
        Ok(()) => Ok(()),
        Err(e) => {
            log::warn!(
                "No se pudo mandar {} a la papelera del sistema ({e}); se borra permanentemente.",
                destino.display()
            );
            if destino.is_dir() {
                std::fs::remove_dir_all(destino)
            } else {
                std::fs::remove_file(destino)
            }
        }
    }
}

/// Saca definitivamente un elemento de la papelera de Mycelium (archivo o carpeta).
/// En modo carpeta esto quita físicamente el `.md`/`.excalidraw` (o la subcarpeta)
/// de `.mycelium/.trash`, no solo la fila del índice, y lo manda a la **papelera del
/// sistema**. Tras borrar, poda los directorios ancestros que queden vacíos dentro
/// de la papelera.
pub(crate) fn borrar_definitivo_en(vault_ruta: String, ruta_papelera_rel: String) -> Result<(), String> {
    let base = base_vault(&vault_ruta)?;
    let destino = ruta_segura(&base, &ruta_papelera_rel)?;
    if !destino.exists() {
        return Ok(()); // ya no está: nada que borrar (idempotente)
    }
    a_papelera_del_sistema(&destino)
        .map_err(|e| format!("No se pudo borrar {ruta_papelera_rel}: {e}"))?;

    // Poda de subcarpetas vacías dentro de la papelera (no toca nada fuera de ella).
    let tope = base.join(".mycelium").join(".trash");
    podar_ancestros_vacios(&destino, &tope);
    Ok(())
}

/// Lee un archivo de texto del vault (ruta validada). Lo usa el framework IA
/// (FUN-L-08) para detectar la versión instalada (`.claude/mycelium-ia.json`).
/// Devuelve `Ok(None)` si el archivo no existe.
pub(crate) fn leer_archivo_texto_en(vault_ruta: String, ruta_rel: String) -> Result<Option<String>, String> {
    let base = base_vault(&vault_ruta)?;
    let ruta = ruta_segura(&base, &ruta_rel)?;
    if !ruta.is_file() {
        return Ok(None);
    }
    std::fs::read_to_string(&ruta)
        .map(Some)
        .map_err(|e| format!("No se pudo leer {ruta_rel}: {e}"))
}

/// Los comandos que escribía el framework IA 1.x sueltos en `.claude/commands/`.
/// Desde la 2.0.0 (`FUN-L-29`) viven en `.claude/commands/mycelium/`.
const COMANDOS_IA_ANTERIORES: [&str; 6] = [
    ".claude/commands/vault-buscar.md",
    ".claude/commands/vault-recordar.md",
    ".claude/commands/vault-mapa.md",
    ".claude/commands/vault-vincular.md",
    ".claude/commands/vault-huerfanas.md",
    ".claude/commands/vault-nota.md",
];

/// Borra un comando que dejó el framework IA 1.x (`FUN-L-29`). **Lista
/// cerrada**: el frontend lo pide solo cuando el archivo sigue tal cual lo
/// escribió Mycelium (lo comprueba por su huella), así que no se pierde nada:
/// la versión nueva ya está en `.claude/commands/mycelium/`. No pasa por la
/// papelera porque no es una nota del índice. Que no exista no es un error.
pub(crate) fn ia_borrar_anterior_en(vault_ruta: String, ruta_rel: String) -> Result<(), String> {
    if !COMANDOS_IA_ANTERIORES.contains(&ruta_rel.as_str()) {
        return Err(format!("«{ruta_rel}» no es un comando del framework IA anterior: no se borra."));
    }
    let base = base_vault(&vault_ruta)?;
    let ruta = ruta_segura(&base, &ruta_rel)?;
    match std::fs::remove_file(&ruta) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(format!("No se pudo borrar {ruta_rel}: {e}")),
    }
}

/// Extensiones que el sistema **ejecuta** en vez de abrir con un visor: los
/// tipos de `PATHEXT` de Windows y los que el shell lanza igual (accesos
/// directos, instaladores, scripts de WSH, paneles de control, registro), más
/// los equivalentes de macOS y Linux. Lista cerrada y en minúsculas.
const EJECUTABLES: &[&str] = &[
    "exe", "com", "bat", "cmd", "pif", "scr", "cpl", "msi", "msp", "msc", "lnk", "url", "scf", "hta",
    "js", "jse", "vbs", "vbe", "wsf", "wsh", "ps1", "psm1", "reg", "jar", "appref-ms", "application",
    "gadget", "inf", "settingcontent-ms", "library-ms", "search-ms", "app", "command", "sh", "desktop",
    "appimage", "run", "bin",
];

/// `true` si `ruta` es de un tipo que el sistema ejecutaría al «abrirlo».
fn es_ejecutable(ruta: &Path) -> bool {
    let ext = crate::archivos::extension_de(ruta);
    // Sin extensión, en Unix puede ser un binario con permiso de ejecución.
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if let Ok(m) = std::fs::metadata(ruta) {
            if m.permissions().mode() & 0o111 != 0 {
                return true;
            }
        }
    }
    EJECUTABLES.contains(&ext.as_str())
}

/// Tipos que no son programas pero que, al abrirlos, pueden ejecutar código o
/// saltarse la marca de la web (`DEF-165`): documentos de Office con macros
/// (`.docm`, `.xlsm`, `.pptm` y sus plantillas y complementos; `.xlsb` también
/// las admite), complementos de Excel que son bibliotecas (`.xll`), ayuda
/// compilada (`.chm`, corre scripts) e imágenes de disco que Windows monta al
/// abrirlas (`.iso`, `.img`, `.vhd`, `.vhdx`). No se rechazan —son documentos
/// legítimos—, pero antes de abrirlos Rust pregunta con un diálogo nativo.
const PIDEN_CONFIRMACION: &[&str] = &[
    "docm", "dotm", "xlsm", "xltm", "xlam", "xlsb", "pptm", "potm", "ppsm", "ppam", "sldm", "xll",
    "chm", "iso", "img", "vhd", "vhdx",
];

/// `true` si abrir `ruta` pide confirmación (ver `PIDEN_CONFIRMACION`).
fn pide_confirmacion(ruta: &Path) -> bool {
    PIDEN_CONFIRMACION.contains(&crate::archivos::extension_de(ruta).as_str())
}

/// Abre `ruta_rel` con la aplicación que el SO tenga asociada a su tipo.
///
/// Es la salida de emergencia del visor de solo lectura (`FUN-L-11`): lo que
/// Mycelium no puede mostrar —un binario, un archivo de 500 MB, un tipo sin
/// visor propio— se le pasa a quien sí sabe. Pariente de `revelar_en_sistema`,
/// que en cambio **muestra** el archivo en el explorador sin abrirlo.
///
/// > [!warning] No abre ejecutables (`DEF-161`)
/// > «La aplicación asociada» de un `.bat`, un `.exe` o un `.lnk` es el propio
/// > sistema **ejecutándolo**. Como desde la webview se puede escribir un
/// > archivo cualquiera en el vault (`escribir_nota`), abrir eso era ejecutar
/// > lo que un XSS escribió. Para esos tipos queda «Mostrar en el explorador».
pub(crate) fn abrir_con_sistema_en(vault_ruta: String, ruta_rel: String) -> Result<(), String> {
    use std::process::Command;
    let base = base_vault(&vault_ruta)?;
    let destino = ruta_segura(&base, &ruta_rel)?;
    if !destino.exists() {
        return Err(format!("No existe en disco: {ruta_rel}"));
    }
    if destino.is_file() && es_ejecutable(&destino) {
        return Err(format!(
            "«{ruta_rel}» se ejecutaría al abrirlo: Mycelium no lo abre. Usa «Mostrar en el explorador»."
        ));
    }

    #[cfg(target_os = "windows")]
    {
        // `explorer.exe <archivo>` delega en el handler por defecto del tipo, sin
        // pasar por `cmd /c start` —que interpretaría la ruta como línea de
        // comandos—. Mismo detalle que en `revelar_en_sistema`: la ruta va entre
        // comillas con `raw_arg`, y explorer devuelve códigos != 0 aun con éxito,
        // así que no se comprueba el estado.
        use std::os::windows::process::CommandExt;
        Command::new("explorer")
            .raw_arg(format!("\"{}\"", destino.display()))
            .spawn()
            .map_err(|e| format!("No se pudo abrir el archivo: {e}"))?;
        return Ok(());
    }

    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .arg(destino.as_os_str())
            .spawn()
            .map_err(|e| format!("No se pudo abrir el archivo: {e}"))?;
        return Ok(());
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        Command::new("xdg-open")
            .arg(destino.as_os_str())
            .spawn()
            .map_err(|e| format!("No se pudo abrir el archivo: {e}"))?;
        return Ok(());
    }

    #[allow(unreachable_code)]
    Err("Plataforma no soportada.".to_string())
}

/// Abre el explorador de archivos del SO mostrando (y seleccionando, donde se
/// pueda) el archivo/carpeta `ruta_rel` del vault. Solo tiene sentido en modo
/// carpeta (los archivos existen en disco).
pub(crate) fn revelar_en_sistema_en(vault_ruta: String, ruta_rel: String) -> Result<(), String> {
    use std::process::Command;
    let base = base_vault(&vault_ruta)?;
    let destino = ruta_segura(&base, &ruta_rel)?;
    if !destino.exists() {
        return Err(format!("No existe en disco: {ruta_rel}"));
    }

    #[cfg(target_os = "windows")]
    {
        // `explorer /select,<ruta>` selecciona el elemento dentro de su carpeta.
        // OJO: explorer exige `/select,` FUERA de comillas y la ruta ENTRE comillas.
        // Con `.arg(...)` Rust entrecomilla el argumento entero (`"/select,C:\...")`)
        // y explorer, al no parsearlo, abre Documentos. Por eso se usa `raw_arg`,
        // que pasa la línea de comandos tal cual. explorer.exe suele devolver código
        // != 0 aun con éxito, así que se lanza sin comprobar el estado.
        use std::os::windows::process::CommandExt;
        Command::new("explorer")
            .raw_arg(format!("/select,\"{}\"", destino.display()))
            .spawn()
            .map_err(|e| format!("No se pudo abrir el explorador: {e}"))?;
        return Ok(());
    }

    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .args(["-R".as_ref(), destino.as_os_str()])
            .spawn()
            .map_err(|e| format!("No se pudo abrir Finder: {e}"))?;
        return Ok(());
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        // No hay "seleccionar" universal en Linux: se abre la carpeta contenedora
        // (o la propia carpeta si el destino es un directorio).
        let dir = if destino.is_dir() {
            destino.as_path()
        } else {
            destino.parent().unwrap_or(&base)
        };
        Command::new("xdg-open")
            .arg(dir)
            .spawn()
            .map_err(|e| format!("No se pudo abrir el explorador: {e}"))?;
        return Ok(());
    }

    #[allow(unreachable_code)]
    Err("Plataforma no soportada.".to_string())
}

// ── Comandos (`DEF-161`) ─────────────────────────────────────────────────────
//
// Cada comando comprueba que `vault_ruta` sea el vault que registró la ventana
// que lo invoca (`ventanas::base_de_ventana`) y trabaja sobre esa carpeta, la
// registrada. Hasta `DEF-161` se validaba solo la parte relativa: la base la
// decidía JS, y con ella cualquier carpeta del disco era «el vault».

//
// Todos llevan `#[tauri::command(async)]` (`FUN-M-58`) salvo `abrir_con_sistema`,
// que ya era `async fn`. Un comando sin `async` corre en el hilo de la ventana
// —ahí atiende WebView2 el IPC—: mientras dura, la ventana no se mueve ni se
// redimensiona y todo el IPC, también el SQL del índice, queda en cola detrás.
// Con `(async)` la misma función corre en el pool de Tauri. El precio es que dos
// llamadas pueden correr a la vez: el frontend espera cada una antes de la
// siguiente que dependa de ella (`lib/db/vaultFs.ts`), y dos guardados de la
// misma nota que se crucen los ordena el candado de `escribir_atomico`.

use crate::ventanas::base_de_ventana as base;

/// Ver `escribir_nota_en`.
#[tauri::command(async)]
pub fn escribir_nota(ventana: tauri::Window, vault_ruta: String, ruta_rel: String, contenido: String) -> Result<i64, String> {
    escribir_nota_en(base(&ventana, &vault_ruta)?, ruta_rel, contenido)
}

/// Ver `guardar_nota_en`.
#[tauri::command(async)]
pub fn guardar_nota(
    ventana: tauri::Window,
    vault_ruta: String,
    ruta_rel: String,
    contenido: String,
    huella_esperada: Option<String>,
) -> Result<NotaGuardada, String> {
    guardar_nota_en(base(&ventana, &vault_ruta)?, ruta_rel, contenido, huella_esperada)
}

/// Ver `mover_ruta_en`.
#[tauri::command(async)]
pub fn mover_ruta(ventana: tauri::Window, vault_ruta: String, origen_rel: String, destino_rel: String) -> Result<(), String> {
    mover_ruta_en(base(&ventana, &vault_ruta)?, origen_rel, destino_rel)
}

/// Ver `crear_directorio_en`.
#[tauri::command(async)]
pub fn crear_directorio(ventana: tauri::Window, vault_ruta: String, ruta_rel: String) -> Result<(), String> {
    crear_directorio_en(base(&ventana, &vault_ruta)?, ruta_rel)
}

/// Ver `copiar_archivo_en`.
#[tauri::command(async)]
pub fn copiar_archivo(ventana: tauri::Window, vault_ruta: String, origen_rel: String, destino_rel: String) -> Result<(), String> {
    copiar_archivo_en(base(&ventana, &vault_ruta)?, origen_rel, destino_rel)
}

/// Ver `borrar_a_papelera_en`.
#[tauri::command(async)]
pub fn borrar_a_papelera(ventana: tauri::Window, vault_ruta: String, ruta_rel: String) -> Result<String, String> {
    borrar_a_papelera_en(base(&ventana, &vault_ruta)?, ruta_rel)
}

/// Ver `restaurar_de_papelera_en`.
#[tauri::command(async)]
pub fn restaurar_de_papelera(
    ventana: tauri::Window,
    vault_ruta: String,
    ruta_papelera_rel: String,
    destino_rel: String,
) -> Result<(), String> {
    restaurar_de_papelera_en(base(&ventana, &vault_ruta)?, ruta_papelera_rel, destino_rel)
}

/// Ver `borrar_definitivo_en`.
#[tauri::command(async)]
pub fn borrar_definitivo(ventana: tauri::Window, vault_ruta: String, ruta_papelera_rel: String) -> Result<(), String> {
    borrar_definitivo_en(base(&ventana, &vault_ruta)?, ruta_papelera_rel)
}

/// Ver `leer_archivo_texto_en`.
#[tauri::command(async)]
pub fn leer_archivo_texto(ventana: tauri::Window, vault_ruta: String, ruta_rel: String) -> Result<Option<String>, String> {
    leer_archivo_texto_en(base(&ventana, &vault_ruta)?, ruta_rel)
}

/// Ver `ia_borrar_anterior_en`.
#[tauri::command(async)]
pub fn ia_borrar_anterior(ventana: tauri::Window, vault_ruta: String, ruta_rel: String) -> Result<(), String> {
    ia_borrar_anterior_en(base(&ventana, &vault_ruta)?, ruta_rel)
}

/// Ver `abrir_con_sistema_en`. Solo rutas dentro del vault de la ventana: es
/// el comando que **ejecuta** lo que toca (abre con el programa asociado), así
/// que con una base libre bastaba un `.bat` cualquiera del disco.
///
/// Un documento con macros o una imagen de disco (`pide_confirmacion`) se abre
/// solo si el usuario lo confirma en un diálogo **nativo**, que la webview no
/// puede contestar por él (`DEF-165`). Si dice que no, no pasa nada: no es un
/// error.
#[tauri::command]
pub async fn abrir_con_sistema(ventana: tauri::Window, vault_ruta: String, ruta_rel: String) -> Result<(), String> {
    let vault = base(&ventana, &vault_ruta)?;
    if pide_confirmacion(Path::new(&ruta_rel)) {
        use tauri::Manager;
        use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};
        let nombre = Path::new(&ruta_rel)
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_else(|| ruta_rel.clone());
        let (tx, rx) = tokio::sync::oneshot::channel();
        ventana
            .app_handle()
            .dialog()
            .message(format!(
                "«{nombre}» puede ejecutar código al abrirlo (macros, complementos o una imagen de disco). \
                 Ábrelo solo si sabes de dónde viene y confías en quien lo hizo."
            ))
            .title("¿Abrir este archivo?")
            .kind(MessageDialogKind::Warning)
            .buttons(MessageDialogButtons::OkCancelCustom("Abrir".into(), "Cancelar".into()))
            .parent(&ventana)
            .show(move |ok| {
                let _ = tx.send(ok);
            });
        if !rx.await.unwrap_or(false) {
            return Ok(());
        }
    }
    abrir_con_sistema_en(vault, ruta_rel)
}

/// Ver `revelar_en_sistema_en`.
#[tauri::command(async)]
pub fn revelar_en_sistema(ventana: tauri::Window, vault_ruta: String, ruta_rel: String) -> Result<(), String> {
    revelar_en_sistema_en(base(&ventana, &vault_ruta)?, ruta_rel)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Carpeta temporal aislada por nombre de test.
    fn tmp_vault(nombre: &str) -> PathBuf {
        let base = std::env::temp_dir().join(format!("mycelium-vfs-{nombre}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&base);
        std::fs::create_dir_all(&base).unwrap();
        base
    }

    #[test]
    fn ia_borrar_anterior_solo_borra_los_comandos_de_la_lista() {
        let base = tmp_vault("ia-anterior");
        let v = base.to_string_lossy().to_string();
        escribir_nota_en(v.clone(), ".claude/commands/vault-buscar.md".into(), "viejo".into()).unwrap();
        escribir_nota_en(v.clone(), ".claude/commands/mio.md".into(), "mío".into()).unwrap();
        ia_borrar_anterior_en(v.clone(), ".claude/commands/vault-buscar.md".into()).unwrap();
        assert!(!base.join(".claude/commands/vault-buscar.md").exists());
        // Que ya no exista no es un error.
        ia_borrar_anterior_en(v.clone(), ".claude/commands/vault-buscar.md".into()).unwrap();
        // Fuera de la lista, nada.
        assert!(ia_borrar_anterior_en(v.clone(), ".claude/commands/mio.md".into()).is_err());
        assert!(ia_borrar_anterior_en(v.clone(), "CLAUDE.md".into()).is_err());
        assert!(base.join(".claude/commands/mio.md").exists());
        std::fs::remove_dir_all(&base).unwrap();
    }

    #[test]
    fn escritura_atomica_crea_el_archivo_y_subdirs() {
        let base = tmp_vault("escribir");
        let v = base.to_string_lossy().to_string();
        escribir_nota_en(v.clone(), "Proyectos/2026/plan.md".into(), "# Plan ñ".into()).unwrap();
        let destino = base.join("Proyectos/2026/plan.md");
        assert!(destino.exists());
        assert_eq!(std::fs::read_to_string(&destino).unwrap(), "# Plan ñ");
        // No debe quedar ningún temporal.
        let hay_tmp = std::fs::read_dir(base.join("Proyectos/2026"))
            .unwrap()
            .filter_map(|e| e.ok())
            .any(|e| e.file_name().to_string_lossy().contains("tmp"));
        assert!(!hay_tmp, "no debe quedar el temporal");
        std::fs::remove_dir_all(&base).unwrap();
    }

    #[test]
    fn escribir_sobrescribe_destino_existente() {
        let base = tmp_vault("sobrescribir");
        let v = base.to_string_lossy().to_string();
        escribir_nota_en(v.clone(), "n.md".into(), "uno".into()).unwrap();
        escribir_nota_en(v.clone(), "n.md".into(), "dos".into()).unwrap();
        assert_eq!(std::fs::read_to_string(base.join("n.md")).unwrap(), "dos");
        std::fs::remove_dir_all(&base).unwrap();
    }

    #[test]
    fn mover_renombra_archivo() {
        let base = tmp_vault("mover");
        let v = base.to_string_lossy().to_string();
        escribir_nota_en(v.clone(), "viejo.md".into(), "x".into()).unwrap();
        mover_ruta_en(v.clone(), "viejo.md".into(), "sub/nuevo.md".into()).unwrap();
        assert!(!base.join("viejo.md").exists());
        assert!(base.join("sub/nuevo.md").exists());
        std::fs::remove_dir_all(&base).unwrap();
    }

    #[test]
    fn copiar_duplica_archivo() {
        let base = tmp_vault("copiar");
        let v = base.to_string_lossy().to_string();
        escribir_nota_en(v.clone(), "a.md".into(), "contenido".into()).unwrap();
        copiar_archivo_en(v.clone(), "a.md".into(), "a (copia).md".into()).unwrap();
        assert!(base.join("a.md").exists());
        assert_eq!(std::fs::read_to_string(base.join("a (copia).md")).unwrap(), "contenido");
        std::fs::remove_dir_all(&base).unwrap();
    }

    #[test]
    fn borrar_a_papelera_mueve_bajo_trash_y_restaura() {
        let base = tmp_vault("papelera");
        let v = base.to_string_lossy().to_string();
        escribir_nota_en(v.clone(), "Carpeta/nota.md".into(), "hola".into()).unwrap();

        let papelera_rel = borrar_a_papelera_en(v.clone(), "Carpeta/nota.md".into()).unwrap();
        assert_eq!(papelera_rel, ".mycelium/.trash/Carpeta/nota.md");
        assert!(!base.join("Carpeta/nota.md").exists());
        assert!(base.join(&papelera_rel).exists());

        // Segunda vez con el mismo nombre: sufijo de timestamp (sin colisión).
        escribir_nota_en(v.clone(), "Carpeta/nota.md".into(), "otra".into()).unwrap();
        let segunda = borrar_a_papelera_en(v.clone(), "Carpeta/nota.md".into()).unwrap();
        assert_ne!(segunda, papelera_rel, "la colisión debe desambiguar");
        assert!(base.join(&segunda).exists());

        // Restaurar la primera de vuelta a su ruta original.
        restaurar_de_papelera_en(v.clone(), papelera_rel.clone(), "Carpeta/nota.md".into()).unwrap();
        assert_eq!(std::fs::read_to_string(base.join("Carpeta/nota.md")).unwrap(), "hola");

        // Borrado definitivo del segundo.
        borrar_definitivo_en(v.clone(), segunda.clone()).unwrap();
        assert!(!base.join(&segunda).exists());
        std::fs::remove_dir_all(&base).unwrap();
    }

    #[test]
    fn borrar_a_papelera_mueve_carpeta_entera() {
        let base = tmp_vault("papelera-dir");
        let v = base.to_string_lossy().to_string();
        escribir_nota_en(v.clone(), "Sub/a.md".into(), "a".into()).unwrap();
        escribir_nota_en(v.clone(), "Sub/b.md".into(), "b".into()).unwrap();
        let rel = borrar_a_papelera_en(v.clone(), "Sub".into()).unwrap();
        assert_eq!(rel, ".mycelium/.trash/Sub");
        assert!(!base.join("Sub").exists());
        assert!(base.join(".mycelium/.trash/Sub/a.md").exists());
        assert!(base.join(".mycelium/.trash/Sub/b.md").exists());
        std::fs::remove_dir_all(&base).unwrap();
    }

    #[test]
    fn mover_rechaza_pisar_un_destino_existente() {
        let base = tmp_vault("colision");
        let v = base.to_string_lossy().to_string();
        escribir_nota_en(v.clone(), "a.md".into(), "aaa".into()).unwrap();
        escribir_nota_en(v.clone(), "b.md".into(), "bbb".into()).unwrap();
        // Mover a.md sobre b.md (que ya existe) debe fallar y NO pisar b.md.
        assert!(mover_ruta_en(v.clone(), "a.md".into(), "b.md".into()).is_err());
        assert_eq!(std::fs::read_to_string(base.join("a.md")).unwrap(), "aaa");
        assert_eq!(std::fs::read_to_string(base.join("b.md")).unwrap(), "bbb");
        std::fs::remove_dir_all(&base).unwrap();
    }

    #[test]
    fn borrar_definitivo_poda_subcarpetas_vacias_de_la_papelera() {
        let base = tmp_vault("poda");
        let v = base.to_string_lossy().to_string();
        escribir_nota_en(v.clone(), "Carpeta/Sub/nota.md".into(), "hola".into()).unwrap();
        let rel = borrar_a_papelera_en(v.clone(), "Carpeta/Sub/nota.md".into()).unwrap();
        assert!(base.join(&rel).exists());
        borrar_definitivo_en(v.clone(), rel).unwrap();
        // Al quedar vacías, las subcarpetas de la papelera se podan, pero la raíz
        // `.mycelium/.trash` se conserva.
        assert!(!base.join(".mycelium/.trash/Carpeta").exists());
        assert!(base.join(".mycelium/.trash").exists());
        std::fs::remove_dir_all(&base).unwrap();
    }

    #[test]
    fn abrir_con_sistema_no_ejecuta_programas() {
        let base = tmp_vault("ejecutables");
        let v = base.to_string_lossy().to_string();
        for nombre in ["x.bat", "x.EXE", "acceso.lnk", "s.ps1", "w.vbs", "i.msi"] {
            escribir_nota_en(v.clone(), nombre.into(), "echo".into()).unwrap();
            assert!(abrir_con_sistema_en(v.clone(), nombre.into()).is_err(), "{nombre}");
        }
        assert!(es_ejecutable(&base.join("x.cmd")));
        assert!(!es_ejecutable(&base.join("informe.pdf")));
        assert!(!es_ejecutable(&base.join("foto.png")));
        std::fs::remove_dir_all(&base).unwrap();
    }

    /// `DEF-165`: los documentos con macros y las imágenes de disco piden
    /// confirmación; un documento común o una imagen, no. Ninguno es ejecutable:
    /// no se rechazan.
    #[test]
    fn documentos_con_macros_piden_confirmacion() {
        for nombre in ["informe.docm", "Cuentas.XLSM", "charla.pptm", "addin.xll", "disco.iso", "ayuda.chm"] {
            assert!(pide_confirmacion(Path::new(nombre)), "{nombre}");
            assert!(!es_ejecutable(Path::new(nombre)), "{nombre}");
        }
        for nombre in ["informe.docx", "Cuentas.xlsx", "charla.pptx", "nota.md", "foto.png", "a.pdf"] {
            assert!(!pide_confirmacion(Path::new(nombre)), "{nombre}");
        }
    }

    /// `FUN-M-58`: con los comandos en el pool de hilos, dos guardados de la misma
    /// nota pueden cruzarse. N hilos escriben a la vez, varias veces, contenidos
    /// distintos y grandes (para que las ventanas se pisen): ninguna escritura
    /// falla, el archivo final es exactamente uno de los contenidos —no una
    /// mezcla— y no sobra ningún temporal.
    #[test]
    fn escrituras_concurrentes_de_la_misma_nota_dejan_una_entera_y_ningun_temporal() {
        const HILOS: usize = 12;
        const VUELTAS: usize = 15;
        let base = tmp_vault("concurrentes");
        let destino = base.join("nota.md");
        let contenidos: Vec<String> = (0..HILOS)
            .map(|i| format!("hilo {i}
").repeat(20_000))
            .collect();
        let barrera = Arc::new(std::sync::Barrier::new(HILOS));
        let hilos: Vec<_> = contenidos
            .iter()
            .cloned()
            .map(|contenido| {
                let destino = destino.clone();
                let barrera = barrera.clone();
                std::thread::spawn(move || {
                    barrera.wait();
                    for _ in 0..VUELTAS {
                        escribir_atomico(&destino, &contenido).expect("ninguna escritura debe fallar");
                    }
                })
            })
            .collect();
        for h in hilos {
            h.join().unwrap();
        }
        let final_ = std::fs::read_to_string(&destino).unwrap();
        assert!(contenidos.contains(&final_), "el archivo quedó con una mezcla o truncado");
        let nombres: Vec<String> = std::fs::read_dir(&base)
            .unwrap()
            .map(|e| e.unwrap().file_name().to_string_lossy().to_string())
            .collect();
        assert_eq!(nombres, vec!["nota.md".to_string()], "sobraron temporales");
        // Y el mapa de candados no se queda con la entrada.
        assert!(!candados().lock().unwrap().contains_key(&destino));
        std::fs::remove_dir_all(&base).unwrap();
    }

    /// `FUN-M-58`, B9: el guardado con base compara el disco con la huella de
    /// la base y solo escribe si nadie lo cambió (el criterio de `DEF-138`).
    #[test]
    fn guardar_con_huella_escribe_solo_si_el_disco_tiene_la_base() {
        let base = tmp_vault("guardar-huella");
        let v = base.to_string_lossy().to_string();
        let destino = base.join("n.md");
        escribir_nota_en(v.clone(), "n.md".into(), "base ñ".into()).unwrap();
        let h_base = huella_de("base ñ".as_bytes());

        // Huella igual → escribe y devuelve la huella de lo escrito y el mtime.
        let r = guardar_nota_en(v.clone(), "n.md".into(), "mío".into(), Some(h_base.clone())).unwrap();
        assert!(!r.conflicto);
        assert_eq!(r.huella.as_deref(), Some(huella_de("mío".as_bytes()).as_str()));
        assert!(r.mtime > 0);
        assert_eq!(std::fs::read_to_string(&destino).unwrap(), "mío");

        // Alguien de afuera escribe: con la base vieja, conflicto y NO se escribe.
        std::fs::write(&destino, "de afuera").unwrap();
        let h_mio = r.huella.unwrap();
        let r = guardar_nota_en(v.clone(), "n.md".into(), "mío otra vez".into(), Some(h_mio.clone())).unwrap();
        assert!(r.conflicto);
        assert_eq!(r.mtime, 0);
        assert!(r.huella.is_none());
        assert_eq!(std::fs::read_to_string(&destino).unwrap(), "de afuera", "lo de afuera no se pisa");

        // «Ya está»: el disco ya tiene lo que se iba a escribir → se escribe igual.
        let r = guardar_nota_en(v.clone(), "n.md".into(), "de afuera".into(), Some(h_mio.clone())).unwrap();
        assert!(!r.conflicto);
        assert_eq!(std::fs::read_to_string(&destino).unwrap(), "de afuera");

        // Sin huella (forzar, «Quedarme con lo mío») → escribe siempre.
        std::fs::write(&destino, "otra vez de afuera").unwrap();
        let r = guardar_nota_en(v.clone(), "n.md".into(), "forzado".into(), None).unwrap();
        assert!(!r.conflicto);
        assert_eq!(std::fs::read_to_string(&destino).unwrap(), "forzado");

        // No sobra ningún temporal, tampoco tras el conflicto.
        let nombres: Vec<String> = std::fs::read_dir(&base)
            .unwrap()
            .map(|e| e.unwrap().file_name().to_string_lossy().to_string())
            .collect();
        assert_eq!(nombres, vec!["n.md".to_string()]);
        std::fs::remove_dir_all(&base).unwrap();
    }

    /// Archivo inexistente (lo borraron por fuera): se recrea, como antes, con
    /// sus subcarpetas.
    #[test]
    fn guardar_con_huella_recrea_el_archivo_que_no_existe() {
        let base = tmp_vault("guardar-inexistente");
        let v = base.to_string_lossy().to_string();
        let h = huella_de("lo que había".as_bytes());
        let r = guardar_nota_en(v.clone(), "Sub/n.md".into(), "nuevo".into(), Some(h)).unwrap();
        assert!(!r.conflicto);
        assert_eq!(std::fs::read_to_string(base.join("Sub/n.md")).unwrap(), "nuevo");
        assert!(guardar_nota_en(v.clone(), "../fuera.md".into(), "x".into(), None).is_err());
        std::fs::remove_dir_all(&base).unwrap();
    }

    /// La huella es la del frontend: SHA-256 hex de los bytes UTF-8, con BOM y
    /// CRLF tal cual (`huellaDeTexto`; `scripts/test-conflicto-externo.mjs`
    /// prueba el mismo vector).
    #[test]
    fn huella_es_sha256_hex_de_los_bytes() {
        assert_eq!(huella_de(b""), "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
        assert_eq!(
            huella_de("\u{feff}# Árbol\r\nñ".as_bytes()),
            "f2640117246f20208901709f485d4aacd020fbecd70955d896a4da8452d7da2a"
        );
    }

    /// Concurrencia bajo el turno: N hilos guardan a la vez la misma nota con la
    /// MISMA base. La comparación y la escritura van en el mismo turno, así que
    /// exactamente uno escribe; los demás ven el disco cambiado (ya no tiene la
    /// base ni su texto) y reportan conflicto sin escribir. Sin el turno, dos
    /// podían comparar contra la base antes de que el primero escribiera, y el
    /// segundo pisaba al primero.
    #[test]
    fn guardados_concurrentes_con_la_misma_base_escribe_uno_solo() {
        const HILOS: usize = 12;
        let base = tmp_vault("guardar-concurrentes");
        let v = base.to_string_lossy().to_string();
        escribir_nota_en(v.clone(), "n.md".into(), "base".into()).unwrap();
        let h_base = huella_de(b"base");
        let barrera = Arc::new(std::sync::Barrier::new(HILOS));
        let hilos: Vec<_> = (0..HILOS)
            .map(|i| {
                let (v, h, barrera) = (v.clone(), h_base.clone(), barrera.clone());
                std::thread::spawn(move || {
                    let contenido = format!("hilo {i}\n").repeat(20_000);
                    barrera.wait();
                    let r = guardar_nota_en(v, "n.md".into(), contenido.clone(), Some(h)).unwrap();
                    (r.conflicto, contenido)
                })
            })
            .collect();
        let resultados: Vec<(bool, String)> = hilos.into_iter().map(|h| h.join().unwrap()).collect();
        let ganadores: Vec<&String> = resultados.iter().filter(|(c, _)| !c).map(|(_, t)| t).collect();
        assert_eq!(ganadores.len(), 1, "exactamente un guardado escribe");
        assert_eq!(&std::fs::read_to_string(base.join("n.md")).unwrap(), ganadores[0]);
        let nombres: Vec<String> = std::fs::read_dir(&base)
            .unwrap()
            .map(|e| e.unwrap().file_name().to_string_lossy().to_string())
            .collect();
        assert_eq!(nombres, vec!["n.md".to_string()], "sobraron temporales");
        assert!(!candados().lock().unwrap().contains_key(&base.join("n.md")));
        std::fs::remove_dir_all(&base).unwrap();
    }

    #[test]
    fn todos_rechazan_path_traversal() {
        let base = tmp_vault("traversal");
        let v = base.to_string_lossy().to_string();
        assert!(escribir_nota_en(v.clone(), "../fuera.md".into(), "x".into()).is_err());
        assert!(mover_ruta_en(v.clone(), "../a.md".into(), "b.md".into()).is_err());
        assert!(mover_ruta_en(v.clone(), "a.md".into(), "../b.md".into()).is_err());
        assert!(crear_directorio_en(v.clone(), "../hack".into()).is_err());
        assert!(copiar_archivo_en(v.clone(), "../a.md".into(), "b.md".into()).is_err());
        assert!(borrar_a_papelera_en(v.clone(), "/etc/passwd".into()).is_err());
        assert!(restaurar_de_papelera_en(v.clone(), "../x".into(), "y.md".into()).is_err());
        assert!(borrar_definitivo_en(v.clone(), "../../x".into()).is_err());
        std::fs::remove_dir_all(&base).unwrap();
    }
}
