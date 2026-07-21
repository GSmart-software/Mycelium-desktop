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
    /// Si es `true`, al arrancar se reabre automáticamente el ÚLTIMO vault usado
    /// (el de `ultimoAcceso` más reciente), sea cual sea. Ajuste global, no por
    /// vault. (El antiguo campo `autoAbrir` se ignora si aparece en configs viejas.)
    #[serde(default)]
    abrir_ultimo: bool,
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

/// Quita un vault del registro (no toca la preferencia global `abrir_ultimo`).
fn aplicar_desvincular(reg: &mut Registro, ruta: &str) {
    reg.vaults.retain(|v| v.ruta != ruta);
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

/// `true` si al arrancar debe reabrirse automáticamente el último vault usado.
#[tauri::command]
pub fn get_abrir_ultimo(app: tauri::AppHandle) -> Result<bool, String> {
    Ok(leer_registro(&ruta_config(&app)?).abrir_ultimo)
}

/// Activa/desactiva la reapertura automática del último vault al arrancar.
#[tauri::command]
pub fn set_abrir_ultimo(app: tauri::AppHandle, valor: bool) -> Result<(), String> {
    let config = ruta_config(&app)?;
    let mut reg = leer_registro(&config);
    reg.abrir_ultimo = valor;
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
    fn registro_persiste_vincular_abrir_ultimo_y_desvincular() {
        let base = std::env::temp_dir().join(format!("mycelium-vaults-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&base);
        let config = base.join("sub").join(ARCHIVO); // el padre no existe aún

        assert!(leer_registro(&config).vaults.is_empty(), "sin archivo → vacío");
        assert!(!leer_registro(&config).abrir_ultimo, "por defecto no reabre");

        let mut reg = leer_registro(&config);
        aplicar_vincular(&mut reg, "C:/Notas/A");
        aplicar_vincular(&mut reg, "C:/Notas/B");
        reg.abrir_ultimo = true;
        escribir_registro(&config, &reg).unwrap();

        let reg = leer_registro(&config);
        assert_eq!(reg.vaults.len(), 2);
        assert_eq!(reg.vaults[0].nombre, "A"); // nombre = basename
        assert!(reg.abrir_ultimo);

        // Revincular no duplica.
        let mut reg = leer_registro(&config);
        aplicar_vincular(&mut reg, "C:/Notas/A");
        assert_eq!(reg.vaults.len(), 2);

        // Desvincular no toca la preferencia global.
        aplicar_desvincular(&mut reg, "C:/Notas/B");
        assert_eq!(reg.vaults.len(), 1);
        assert!(reg.abrir_ultimo);

        std::fs::remove_dir_all(&base).unwrap();
    }
}
