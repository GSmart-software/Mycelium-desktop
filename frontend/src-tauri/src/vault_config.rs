//! Registro de vaults vinculados (fase 1 del "vault en carpeta").
//!
//! Modelo Obsidian: los vaults viven en cualquier carpeta del dispositivo y la
//! app recuerda cuáles se han vinculado. El registro vive FUERA de los vaults
//! —en el config-dir de la app (`vaults.json`)— porque hay que conocer las
//! rutas antes de abrir ninguna. Guarda la lista `{ruta, nombre, ultimoAcceso}`
//! y `autoAbrir` (la ruta que se abre sola al arrancar, o `null` → selector).
//!
//! Vincular solo REGISTRA la carpeta (no copia nada); desvincular la olvida
//! (los archivos en disco no se tocan). La conmutación real de la capa de datos
//! a la carpeta llega en fases posteriores (ver docs/features/vault-en-carpeta.md).

use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use tauri::Manager;

const ARCHIVO: &str = "vaults.json";

/// Un vault vinculado. `ultimoAcceso` en milisegundos epoch (o `null`).
#[derive(Serialize, Deserialize, Clone, PartialEq, Debug)]
#[serde(rename_all = "camelCase")]
pub struct VaultRef {
    pub ruta: String,
    pub nombre: String,
    #[serde(default)]
    pub ultimo_acceso: Option<i64>,
}

/// Contenido del registro en disco.
#[derive(Serialize, Deserialize, Default, Debug)]
#[serde(rename_all = "camelCase")]
struct Registro {
    #[serde(default)]
    vaults: Vec<VaultRef>,
    #[serde(default)]
    auto_abrir: Option<String>,
}

fn ruta_config(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e| format!("No se pudo resolver el config-dir: {e}"))?;
    Ok(dir.join(ARCHIVO))
}

/// Lee el registro (archivo ausente o corrupto → registro vacío). Pura, testeable.
fn leer_registro(config: &Path) -> Registro {
    std::fs::read_to_string(config)
        .ok()
        .and_then(|t| serde_json::from_str(&t).ok())
        .unwrap_or_default()
}

/// Escribe el registro (crea el config-dir si falta). Pura, testeable.
fn escribir_registro(config: &Path, reg: &Registro) -> Result<(), String> {
    if let Some(padre) = config.parent() {
        std::fs::create_dir_all(padre)
            .map_err(|e| format!("No se pudo crear el config-dir: {e}"))?;
    }
    let json = serde_json::to_string_pretty(reg).map_err(|e| e.to_string())?;
    std::fs::write(config, json).map_err(|e| format!("No se pudo guardar el registro: {e}"))
}

fn ahora_millis() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn nombre_de(ruta: &str) -> String {
    Path::new(ruta)
        .file_name()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| ruta.to_string())
}

/// Añade o actualiza un vault en el registro. Devuelve su `VaultRef`.
fn aplicar_vincular(reg: &mut Registro, ruta: &str) -> VaultRef {
    if let Some(existente) = reg.vaults.iter_mut().find(|v| v.ruta == ruta) {
        existente.ultimo_acceso = Some(ahora_millis());
        return existente.clone();
    }
    let nuevo = VaultRef {
        ruta: ruta.to_string(),
        nombre: nombre_de(ruta),
        ultimo_acceso: Some(ahora_millis()),
    };
    reg.vaults.push(nuevo.clone());
    nuevo
}

/// Quita un vault del registro; si era el `autoAbrir`, lo limpia.
fn aplicar_desvincular(reg: &mut Registro, ruta: &str) {
    reg.vaults.retain(|v| v.ruta != ruta);
    if reg.auto_abrir.as_deref() == Some(ruta) {
        reg.auto_abrir = None;
    }
}

// ── Comandos ────────────────────────────────────────────────────────────────

/// Vaults vinculados, más recientes primero.
#[tauri::command]
pub fn listar_vaults(app: tauri::AppHandle) -> Result<Vec<VaultRef>, String> {
    let mut vaults = leer_registro(&ruta_config(&app)?).vaults;
    vaults.sort_by(|a, b| b.ultimo_acceso.cmp(&a.ultimo_acceso));
    Ok(vaults)
}

/// Vincula una carpeta (debe existir y ser un directorio). La añade al registro.
#[tauri::command]
pub fn vincular_vault(app: tauri::AppHandle, ruta: String) -> Result<VaultRef, String> {
    if !Path::new(&ruta).is_dir() {
        return Err(format!("La carpeta no existe o no es un directorio: {ruta}"));
    }
    let config = ruta_config(&app)?;
    let mut reg = leer_registro(&config);
    let ref_ = aplicar_vincular(&mut reg, &ruta);
    escribir_registro(&config, &reg)?;
    Ok(ref_)
}

/// Olvida un vault del registro (no toca los archivos en disco).
#[tauri::command]
pub fn desvincular_vault(app: tauri::AppHandle, ruta: String) -> Result<(), String> {
    let config = ruta_config(&app)?;
    let mut reg = leer_registro(&config);
    aplicar_desvincular(&mut reg, &ruta);
    escribir_registro(&config, &reg)
}

/// Ruta del vault que se abre solo al arrancar (o `null` → mostrar selector).
#[tauri::command]
pub fn get_auto_abrir(app: tauri::AppHandle) -> Result<Option<String>, String> {
    Ok(leer_registro(&ruta_config(&app)?).auto_abrir)
}

/// Fija (o limpia con `null`) el vault de apertura automática. Debe estar vinculado.
#[tauri::command]
pub fn set_auto_abrir(app: tauri::AppHandle, ruta: Option<String>) -> Result<(), String> {
    let config = ruta_config(&app)?;
    let mut reg = leer_registro(&config);
    if let Some(r) = &ruta {
        if !reg.vaults.iter().any(|v| &v.ruta == r) {
            return Err("Ese vault no está vinculado.".to_string());
        }
    }
    reg.auto_abrir = ruta;
    escribir_registro(&config, &reg)
}

/// Actualiza el `ultimoAcceso` de un vault al abrirlo.
#[tauri::command]
pub fn marcar_acceso(app: tauri::AppHandle, ruta: String) -> Result<(), String> {
    let config = ruta_config(&app)?;
    let mut reg = leer_registro(&config);
    if let Some(v) = reg.vaults.iter_mut().find(|v| v.ruta == ruta) {
        v.ultimo_acceso = Some(ahora_millis());
        escribir_registro(&config, &reg)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn registro_persiste_vincular_auto_y_desvincular() {
        let base = std::env::temp_dir().join(format!("mycelium-vaults-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&base);
        let config = base.join("sub").join(ARCHIVO); // el padre no existe aún

        assert!(leer_registro(&config).vaults.is_empty(), "sin archivo → vacío");

        let mut reg = leer_registro(&config);
        aplicar_vincular(&mut reg, "C:/Notas/A");
        aplicar_vincular(&mut reg, "C:/Notas/B");
        reg.auto_abrir = Some("C:/Notas/B".to_string());
        escribir_registro(&config, &reg).unwrap();

        let reg = leer_registro(&config);
        assert_eq!(reg.vaults.len(), 2);
        assert_eq!(reg.vaults[0].nombre, "A"); // nombre = basename
        assert_eq!(reg.auto_abrir.as_deref(), Some("C:/Notas/B"));

        // Revincular no duplica.
        let mut reg = leer_registro(&config);
        aplicar_vincular(&mut reg, "C:/Notas/A");
        assert_eq!(reg.vaults.len(), 2);

        // Desvincular el auto lo limpia.
        aplicar_desvincular(&mut reg, "C:/Notas/B");
        assert_eq!(reg.vaults.len(), 1);
        assert_eq!(reg.auto_abrir, None);

        std::fs::remove_dir_all(&base).unwrap();
    }
}
