//! Lo que **esta máquina** decidió sobre cada vault (`DEF-164`, `DEF-169`).
//!
//! Hay ajustes que cambian lo que la app *hace*, no solo cómo se ve: los
//! snippets CSS (se inyectan en la ventana), el control por IA (abre un canal
//! por el que otro proceso maneja la app) y las herramientas de desarrollo (una
//! consola con acceso a los archivos). Hasta `DEF-164` los dos primeros vivían
//! en `.mycelium/` —dentro del vault— y por eso **viajaban con él**: un vault
//! ajeno (un zip, una carpeta compartida, un repo clonado) llegaba con sus
//! snippets aplicados y el canal de control abierto, sin que nadie en esta
//! máquina lo hubiera decidido.
//!
//! Ahora esa decisión es de la máquina: vive en `config-local.json`, en el
//! config-dir de la app (junto a `vaults.json`), con una entrada por vault. El
//! vault puede seguir trayendo el CSS de sus snippets y un `controlIa` en sus
//! preferencias —el frontend lo mantiene como espejo, para el hook de `mv`/`rm`
//! y los mensajes del servidor MCP—, pero **ninguno de los dos manda**.
//!
//! > [!important] Un vault que esta máquina nunca vio arranca con todo apagado
//! > Sin entrada en este archivo: snippets apagados, control apagado,
//! > DevTools apagadas. La entrada aparece la primera vez que el usuario
//! > enciende algo.
//!
//! ## Migración (una sola vez)
//!
//! Al primer arranque con esta versión, los vaults que ya están en
//! `vaults.json` son vaults que el usuario **ya usa** en esta máquina: lo que
//! hoy tienen encendido tiene que seguir encendido. [`migrar`] copia su
//! `controlIa` y el `activo` de sus snippets a este archivo y marca
//! `migrado`. Un vault cuya carpeta no está disponible en ese momento (un disco
//! externo desconectado) queda en `pendientes` y se migra la primera vez que se
//! lo abre. Lo que se vincule **después** de la migración ya no se migra nunca:
//! esa es justamente la puerta que había que cerrar.
//!
//! Las DevTools no se migran: el interruptor es nuevo y arranca apagado en
//! todos los vaults (decisión del usuario).
//!
//! ## Claves
//!
//! Lista cerrada, con tipo: el frontend no puede guardar nada que no sea uno
//! de los [`Cambio`]. La entrada de un vault se identifica por la **cadena
//! registrada** en `vaults.json` (la que devuelve `ventanas::vault_de`), y se
//! compara con `misma_ruta`, igual que el resto de la app.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::Manager;

use crate::vault_fs::escribir_atomico;

/// El archivo, en el config-dir de la app.
pub const ARCHIVO: &str = "config-local.json";

/// Versión del formato. Sube solo si cambia de forma incompatible.
const VERSION: u32 = 1;

/// Tope de snippets recordados por vault: un archivo `snippets.json` armado a
/// propósito no puede hacer crecer este archivo sin límite.
const MAX_SNIPPETS: usize = 1000;

/// Largo máximo del id de un snippet (los de la app son UUID: 36).
const MAX_ID: usize = 200;

/// Lo que esta máquina decidió sobre UN vault. Todo apagado por defecto.
#[derive(Serialize, Deserialize, Default, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ConfigVault {
    /// «Dejar que la IA controle Mycelium» (`DEF-169`).
    #[serde(default)]
    pub control_ia: bool,
    /// «Herramientas de desarrollo».
    #[serde(default)]
    pub devtools: bool,
    /// id del snippet → encendido (`DEF-164`). Un snippet del vault que no está
    /// acá es uno que esta máquina **nunca decidió**: va apagado y la UI lo
    /// cuenta como «traído por el vault».
    #[serde(default)]
    pub snippets: BTreeMap<String, bool>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
struct Entrada {
    ruta: String,
    #[serde(flatten)]
    config: ConfigVault,
}

/// El archivo entero.
#[derive(Serialize, Deserialize, Default, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
struct Archivo {
    #[serde(default)]
    version: u32,
    /// Si ya se copió el estado de los vaults conocidos (ver el módulo).
    #[serde(default)]
    migrado: bool,
    /// Vaults conocidos al migrar cuya carpeta no se pudo leer: se migran al
    /// abrirlos.
    #[serde(default)]
    pendientes: Vec<String>,
    #[serde(default)]
    vaults: Vec<Entrada>,
}

impl Archivo {
    fn entrada(&self, ruta: &str) -> Option<&Entrada> {
        self.vaults.iter().find(|e| mycelium_vault::rutas::misma_ruta(&e.ruta, ruta))
    }

    fn entrada_mut(&mut self, ruta: &str) -> &mut Entrada {
        if let Some(i) = self.vaults.iter().position(|e| mycelium_vault::rutas::misma_ruta(&e.ruta, ruta)) {
            return &mut self.vaults[i];
        }
        self.vaults.push(Entrada { ruta: ruta.to_string(), config: ConfigVault::default() });
        self.vaults.last_mut().expect("recién agregada")
    }

    fn config_de(&self, ruta: &str) -> ConfigVault {
        self.entrada(ruta).map(|e| e.config.clone()).unwrap_or_default()
    }
}

/// Un cambio pedido por el frontend. Es la lista cerrada de lo que se puede
/// guardar: cualquier otra forma no deserializa y el comando falla.
#[derive(Deserialize, Debug, Clone, PartialEq)]
#[serde(tag = "clave", rename_all = "camelCase")]
pub enum Cambio {
    ControlIa { valor: bool },
    Devtools { valor: bool },
    /// Encender o apagar un snippet.
    Snippet { id: String, activo: bool },
    /// El snippet se borró del vault: se olvida la decisión.
    OlvidarSnippet { id: String },
}

/// Un id de snippet razonable: no vacío, acotado y sin caracteres de control.
fn id_valido(id: &str) -> bool {
    !id.is_empty() && id.len() <= MAX_ID && !id.chars().any(char::is_control)
}

/// Aplica un cambio a la entrada de `ruta`. Pura, testeable.
fn aplicar(archivo: &mut Archivo, ruta: &str, cambio: &Cambio) -> Result<(), String> {
    let entrada = archivo.entrada_mut(ruta);
    match cambio {
        Cambio::ControlIa { valor } => entrada.config.control_ia = *valor,
        Cambio::Devtools { valor } => entrada.config.devtools = *valor,
        Cambio::Snippet { id, activo } => {
            if !id_valido(id) {
                return Err("Identificador de snippet inválido.".to_string());
            }
            let snippets = &mut entrada.config.snippets;
            if !snippets.contains_key(id) && snippets.len() >= MAX_SNIPPETS {
                return Err("Demasiados snippets en este vault.".to_string());
            }
            snippets.insert(id.clone(), *activo);
        }
        Cambio::OlvidarSnippet { id } => {
            entrada.config.snippets.remove(id);
        }
    }
    Ok(())
}

// ── Lo que había en el vault (para migrar) ──────────────────────────────────

/// Lo que el vault de `raiz` tiene encendido hoy según sus archivos de
/// `.mycelium/`, con la misma lectura que hacía el frontend antes de `DEF-164`:
/// `controlIa === true` y `activo !== false` por snippet. `None` si la carpeta
/// no está (no se puede saber; se reintenta al abrirlo).
fn estado_en_el_vault(raiz: &Path) -> Option<ConfigVault> {
    if !raiz.is_dir() {
        return None;
    }
    let dir = raiz.join(".mycelium");
    let json = |nombre: &str| -> Option<serde_json::Value> {
        serde_json::from_str(&std::fs::read_to_string(dir.join(nombre)).ok()?).ok()
    };
    let control_ia = json("preferencias.json")
        .and_then(|v| v.get("controlIa").and_then(serde_json::Value::as_bool))
        .unwrap_or(false);
    let mut snippets = BTreeMap::new();
    if let Some(lista) = json("snippets.json").and_then(|v| v.get("snippets").cloned()) {
        for s in lista.as_array().into_iter().flatten() {
            let (Some(id), Some(_)) = (s.get("id").and_then(|x| x.as_str()), s.get("contenido").and_then(|x| x.as_str())) else {
                continue;
            };
            if !id_valido(id) || snippets.len() >= MAX_SNIPPETS {
                continue;
            }
            let activo = s.get("activo").and_then(serde_json::Value::as_bool) != Some(false);
            snippets.insert(id.to_string(), activo);
        }
    }
    Some(ConfigVault { control_ia, devtools: false, snippets })
}

/// La migración de una vez (ver el módulo). `conocidos`: las rutas de
/// `vaults.json`. Devuelve `true` si cambió algo (hay que guardar).
fn migrar(archivo: &mut Archivo, conocidos: &[String], leer: impl Fn(&Path) -> Option<ConfigVault>) -> bool {
    if archivo.migrado {
        return false;
    }
    for ruta in conocidos {
        if archivo.entrada(ruta).is_some() {
            continue;
        }
        match leer(Path::new(ruta)) {
            Some(config) => archivo.vaults.push(Entrada { ruta: ruta.clone(), config }),
            None => {
                if !archivo.pendientes.iter().any(|p| mycelium_vault::rutas::misma_ruta(p, ruta)) {
                    archivo.pendientes.push(ruta.clone());
                }
            }
        }
    }
    archivo.migrado = true;
    archivo.version = VERSION;
    true
}

/// Si `ruta` quedó pendiente en la migración y ahora se puede leer, la migra.
/// Devuelve `true` si cambió algo.
fn migrar_pendiente(archivo: &mut Archivo, ruta: &str, leer: impl Fn(&Path) -> Option<ConfigVault>) -> bool {
    let Some(i) = archivo.pendientes.iter().position(|p| mycelium_vault::rutas::misma_ruta(p, ruta)) else {
        return false;
    };
    let Some(config) = leer(Path::new(ruta)) else {
        return false;
    };
    archivo.pendientes.remove(i);
    if archivo.entrada(ruta).is_none() {
        archivo.vaults.push(Entrada { ruta: ruta.to_string(), config });
    }
    true
}

// ── Disco ───────────────────────────────────────────────────────────────────

/// Serializa las lecturas-modificaciones-escrituras: hay una ventana por vault
/// y todas escriben el mismo archivo.
static CANDADO: Mutex<()> = Mutex::new(());

/// Archivo ausente o ilegible → vacío (y sin migrar). Uno ilegible se rehace
/// entero en la próxima escritura: perder estas decisiones solo apaga cosas,
/// que es el lado seguro.
fn leer_archivo(ruta: &Path) -> Archivo {
    std::fs::read_to_string(ruta)
        .ok()
        .and_then(|t| serde_json::from_str(&t).ok())
        .unwrap_or_default()
}

fn escribir_archivo(ruta: &Path, archivo: &Archivo) -> Result<(), String> {
    if let Some(dir) = ruta.parent() {
        std::fs::create_dir_all(dir).map_err(|e| format!("No se pudo crear el config-dir: {e}"))?;
    }
    let json = serde_json::to_string_pretty(archivo).map_err(|e| e.to_string())?;
    escribir_atomico(ruta, &json)
}

/// Las rutas de `vaults.json` del mismo config-dir.
fn conocidos_en(dir: &Path) -> Vec<String> {
    mycelium_vault::registro::leer_registro(&dir.join(mycelium_vault::registro::ARCHIVO))
        .vaults
        .into_iter()
        .map(|v| v.ruta)
        .collect()
}

/// Carga el archivo de `dir` migrando si hace falta (y guardando la migración).
fn cargar_en(dir: &Path) -> Result<Archivo, String> {
    let ruta = dir.join(ARCHIVO);
    let mut archivo = leer_archivo(&ruta);
    if migrar(&mut archivo, &conocidos_en(dir), estado_en_el_vault) {
        escribir_archivo(&ruta, &archivo)?;
    }
    Ok(archivo)
}

/// La configuración de `ruta` (la registrada) en `dir`.
pub(crate) fn config_en(dir: &Path, ruta: &str) -> Result<ConfigVault, String> {
    let _g = CANDADO.lock().map_err(|_| "Configuración local no disponible".to_string())?;
    let mut archivo = cargar_en(dir)?;
    if migrar_pendiente(&mut archivo, ruta, estado_en_el_vault) {
        escribir_archivo(&dir.join(ARCHIVO), &archivo)?;
    }
    Ok(archivo.config_de(ruta))
}

/// Aplica `cambio` a `ruta` en `dir` y devuelve cómo quedó.
pub(crate) fn fijar_en(dir: &Path, ruta: &str, cambio: &Cambio) -> Result<ConfigVault, String> {
    let _g = CANDADO.lock().map_err(|_| "Configuración local no disponible".to_string())?;
    let mut archivo = cargar_en(dir)?;
    migrar_pendiente(&mut archivo, ruta, estado_en_el_vault);
    aplicar(&mut archivo, ruta, cambio)?;
    escribir_archivo(&dir.join(ARCHIVO), &archivo)?;
    Ok(archivo.config_de(ruta))
}

pub(crate) fn dir_config<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> Result<PathBuf, String> {
    app.path()
        .app_config_dir()
        .map_err(|e| format!("No se pudo resolver el config-dir: {e}"))
}

/// La migración, al arrancar: **antes** de que el usuario pueda vincular un
/// vault nuevo, que si no entraría a la migración como «conocido».
pub fn migrar_al_arrancar<R: tauri::Runtime>(app: &tauri::AppHandle<R>) {
    let Ok(dir) = dir_config(app) else { return };
    let Ok(_g) = CANDADO.lock() else { return };
    if let Err(e) = cargar_en(&dir) {
        log::warn!("[config-local] no se pudo migrar: {e}");
    }
}

/// La configuración del vault abierto en esta ventana, si tiene uno. Para Rust
/// (el canal de control, las DevTools): sin vault, todo apagado.
pub(crate) fn de_ventana<R: tauri::Runtime>(app: &tauri::AppHandle<R>, label: &str) -> ConfigVault {
    let ruta = app
        .state::<crate::ventanas::VentanasState>()
        .0
        .lock()
        .ok()
        .and_then(|m| m.get(label).cloned());
    match (ruta, dir_config(app)) {
        (Some(ruta), Ok(dir)) => config_en(&dir, &ruta).unwrap_or_default(),
        _ => ConfigVault::default(),
    }
}

// ── Comandos ────────────────────────────────────────────────────────────────
//
// Los dos validan `ruta` contra el vault de la ventana (`DEF-161`): una ventana
// solo lee y cambia lo de su propio vault.

/// [`config_local_leer`] sin Tauri: `ruta` tiene que ser el vault de `label`.
fn leer_para(ventanas: &crate::ventanas::VentanasState, label: &str, ruta: &str, dir: &Path) -> Result<ConfigVault, String> {
    let ruta = crate::ventanas::vault_de(ventanas, label, ruta)?;
    config_en(dir, &ruta)
}

/// [`config_local_fijar`] sin Tauri: `ruta` tiene que ser el vault de `label`.
fn fijar_para(
    ventanas: &crate::ventanas::VentanasState,
    label: &str,
    ruta: &str,
    dir: &Path,
    cambio: &Cambio,
) -> Result<ConfigVault, String> {
    let ruta = crate::ventanas::vault_de(ventanas, label, ruta)?;
    fijar_en(dir, &ruta, cambio)
}

/// Lo que esta máquina decidió sobre el vault de la ventana.
#[tauri::command]
pub fn config_local_leer(ventana: tauri::Window, ruta: String) -> Result<ConfigVault, String> {
    let dir = dir_config(ventana.app_handle())?;
    leer_para(&ventana.state::<crate::ventanas::VentanasState>(), ventana.label(), &ruta, &dir)
}

/// Cambia una decisión sobre el vault de la ventana y devuelve cómo quedó. Si
/// el cambio es de las DevTools, se aplica en el acto a esta ventana.
#[tauri::command]
pub fn config_local_fijar(ventana: tauri::Window, ruta: String, cambio: Cambio) -> Result<ConfigVault, String> {
    let dir = dir_config(ventana.app_handle())?;
    let config = fijar_para(&ventana.state::<crate::ventanas::VentanasState>(), ventana.label(), &ruta, &dir, &cambio)?;
    if matches!(cambio, Cambio::Devtools { .. }) {
        crate::devtools::aplicar_a(ventana.app_handle(), ventana.label(), config.devtools);
    }
    if matches!(cambio, Cambio::ControlIa { valor: false }) {
        // Apagado acá, el canal no puede seguir abierto aunque el frontend no
        // llegue a pedirlo.
        crate::control::detener_de(&ventana.state::<crate::control::ControlState>(), ventana.label());
    }
    Ok(config)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temporal(nombre: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("mic-config-local-{nombre}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    /// Un vault en `base/nombre` con las preferencias y los snippets dados.
    fn vault(base: &Path, nombre: &str, prefs: Option<&str>, snippets: Option<&str>) -> String {
        let raiz = base.join(nombre);
        std::fs::create_dir_all(raiz.join(".mycelium")).unwrap();
        if let Some(p) = prefs {
            std::fs::write(raiz.join(".mycelium/preferencias.json"), p).unwrap();
        }
        if let Some(s) = snippets {
            std::fs::write(raiz.join(".mycelium/snippets.json"), s).unwrap();
        }
        raiz.to_string_lossy().to_string()
    }

    fn registrar(dir: &Path, rutas: &[&str]) {
        let vaults: Vec<_> = rutas.iter().map(|r| serde_json::json!({ "ruta": r, "nombre": "x" })).collect();
        std::fs::write(dir.join("vaults.json"), serde_json::json!({ "vaults": vaults }).to_string()).unwrap();
    }

    const SNIPPETS: &str = r#"{"version":1,"snippets":[
        {"id":"a","nombre":"A","activo":true,"contenido":"x"},
        {"id":"b","nombre":"B","activo":false,"contenido":"y"},
        {"id":"c","nombre":"C","contenido":"z"}
    ]}"#;

    #[test]
    fn un_vault_nunca_visto_arranca_con_todo_apagado() {
        let dir = temporal("nunca-visto");
        registrar(&dir, &[]);
        // Un vault ajeno que trae todo encendido en su `.mycelium/`.
        let ajeno = vault(&dir, "Ajeno", Some(r#"{"controlIa":true}"#), Some(SNIPPETS));
        // La migración corre (sin vaults conocidos)…
        assert_eq!(config_en(&dir, "C:/no/importa").unwrap(), ConfigVault::default());
        // …y el ajeno, vinculado DESPUÉS, no se migra: todo apagado.
        registrar(&dir, &[&ajeno]);
        let c = config_en(&dir, &ajeno).unwrap();
        assert!(!c.control_ia && !c.devtools && c.snippets.is_empty(), "{c:?}");
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn un_vault_conocido_conserva_lo_que_tenia_encendido() {
        let dir = temporal("conocido");
        let propio = vault(&dir, "Propio", Some(r#"{"controlIa":true,"numerosDeLinea":true}"#), Some(SNIPPETS));
        let otro = vault(&dir, "Otro", None, None);
        registrar(&dir, &[&propio, &otro]);

        let c = config_en(&dir, &propio).unwrap();
        assert!(c.control_ia);
        assert!(!c.devtools, "las DevTools no se migran: arrancan apagadas");
        assert_eq!(c.snippets.get("a"), Some(&true));
        assert_eq!(c.snippets.get("b"), Some(&false));
        assert_eq!(c.snippets.get("c"), Some(&true), "sin `activo` era activo (`activo !== false`)");
        // Otra escritura de la misma ruta encuentra la misma entrada.
        assert!(config_en(&dir, &propio.to_uppercase()).unwrap().control_ia);

        let o = config_en(&dir, &otro).unwrap();
        assert_eq!(o, ConfigVault::default());

        // La migración no se repite: cambiar el vault después no cambia nada.
        std::fs::write(Path::new(&otro).join(".mycelium/preferencias.json"), r#"{"controlIa":true}"#).unwrap();
        assert!(!config_en(&dir, &otro).unwrap().control_ia);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn un_vault_no_disponible_al_migrar_se_migra_al_abrirlo() {
        let dir = temporal("pendiente");
        let raiz = dir.join("Externo");
        let ruta = raiz.to_string_lossy().to_string();
        registrar(&dir, &[&ruta]);
        // La carpeta no existe al migrar (disco desconectado).
        let _ = config_en(&dir, "C:/otra").unwrap();
        let archivo = leer_archivo(&dir.join(ARCHIVO));
        assert!(archivo.migrado);
        assert_eq!(archivo.pendientes, vec![ruta.clone()]);
        // Vuelve el disco.
        vault(&dir, "Externo", Some(r#"{"controlIa":true}"#), None);
        assert!(config_en(&dir, &ruta).unwrap().control_ia);
        assert!(leer_archivo(&dir.join(ARCHIVO)).pendientes.is_empty());
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn los_cambios_se_guardan_por_vault() {
        let dir = temporal("cambios");
        registrar(&dir, &[]);
        let a = "C:/Vaults/A";
        let b = "C:/Vaults/B";
        fijar_en(&dir, a, &Cambio::Devtools { valor: true }).unwrap();
        fijar_en(&dir, a, &Cambio::Snippet { id: "s1".into(), activo: true }).unwrap();
        let c = fijar_en(&dir, a, &Cambio::ControlIa { valor: true }).unwrap();
        assert!(c.devtools && c.control_ia && c.snippets["s1"]);
        // Encendido en A, sigue apagado en B.
        assert_eq!(config_en(&dir, b).unwrap(), ConfigVault::default());
        let c = fijar_en(&dir, a, &Cambio::OlvidarSnippet { id: "s1".into() }).unwrap();
        assert!(c.snippets.is_empty());
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn solo_entran_las_claves_conocidas() {
        let ok: Cambio = serde_json::from_str(r#"{"clave":"controlIa","valor":true}"#).unwrap();
        assert_eq!(ok, Cambio::ControlIa { valor: true });
        let ok: Cambio = serde_json::from_str(r#"{"clave":"snippet","id":"x","activo":false}"#).unwrap();
        assert_eq!(ok, Cambio::Snippet { id: "x".into(), activo: false });
        assert!(serde_json::from_str::<Cambio>(r#"{"clave":"otra","valor":true}"#).is_err());
        assert!(serde_json::from_str::<Cambio>(r#"{"clave":"devtools","valor":"si"}"#).is_err());

        let mut archivo = Archivo::default();
        assert!(aplicar(&mut archivo, "C:/V", &Cambio::Snippet { id: "".into(), activo: true }).is_err());
        assert!(aplicar(&mut archivo, "C:/V", &Cambio::Snippet { id: "a\nb".into(), activo: true }).is_err());
        assert!(aplicar(&mut archivo, "C:/V", &Cambio::Snippet { id: "x".repeat(MAX_ID + 1), activo: true }).is_err());
    }

    #[test]
    fn los_comandos_rechazan_una_base_que_no_es_la_de_la_ventana() {
        let dir = temporal("ventana");
        registrar(&dir, &[]);
        let propio = vault(&dir, "Propio", None, None);
        let ajeno = vault(&dir, "Ajeno", None, None);
        let ventanas = crate::ventanas::VentanasState::default();
        ventanas.0.lock().unwrap().insert("vault-1".into(), propio.clone());
        let cambio = Cambio::Devtools { valor: true };

        // El de la ventana, sí.
        assert!(fijar_para(&ventanas, "vault-1", &propio, &dir, &cambio).unwrap().devtools);
        assert!(leer_para(&ventanas, "vault-1", &propio, &dir).unwrap().devtools);
        // Otro vault, otra ventana o una ventana sin vault: no.
        assert!(fijar_para(&ventanas, "vault-1", &ajeno, &dir, &cambio).is_err());
        assert!(leer_para(&ventanas, "vault-1", &ajeno, &dir).is_err());
        assert!(fijar_para(&ventanas, "vault-2", &propio, &dir, &cambio).is_err());
        assert!(leer_para(&ventanas, "vault-2", &propio, &dir).is_err());
        // Y el rechazo no escribió nada para el ajeno.
        assert!(!config_en(&dir, &ajeno).unwrap().devtools);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn un_archivo_corrupto_es_todo_apagado() {
        let dir = temporal("corrupto");
        std::fs::write(dir.join(ARCHIVO), "{no es json").unwrap();
        let archivo = leer_archivo(&dir.join(ARCHIVO));
        assert_eq!(archivo, Archivo::default());
        let _ = std::fs::remove_dir_all(dir);
    }
}
