//! Diccionarios del corrector ortográfico (`FUN-L-12`): descarga, verificación
//! y lectura.
//!
//! Los diccionarios Hunspell **no van en el instalador**: se publican en R2,
//! junto a los instaladores, con un manifiesto (`diccionarios/manifiesto.json`,
//! lo arma `scripts/publicar-diccionarios.mjs`), y el usuario elige cuáles bajar
//! en Configuración. Acá vive la parte que toca la red y el disco; qué significa
//! el manifiesto y qué diccionario corresponde a cada idioma lo decide el
//! frontend (`lib/ortografia/manifiesto.ts`).
//!
//! **Dónde**: `%LOCALAPPDATA%\<identificador>\diccionarios\<id>\<version>\`
//! (`app_local_data_dir`). Son de la **instalación**, no del vault —un vault no
//! debería cargar con 1 MB de diccionario por idioma— y no van a la carpeta
//! *roaming*, que Windows sincroniza entre máquinas.
//!
//! **Cómo**: cada archivo llega en gzip y se descomprime **mientras baja**, a
//! una carpeta `<version>.part`, calculando el `sha256` de lo descomprimido. Solo
//! si los dos hashes coinciden con el manifiesto la carpeta se renombra a
//! `<version>`, y recién entonces se borran las versiones anteriores. Una
//! descarga cortada, cancelada o con un hash que no coincide borra su `.part` y
//! deja intacto lo que había: nunca queda un diccionario a medias en uso.
//!
//! La petición la hace `reqwest`, como el updater: sin CORS que configurar en el
//! bucket para desktop. Para desarrollo, la URL del manifiesto puede ser una
//! carpeta local (ver `url_manifiesto`).
//!
//! También guarda el **diccionario de Mycelium** (`diccionario-personal.txt`):
//! las palabras que el usuario agrega para todos sus vaults. Ese va en la
//! carpeta de **configuración** de la app, junto a `vaults.json`, y no junto a
//! los diccionarios descargados: son palabras del usuario y tienen que
//! sobrevivir a que se borre o se actualice un diccionario.

use std::collections::HashMap;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::{Emitter, Manager};

use crate::vault_fs::escribir_atomico;

/// Carpeta, dentro de `app_local_data_dir`, con un subdirectorio por diccionario.
const DIR: &str = "diccionarios";
/// Estado del corrector en la instalación (idiomas activos, propuesta hecha…).
/// El contenido es opaco para Rust salvo `urlManifiesto`, que se lee acá.
const CONFIG: &str = "config.json";
/// Sufijo de la carpeta de una descarga en curso.
const PARCIAL: &str = ".part";

/// El manifiesto publicado, junto a los instaladores del updater (mismo bucket).
const MANIFIESTO_DEFECTO: &str =
    "https://pub-4a4b6d7b99be4917a2fe0074be9dfa40.r2.dev/diccionarios/manifiesto.json";
/// Variable de entorno para apuntar a otro manifiesto en desarrollo: una URL
/// (`http://localhost:8080/manifiesto.json`, `file:///C:/…/manifiesto.json`) o
/// una carpeta local (`C:\…\frontend\.diccionarios`).
const VARIABLE_MANIFIESTO: &str = "MYCELIUM_DICCIONARIOS";

/// El diccionario de Mycelium, en `app_config_dir` (junto a `vaults.json`). Una
/// palabra por renglón; el formato lo decide el frontend (`palabras.ts`).
const PERSONAL: &str = "diccionario-personal.txt";
/// Evento cuando cambia el diccionario de Mycelium: las demás ventanas releen
/// sus palabras (sin recargar los diccionarios descargados).
const EVENTO_PERSONAL: &str = "diccionario-personal-cambiado";

/// Evento con el avance de una descarga.
const EVENTO_PROGRESO: &str = "diccionarios-progreso";
/// Evento cuando cambia lo descargado o la configuración: todas las ventanas
/// recargan su corrector.
const EVENTO_CAMBIOS: &str = "diccionarios-cambiados";

/// Mensaje de una descarga cancelada por el usuario. El frontend lo reconoce
/// para no mostrarlo como error.
const CANCELADA: &str = "Descarga cancelada.";

/// Cada cuántos bytes descargados se avisa el avance (un evento por trozo de
/// red serían cientos por segundo).
const PASO_PROGRESO: u64 = 32 * 1024;

// ── Estado ──────────────────────────────────────────────────────────────────

/// Descargas en curso: id → bandera de cancelación.
#[derive(Default)]
pub struct DescargasState(Mutex<HashMap<String, Arc<AtomicBool>>>);

/// Quita la descarga del estado al terminar, pase lo que pase (también si la
/// tarea termina por un `?`).
struct EnCurso<'a> {
    estado: &'a DescargasState,
    id: String,
}

impl Drop for EnCurso<'_> {
    fn drop(&mut self) {
        self.estado.0.lock().unwrap().remove(&self.id);
    }
}

// ── Tipos ───────────────────────────────────────────────────────────────────

/// Lo que pide el frontend: una variante del manifiesto, con sus URLs ya
/// resueltas.
#[derive(Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PedidoDescarga {
    id: String,
    version: String,
    aff: String,
    dic: String,
    sha256_aff: String,
    sha256_dic: String,
    licencia: String,
    /// Tamaño anunciado de la descarga (los dos `.gz`), para el progreso.
    bytes: u64,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Descargado {
    id: String,
    version: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct Progreso {
    id: String,
    descargado: u64,
    total: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ManifiestoCrudo {
    /// De dónde se leyó: las URLs relativas del manifiesto se resuelven contra esta.
    url: String,
    contenido: String,
}

// ── Rutas y validación ──────────────────────────────────────────────────────

fn base(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_local_data_dir()
        .map_err(|e| format!("No se encontró la carpeta de datos de la app: {e}"))?
        .join(DIR))
}

/// `es-AR`, `en-US`, `es-419`: el id llega del frontend y se usa como nombre de
/// carpeta, así que se valida estricto (nada de `..` ni separadores).
fn id_valido(id: &str) -> bool {
    let mut partes = id.split('-');
    let (Some(lengua), Some(region), None) = (partes.next(), partes.next(), partes.next()) else {
        return false;
    };
    (2..=3).contains(&lengua.len())
        && lengua.chars().all(|c| c.is_ascii_lowercase())
        && (2..=3).contains(&region.len())
        && region.chars().all(|c| c.is_ascii_uppercase() || c.is_ascii_digit())
}

/// `X.Y.Z` con números: también es un nombre de carpeta.
fn version_valida(v: &str) -> bool {
    let partes: Vec<&str> = v.split('.').collect();
    partes.len() == 3 && partes.iter().all(|p| !p.is_empty() && p.chars().all(|c| c.is_ascii_digit()))
}

fn sha_valido(s: &str) -> bool {
    s.len() == 64 && s.chars().all(|c| c.is_ascii_hexdigit())
}

/// La URL del manifiesto: la variable de entorno, o `urlManifiesto` en
/// `config.json`, o la publicada. Una carpeta o ruta local se convierte en
/// `file://`, y a una carpeta se le agrega `manifiesto.json`.
fn url_manifiesto(config: Option<&str>) -> String {
    let elegida = std::env::var(VARIABLE_MANIFIESTO)
        .ok()
        .filter(|v| !v.trim().is_empty())
        .or_else(|| {
            config
                .and_then(|c| serde_json::from_str::<serde_json::Value>(c).ok())
                .and_then(|v| v.get("urlManifiesto").and_then(|u| u.as_str()).map(str::to_string))
                .filter(|v| !v.trim().is_empty())
        })
        .unwrap_or_else(|| MANIFIESTO_DEFECTO.to_string());
    normalizar_url_manifiesto(elegida.trim())
}

fn normalizar_url_manifiesto(valor: &str) -> String {
    let es_url = valor.starts_with("http://") || valor.starts_with("https://") || valor.starts_with("file:");
    let url = if es_url {
        valor.to_string()
    } else {
        // Una ruta del disco. `from_file_path` la escapa bien (espacios, tildes).
        match tauri::Url::from_file_path(valor) {
            Ok(u) => u.to_string(),
            Err(()) => valor.to_string(),
        }
    };
    if url.ends_with(".json") {
        url
    } else {
        format!("{}/manifiesto.json", url.trim_end_matches('/'))
    }
}

// ── Lectura de una URL (http o archivo local) ───────────────────────────────

/// El origen de una descarga: la red, o un archivo local cuando el manifiesto
/// apunta a una carpeta (desarrollo).
enum Fuente {
    Red(reqwest::Response),
    Archivo(std::fs::File),
}

impl Fuente {
    async fn abrir(url: &str) -> Result<Fuente, String> {
        if url.starts_with("file:") {
            let ruta = tauri::Url::parse(url)
                .ok()
                .and_then(|u| u.to_file_path().ok())
                .ok_or_else(|| format!("Ruta local inválida: {url}"))?;
            let archivo = std::fs::File::open(&ruta)
                .map_err(|e| format!("No se pudo abrir {}: {e}", ruta.display()))?;
            return Ok(Fuente::Archivo(archivo));
        }
        // Como en `actualizador::pedir_json`: reqwest viene sin proveedor TLS
        // fijado y hay que instalarlo antes de la primera conexión propia.
        if rustls::crypto::CryptoProvider::get_default().is_none() {
            let _ = rustls::crypto::ring::default_provider().install_default();
        }
        let respuesta = reqwest::Client::builder()
            .build()
            .map_err(|e| format!("No se pudo crear el cliente HTTP: {e}"))?
            .get(url)
            .send()
            .await
            .map_err(|e| format!("No se pudo conectar ({url}): {e}"))?;
        if !respuesta.status().is_success() {
            return Err(format!("El servidor respondió {} al pedir {url}", respuesta.status()));
        }
        Ok(Fuente::Red(respuesta))
    }

    /// El siguiente trozo, o `None` al terminar.
    async fn trozo(&mut self) -> Result<Option<Vec<u8>>, String> {
        match self {
            Fuente::Red(r) => r
                .chunk()
                .await
                .map(|c| c.map(|b| b.to_vec()))
                .map_err(|e| format!("Se cortó la descarga: {e}")),
            Fuente::Archivo(f) => {
                use std::io::Read;
                let mut buf = vec![0u8; 64 * 1024];
                let n = f.read(&mut buf).map_err(|e| format!("No se pudo leer: {e}"))?;
                buf.truncate(n);
                Ok(if n == 0 { None } else { Some(buf) })
            }
        }
    }

    async fn texto(mut self) -> Result<String, String> {
        let mut todo = Vec::new();
        while let Some(t) = self.trozo().await? {
            todo.extend_from_slice(&t);
        }
        String::from_utf8(todo).map_err(|_| "El manifiesto no es texto UTF-8.".to_string())
    }
}

/// Escribe en un archivo y calcula el `sha256` de lo escrito.
struct EscritorConHash {
    archivo: std::fs::File,
    hash: Sha256,
}

impl Write for EscritorConHash {
    fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
        let n = self.archivo.write(buf)?;
        self.hash.update(&buf[..n]);
        Ok(n)
    }
    fn flush(&mut self) -> std::io::Result<()> {
        self.archivo.flush()
    }
}

/// Cómo se guarda lo que llega: descomprimiendo el gzip o tal cual (la licencia).
enum Destino {
    Gzip(flate2::write::GzDecoder<EscritorConHash>),
    Plano(EscritorConHash),
}

impl Destino {
    fn nuevo(ruta: &Path, gzip: bool) -> Result<Destino, String> {
        let archivo = std::fs::File::create(ruta)
            .map_err(|e| format!("No se pudo crear {}: {e}", ruta.display()))?;
        let w = EscritorConHash { archivo, hash: Sha256::new() };
        Ok(if gzip { Destino::Gzip(flate2::write::GzDecoder::new(w)) } else { Destino::Plano(w) })
    }

    fn escribir(&mut self, datos: &[u8]) -> Result<(), String> {
        match self {
            Destino::Gzip(d) => d.write_all(datos).map_err(|e| format!("El archivo no es un gzip válido: {e}")),
            Destino::Plano(w) => w.write_all(datos).map_err(|e| format!("No se pudo escribir: {e}")),
        }
    }

    /// Cierra el archivo y devuelve el `sha256` (hex) de lo escrito.
    fn terminar(self) -> Result<String, String> {
        let mut w = match self {
            Destino::Gzip(d) => d.finish().map_err(|e| format!("El gzip está incompleto: {e}"))?,
            Destino::Plano(w) => w,
        };
        w.flush().map_err(|e| format!("No se pudo escribir: {e}"))?;
        Ok(format!("{:x}", w.hash.finalize()))
    }
}

/// Baja una URL a `ruta` y devuelve el `sha256` de lo guardado. `avance`
/// recibe los bytes que llegan (comprimidos: lo que mide la descarga).
async fn bajar(
    url: &str,
    ruta: &Path,
    gzip: bool,
    cancelada: &AtomicBool,
    mut avance: impl FnMut(u64),
) -> Result<String, String> {
    let mut fuente = Fuente::abrir(url).await?;
    let mut destino = Destino::nuevo(ruta, gzip)?;
    while let Some(trozo) = fuente.trozo().await? {
        if cancelada.load(Ordering::Relaxed) {
            return Err(CANCELADA.to_string());
        }
        destino.escribir(&trozo)?;
        avance(trozo.len() as u64);
    }
    destino.terminar()
}

// ── Comandos ────────────────────────────────────────────────────────────────

/// Lee el manifiesto de diccionarios. Un fallo de red devuelve `Err`: la
/// Configuración lo muestra como «sin conexión» y sigue con lo descargado.
#[tauri::command]
pub async fn diccionarios_manifiesto(app: tauri::AppHandle) -> Result<ManifiestoCrudo, String> {
    let config = std::fs::read_to_string(base(&app)?.join(CONFIG)).ok();
    let url = url_manifiesto(config.as_deref());
    let contenido = Fuente::abrir(&url).await?.texto().await?;
    Ok(ManifiestoCrudo { url, contenido })
}

/// Los diccionarios descargados y completos (sin las descargas a medias).
#[tauri::command]
pub fn diccionarios_listar(app: tauri::AppHandle) -> Result<Vec<Descargado>, String> {
    Ok(listar_en(&base(&app)?))
}

fn listar_en(base: &Path) -> Vec<Descargado> {
    let mut lista = Vec::new();
    let Ok(ids) = std::fs::read_dir(base) else { return lista };
    for entrada in ids.flatten() {
        let id = entrada.file_name().to_string_lossy().to_string();
        if !id_valido(&id) || !entrada.path().is_dir() {
            continue;
        }
        let Ok(versiones) = std::fs::read_dir(entrada.path()) else { continue };
        let mejor = versiones
            .flatten()
            .map(|v| v.file_name().to_string_lossy().to_string())
            .filter(|v| version_valida(v))
            .filter(|v| {
                let dir = entrada.path().join(v);
                dir.join(format!("{id}.aff")).is_file() && dir.join(format!("{id}.dic")).is_file()
            })
            .max_by_key(|v| v.split('.').map(|n| n.parse::<u64>().unwrap_or(0)).collect::<Vec<_>>());
        if let Some(version) = mejor {
            lista.push(Descargado { id, version });
        }
    }
    lista.sort_by(|a, b| a.id.cmp(&b.id));
    lista
}

/// Descarga una variante, la verifica y la deja lista. Emite
/// `diccionarios-progreso` mientras baja y `diccionarios-cambiados` al terminar.
#[tauri::command]
pub async fn diccionarios_descargar(
    app: tauri::AppHandle,
    estado: tauri::State<'_, DescargasState>,
    pedido: PedidoDescarga,
) -> Result<(), String> {
    if !id_valido(&pedido.id) || !version_valida(&pedido.version) {
        return Err(format!("Diccionario inválido: {} {}", pedido.id, pedido.version));
    }
    if !sha_valido(&pedido.sha256_aff) || !sha_valido(&pedido.sha256_dic) {
        return Err("El manifiesto no trae un sha256 válido para este diccionario.".into());
    }
    let cancelada = Arc::new(AtomicBool::new(false));
    {
        let mut en_curso = estado.0.lock().unwrap();
        if en_curso.contains_key(&pedido.id) {
            return Err("Ese diccionario ya se está descargando.".into());
        }
        en_curso.insert(pedido.id.clone(), cancelada.clone());
    }
    let _guardia = EnCurso { estado: &estado, id: pedido.id.clone() };

    let dir = base(&app)?.join(&pedido.id);
    let parcial = dir.join(format!("{}{PARCIAL}", pedido.version));
    let app_evt = app.clone();
    let emitir = move |p: Progreso| {
        let _ = app_evt.emit(EVENTO_PROGRESO, p);
    };
    let resultado = descargar_en(&pedido, &dir, &parcial, &cancelada, emitir).await;
    if resultado.is_err() {
        // Lo a medias se borra; la versión anterior, si había, sigue intacta.
        let _ = std::fs::remove_dir_all(&parcial);
    }
    resultado?;
    let _ = app.emit(EVENTO_CAMBIOS, ());
    Ok(())
}

async fn descargar_en(
    pedido: &PedidoDescarga,
    dir: &Path,
    parcial: &Path,
    cancelada: &AtomicBool,
    emitir: impl Fn(Progreso),
) -> Result<(), String> {
    let _ = std::fs::remove_dir_all(parcial);
    std::fs::create_dir_all(parcial)
        .map_err(|e| format!("No se pudo crear {}: {e}", parcial.display()))?;

    let total = pedido.bytes;
    let mut descargado: u64 = 0;
    let mut avisado: u64 = 0;
    let id = pedido.id.clone();
    let mut avance = |n: u64| {
        descargado += n;
        if descargado - avisado >= PASO_PROGRESO {
            avisado = descargado;
            emitir(Progreso { id: id.clone(), descargado, total });
        }
    };

    for (url, esperado, ext) in [
        (&pedido.aff, &pedido.sha256_aff, "aff"),
        (&pedido.dic, &pedido.sha256_dic, "dic"),
    ] {
        let ruta = parcial.join(format!("{}.{ext}", pedido.id));
        let hash = bajar(url, &ruta, true, cancelada, &mut avance).await?;
        if !hash.eq_ignore_ascii_case(esperado) {
            return Err(format!(
                "El .{ext} descargado no coincide con el publicado (sha256 distinto): se descartó."
            ));
        }
    }
    // La licencia acompaña al diccionario (lo exigen la GPL y la LGPL). Sin
    // hash: es texto informativo, no algo que se ejecute ni se interprete.
    bajar(&pedido.licencia, &parcial.join("LICENSE.txt"), false, cancelada, |_| {}).await?;
    emitir(Progreso { id: pedido.id.clone(), descargado: total.max(descargado), total });

    activar(dir, parcial, &pedido.version)
}

/// Renombra `<version>.part` a `<version>` y borra las demás versiones. Solo se
/// llama con los hashes ya verificados.
fn activar(dir: &Path, parcial: &Path, version: &str) -> Result<(), String> {
    let final_ = dir.join(version);
    if final_.exists() {
        std::fs::remove_dir_all(&final_)
            .map_err(|e| format!("No se pudo reemplazar {}: {e}", final_.display()))?;
    }
    std::fs::rename(parcial, &final_)
        .map_err(|e| format!("No se pudo activar el diccionario: {e}"))?;
    if let Ok(entradas) = std::fs::read_dir(dir) {
        for e in entradas.flatten() {
            if e.file_name().to_string_lossy() != version {
                let _ = std::fs::remove_dir_all(e.path());
            }
        }
    }
    Ok(())
}

/// Pide cancelar una descarga en curso. La descarga termina con `CANCELADA`.
#[tauri::command]
pub fn diccionarios_cancelar(estado: tauri::State<'_, DescargasState>, id: String) {
    if let Some(bandera) = estado.0.lock().unwrap().get(&id) {
        bandera.store(true, Ordering::Relaxed);
    }
}

/// Borra un diccionario del disco (todas sus versiones).
#[tauri::command]
pub fn diccionarios_borrar(app: tauri::AppHandle, id: String) -> Result<(), String> {
    if !id_valido(&id) {
        return Err(format!("Diccionario inválido: {id}"));
    }
    let dir = base(&app)?.join(&id);
    match std::fs::remove_dir_all(&dir) {
        Ok(()) => {}
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
        Err(e) => return Err(format!("No se pudo borrar {}: {e}", dir.display())),
    }
    let _ = app.emit(EVENTO_CAMBIOS, ());
    Ok(())
}

/// Los bytes de un archivo de un diccionario descargado (`aff`, `dic` o
/// `licencia`). Van **crudos** (`ipc::Response`), no como un arreglo JSON de
/// números: el `.dic` del español pesa ~1 MB.
#[tauri::command]
pub fn diccionarios_leer(
    app: tauri::AppHandle,
    id: String,
    version: String,
    archivo: String,
) -> Result<tauri::ipc::Response, String> {
    if !id_valido(&id) || !version_valida(&version) {
        return Err(format!("Diccionario inválido: {id} {version}"));
    }
    let nombre = match archivo.as_str() {
        "aff" => format!("{id}.aff"),
        "dic" => format!("{id}.dic"),
        "licencia" => "LICENSE.txt".to_string(),
        _ => return Err(format!("Archivo de diccionario desconocido: {archivo}")),
    };
    let ruta = base(&app)?.join(&id).join(&version).join(nombre);
    std::fs::read(&ruta)
        .map(tauri::ipc::Response::new)
        .map_err(|e| format!("No se pudo leer {}: {e}", ruta.display()))
}

/// La configuración del corrector en esta instalación, o `None` si no hay.
#[tauri::command]
pub fn diccionarios_config_leer(app: tauri::AppHandle) -> Result<Option<String>, String> {
    Ok(std::fs::read_to_string(base(&app)?.join(CONFIG)).ok())
}

/// Guarda la configuración (opaca: el esquema lo decide el frontend) y avisa a
/// las demás ventanas.
#[tauri::command]
pub fn diccionarios_config_escribir(app: tauri::AppHandle, contenido: String) -> Result<(), String> {
    let dir = base(&app)?;
    std::fs::create_dir_all(&dir).map_err(|e| format!("No se pudo crear {}: {e}", dir.display()))?;
    escribir_atomico(&dir.join(CONFIG), &contenido)?;
    let _ = app.emit(EVENTO_CAMBIOS, ());
    Ok(())
}

// ── Diccionario de Mycelium ─────────────────────────────────────────────────

fn ruta_personal(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_config_dir()
        .map_err(|e| format!("No se encontró la carpeta de configuración de la app: {e}"))?
        .join(PERSONAL))
}

/// El contenido del archivo, o `None` si todavía no existe. Pura, testeable.
fn leer_personal(ruta: &Path) -> Result<Option<String>, String> {
    match std::fs::read_to_string(ruta) {
        Ok(t) => Ok(Some(t)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        // Ilegible (permisos, no es UTF-8): se avisa en vez de tratarlo como
        // vacío, porque el próximo «Agregar» lo reescribiría y perdería todo.
        Err(e) => Err(format!("No se pudo leer {}: {e}", ruta.display())),
    }
}

/// Escribe el archivo entero, atómico: un corte a mitad no deja el diccionario
/// truncado. Crea la carpeta si falta (en una instalación nueva, antes de
/// vincular el primer vault, puede no existir). Pura, testeable.
fn escribir_personal(ruta: &Path, contenido: &str) -> Result<(), String> {
    if let Some(dir) = ruta.parent() {
        std::fs::create_dir_all(dir).map_err(|e| format!("No se pudo crear {}: {e}", dir.display()))?;
    }
    escribir_atomico(ruta, contenido)
}

/// Las palabras del diccionario de Mycelium (texto crudo), o `None` si no hay.
#[tauri::command]
pub fn diccionario_personal_leer(app: tauri::AppHandle) -> Result<Option<String>, String> {
    leer_personal(&ruta_personal(&app)?)
}

/// Guarda el diccionario de Mycelium y avisa a todas las ventanas.
#[tauri::command]
pub fn diccionario_personal_escribir(app: tauri::AppHandle, contenido: String) -> Result<(), String> {
    escribir_personal(&ruta_personal(&app)?, &contenido)?;
    let _ = app.emit(EVENTO_PERSONAL, ());
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use flate2::write::GzEncoder;
    use flate2::Compression;

    fn temporal(nombre: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("mic-dicc-{nombre}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn gzip(datos: &[u8]) -> Vec<u8> {
        let mut e = GzEncoder::new(Vec::new(), Compression::default());
        e.write_all(datos).unwrap();
        e.finish().unwrap()
    }

    fn sha(datos: &[u8]) -> String {
        format!("{:x}", Sha256::digest(datos))
    }

    fn url_de(ruta: &Path) -> String {
        tauri::Url::from_file_path(ruta).unwrap().to_string()
    }

    fn bloquear<F: std::future::Future>(f: F) -> F::Output {
        tauri::async_runtime::block_on(f)
    }

    #[test]
    fn los_ids_y_versiones_raros_se_rechazan() {
        for ok in ["es-AR", "en-US", "es-419", "it-IT"] {
            assert!(id_valido(ok), "{ok}");
        }
        for mal in ["es", "../x", "es-AR-x", "ES-AR", "es-ar", "es/AR", "", "es-"] {
            assert!(!id_valido(mal), "{mal}");
        }
        assert!(version_valida("1.0.0"));
        for mal in ["1.0", "1.0.0.0", "..", "1.a.0", "1..0"] {
            assert!(!version_valida(mal), "{mal}");
        }
    }

    #[test]
    fn la_url_del_manifiesto_admite_carpetas_locales() {
        assert_eq!(normalizar_url_manifiesto("https://x.dev/diccionarios/manifiesto.json"), "https://x.dev/diccionarios/manifiesto.json");
        assert_eq!(normalizar_url_manifiesto("http://localhost:8080/"), "http://localhost:8080/manifiesto.json");
        let dir = temporal("url");
        let u = normalizar_url_manifiesto(&dir.to_string_lossy());
        assert!(u.starts_with("file:///") && u.ends_with("/manifiesto.json"), "{u}");
        // La del config.json, si no hay variable de entorno.
        if std::env::var(VARIABLE_MANIFIESTO).is_err() {
            assert_eq!(url_manifiesto(Some(r#"{"urlManifiesto":"http://h/m.json"}"#)), "http://h/m.json");
            assert_eq!(url_manifiesto(Some("{}")), MANIFIESTO_DEFECTO);
            assert_eq!(url_manifiesto(None), MANIFIESTO_DEFECTO);
        }
    }

    #[test]
    fn baja_descomprime_y_calcula_el_hash_de_lo_descomprimido() {
        let dir = temporal("bajar");
        let original = b"SET UTF-8\nTRY abc\n".repeat(500);
        let gz = dir.join("x.aff.gz");
        std::fs::write(&gz, gzip(&original)).unwrap();
        let destino = dir.join("x.aff");
        let mut visto = 0;
        let hash = bloquear(bajar(&url_de(&gz), &destino, true, &AtomicBool::new(false), |n| visto += n)).unwrap();
        assert_eq!(hash, sha(&original));
        assert_eq!(std::fs::read(&destino).unwrap(), original);
        assert_eq!(visto, std::fs::metadata(&gz).unwrap().len(), "el avance cuenta lo comprimido");
    }

    #[test]
    fn un_gzip_cortado_falla() {
        let dir = temporal("cortado");
        let mut gz = gzip(&b"palabra\n".repeat(2000));
        gz.truncate(gz.len() / 2);
        let ruta = dir.join("x.dic.gz");
        std::fs::write(&ruta, gz).unwrap();
        let r = bloquear(bajar(&url_de(&ruta), &dir.join("x.dic"), true, &AtomicBool::new(false), |_| {}));
        assert!(r.is_err());
    }

    #[test]
    fn una_descarga_cancelada_falla_con_el_mensaje_propio() {
        let dir = temporal("cancelada");
        let ruta = dir.join("x.dic.gz");
        std::fs::write(&ruta, gzip(b"hola\n")).unwrap();
        let r = bloquear(bajar(&url_de(&ruta), &dir.join("x.dic"), true, &AtomicBool::new(true), |_| {}));
        assert_eq!(r.unwrap_err(), CANCELADA);
    }

    #[test]
    fn activar_reemplaza_la_version_anterior_y_listar_ignora_lo_parcial() {
        let base = temporal("activar");
        let dir = base.join("es-AR");
        let vieja = dir.join("1.0.0");
        std::fs::create_dir_all(&vieja).unwrap();
        std::fs::write(vieja.join("es-AR.aff"), "a").unwrap();
        std::fs::write(vieja.join("es-AR.dic"), "d").unwrap();
        // Una descarga a medias de la nueva: no cuenta todavía.
        let parcial = dir.join("1.1.0.part");
        std::fs::create_dir_all(&parcial).unwrap();
        std::fs::write(parcial.join("es-AR.aff"), "a2").unwrap();
        std::fs::write(parcial.join("es-AR.dic"), "d2").unwrap();
        // Ni una carpeta con nombre inválido.
        std::fs::create_dir_all(base.join("..raro")).unwrap();
        assert_eq!(listar_en(&base), vec![Descargado { id: "es-AR".into(), version: "1.0.0".into() }]);

        activar(&dir, &parcial, "1.1.0").unwrap();
        assert_eq!(listar_en(&base), vec![Descargado { id: "es-AR".into(), version: "1.1.0".into() }]);
        assert!(!vieja.exists(), "la versión anterior se borra al activar la nueva");
        assert_eq!(std::fs::read_to_string(dir.join("1.1.0").join("es-AR.dic")).unwrap(), "d2");
    }

    /// Publica una variante en una carpeta «servidor» y devuelve el pedido.
    fn publicar(servidor: &Path, aff: &[u8], dic: &[u8]) -> PedidoDescarga {
        let v = servidor.join("es-AR").join("1.0.0");
        std::fs::create_dir_all(&v).unwrap();
        std::fs::write(v.join("es-AR.aff.gz"), gzip(aff)).unwrap();
        std::fs::write(v.join("es-AR.dic.gz"), gzip(dic)).unwrap();
        std::fs::write(v.join("LICENSE.txt"), "GPL/LGPL/MPL").unwrap();
        PedidoDescarga {
            id: "es-AR".into(),
            version: "1.0.0".into(),
            aff: url_de(&v.join("es-AR.aff.gz")),
            dic: url_de(&v.join("es-AR.dic.gz")),
            sha256_aff: sha(aff),
            sha256_dic: sha(dic),
            licencia: url_de(&v.join("LICENSE.txt")),
            bytes: 100,
        }
    }

    #[test]
    fn una_descarga_completa_queda_activa_con_su_licencia() {
        let raiz = temporal("completa");
        let pedido = publicar(&raiz.join("servidor"), b"SET UTF-8\n", b"1\ncasa\n");
        let dir = raiz.join("local").join("es-AR");
        let parcial = dir.join("1.0.0.part");
        let avisos = std::cell::Cell::new(0);
        bloquear(descargar_en(&pedido, &dir, &parcial, &AtomicBool::new(false), |_| avisos.set(avisos.get() + 1))).unwrap();
        assert!(!parcial.exists());
        assert_eq!(std::fs::read_to_string(dir.join("1.0.0").join("es-AR.dic")).unwrap(), "1\ncasa\n");
        assert!(dir.join("1.0.0").join("LICENSE.txt").is_file());
        assert!(avisos.get() >= 1, "al menos el aviso final del progreso");
    }

    #[test]
    fn un_hash_que_no_coincide_se_rechaza_y_conserva_la_version_anterior() {
        let raiz = temporal("hash");
        let mut pedido = publicar(&raiz.join("servidor"), b"SET UTF-8\n", b"1\ncasa\n");
        pedido.sha256_dic = sha(b"otra cosa");
        pedido.version = "1.1.0".into();
        let dir = raiz.join("local").join("es-AR");
        // La versión buena que ya estaba.
        let buena = dir.join("1.0.0");
        std::fs::create_dir_all(&buena).unwrap();
        std::fs::write(buena.join("es-AR.aff"), "a").unwrap();
        std::fs::write(buena.join("es-AR.dic"), "d").unwrap();

        let parcial = dir.join("1.1.0.part");
        let r = bloquear(descargar_en(&pedido, &dir, &parcial, &AtomicBool::new(false), |_| {}));
        assert!(r.unwrap_err().contains("sha256"));
        // `diccionarios_descargar` borra el `.part` al fallar; acá se simula.
        let _ = std::fs::remove_dir_all(&parcial);
        assert_eq!(
            listar_en(&raiz.join("local")),
            vec![Descargado { id: "es-AR".into(), version: "1.0.0".into() }]
        );
    }

    #[test]
    fn un_diccionario_sin_dic_no_se_lista() {
        let base = temporal("incompleto");
        let v = base.join("en-US").join("1.0.0");
        std::fs::create_dir_all(&v).unwrap();
        std::fs::write(v.join("en-US.aff"), "a").unwrap();
        assert!(listar_en(&base).is_empty());
    }

    #[test]
    fn personal_sin_archivo_es_none_y_se_crea_la_carpeta() {
        let base = temporal("personal");
        let ruta = base.join("config-que-no-existe").join(PERSONAL);
        assert_eq!(leer_personal(&ruta).unwrap(), None);
        escribir_personal(&ruta, "casa
Mycelium
").unwrap();
        assert_eq!(leer_personal(&ruta).unwrap().as_deref(), Some("casa
Mycelium
"));
    }

    #[test]
    fn personal_se_reescribe_entero_sin_dejar_temporales() {
        let base = temporal("personal-reescribir");
        let ruta = base.join(PERSONAL);
        escribir_personal(&ruta, "una
dos
tres
").unwrap();
        escribir_personal(&ruta, "una
").unwrap();
        assert_eq!(leer_personal(&ruta).unwrap().as_deref(), Some("una
"));
        let archivos: Vec<_> = std::fs::read_dir(&base).unwrap().flatten().map(|e| e.file_name()).collect();
        assert_eq!(archivos, vec![std::ffi::OsString::from(PERSONAL)]);
    }

    #[test]
    fn personal_ilegible_es_error_y_no_vacio() {
        // Una carpeta con el nombre del archivo: leerla falla con algo que no es
        // «no existe», y eso no debe confundirse con un diccionario vacío.
        let base = temporal("personal-ilegible");
        let ruta = base.join(PERSONAL);
        std::fs::create_dir_all(&ruta).unwrap();
        assert!(leer_personal(&ruta).is_err());
    }
}
