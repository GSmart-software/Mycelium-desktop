//! Persistencia de la carpeta del vault (fase 1 del "vault en carpeta").
//!
//! Guarda qué carpeta del SO es la fuente de verdad del vault. Vive FUERA del
//! propio vault —en el config-dir de la app— porque hay que conocer la ruta
//! antes de poder abrir la carpeta. Se almacena como texto plano (la ruta, o
//! archivo ausente/vacío = sin carpeta → la app usa el SQLite clásico).
//!
//! Esta fase solo persiste la elección; el cambio de la capa de datos a la
//! carpeta llega en fases posteriores (ver docs/features/vault-en-carpeta.md).

use std::path::{Path, PathBuf};

use tauri::Manager;

const ARCHIVO: &str = "vault-ruta.txt";

/// Ruta del archivo de config dentro del config-dir de la app.
fn ruta_config(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e| format!("No se pudo resolver el config-dir: {e}"))?;
    Ok(dir.join(ARCHIVO))
}

/// Lee la ruta guardada (o `None` si no hay archivo o está vacío). Lógica pura
/// para poder testearla sin `AppHandle`.
fn leer_ruta(config: &Path) -> Option<String> {
    let contenido = std::fs::read_to_string(config).ok()?;
    let ruta = contenido.trim();
    if ruta.is_empty() {
        None
    } else {
        Some(ruta.to_string())
    }
}

/// Escribe (o borra, con `None`) la ruta guardada. Crea el config-dir si falta.
fn escribir_ruta(config: &Path, ruta: Option<&str>) -> Result<(), String> {
    match ruta {
        Some(r) => {
            if let Some(padre) = config.parent() {
                std::fs::create_dir_all(padre)
                    .map_err(|e| format!("No se pudo crear el config-dir: {e}"))?;
            }
            std::fs::write(config, r).map_err(|e| format!("No se pudo guardar la ruta: {e}"))
        }
        None => match std::fs::remove_file(config) {
            Ok(()) => Ok(()),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(e) => Err(format!("No se pudo limpiar la ruta: {e}")),
        },
    }
}

/// Carpeta del vault seleccionada, o `null` si se usa el SQLite clásico.
#[tauri::command]
pub fn get_vault_ruta(app: tauri::AppHandle) -> Result<Option<String>, String> {
    Ok(leer_ruta(&ruta_config(&app)?))
}

/// Fija la carpeta del vault. Valida que exista y sea un directorio.
#[tauri::command]
pub fn set_vault_ruta(app: tauri::AppHandle, ruta: String) -> Result<(), String> {
    let p = Path::new(&ruta);
    if !p.is_dir() {
        return Err(format!("La carpeta no existe o no es un directorio: {ruta}"));
    }
    escribir_ruta(&ruta_config(&app)?, Some(&ruta))
}

/// Vuelve al SQLite clásico (olvida la carpeta seleccionada).
#[tauri::command]
pub fn limpiar_vault_ruta(app: tauri::AppHandle) -> Result<(), String> {
    escribir_ruta(&ruta_config(&app)?, None)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ida_y_vuelta_de_la_ruta() {
        let base = std::env::temp_dir().join(format!("mycelium-vaultcfg-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&base);
        let config = base.join("sub").join(ARCHIVO); // el padre no existe aún

        assert_eq!(leer_ruta(&config), None, "sin archivo → None");

        escribir_ruta(&config, Some("C:/Notas/MiVault")).unwrap();
        assert_eq!(leer_ruta(&config), Some("C:/Notas/MiVault".to_string()));

        // Sobrescritura.
        escribir_ruta(&config, Some("D:/Otro")).unwrap();
        assert_eq!(leer_ruta(&config), Some("D:/Otro".to_string()));

        // Limpiar → None; limpiar de nuevo no falla aunque no exista.
        escribir_ruta(&config, None).unwrap();
        assert_eq!(leer_ruta(&config), None);
        escribir_ruta(&config, None).unwrap();

        std::fs::remove_dir_all(&base).unwrap();
    }
}
