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

use std::path::{Path, PathBuf};

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

/// Escritura **atómica** de una nota: escribe a un temporal y hace `rename` sobre
/// el destino, de modo que un corte de luz nunca deja un archivo a medias. Crea
/// los subdirectorios necesarios. Sobrescribe el destino si ya existe.
#[tauri::command]
pub fn escribir_nota(vault_ruta: String, ruta_rel: String, contenido: String) -> Result<(), String> {
    let base = base_vault(&vault_ruta)?;
    let destino = ruta_segura(&base, &ruta_rel)?;
    asegurar_padre(&destino)?;

    // Temporal hermano del destino (mismo directorio → el rename es atómico y no
    // cruza sistemas de archivos). En Windows `rename` reemplaza el destino.
    let tmp = destino.with_extension(format!(
        "{}tmp-{}",
        destino
            .extension()
            .and_then(|e| e.to_str())
            .map(|e| format!("{e}."))
            .unwrap_or_default(),
        std::process::id()
    ));
    std::fs::write(&tmp, contenido.as_bytes())
        .map_err(|e| format!("No se pudo escribir {}: {e}", tmp.display()))?;
    std::fs::rename(&tmp, &destino).map_err(|e| {
        let _ = std::fs::remove_file(&tmp);
        format!("No se pudo renombrar a {}: {e}", destino.display())
    })?;
    Ok(())
}

/// Renombra o mueve un archivo O carpeta dentro del vault. Sirve tanto para
/// renombrar (mismo directorio, nombre distinto) como para mover (otro
/// directorio). Crea el directorio padre del destino.
#[tauri::command]
pub fn mover_ruta(vault_ruta: String, origen_rel: String, destino_rel: String) -> Result<(), String> {
    let base = base_vault(&vault_ruta)?;
    let origen = ruta_segura(&base, &origen_rel)?;
    let destino = ruta_segura(&base, &destino_rel)?;
    if !origen.exists() {
        return Err(format!("No existe el origen: {origen_rel}"));
    }
    asegurar_padre(&destino)?;
    std::fs::rename(&origen, &destino)
        .map_err(|e| format!("No se pudo mover {origen_rel} → {destino_rel}: {e}"))
}

/// Crea un directorio (y sus ancestros) dentro del vault. Idempotente.
#[tauri::command]
pub fn crear_directorio(vault_ruta: String, ruta_rel: String) -> Result<(), String> {
    let base = base_vault(&vault_ruta)?;
    let destino = ruta_segura(&base, &ruta_rel)?;
    std::fs::create_dir_all(&destino)
        .map_err(|e| format!("No se pudo crear {}: {e}", destino.display()))
}

/// Copia un archivo dentro del vault (para duplicar notas). Crea el padre.
#[tauri::command]
pub fn copiar_archivo(vault_ruta: String, origen_rel: String, destino_rel: String) -> Result<(), String> {
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
#[tauri::command]
pub fn borrar_a_papelera(vault_ruta: String, ruta_rel: String) -> Result<String, String> {
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
#[tauri::command]
pub fn restaurar_de_papelera(
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

/// Borra definitivamente un elemento de la papelera (archivo o carpeta).
#[tauri::command]
pub fn borrar_definitivo(vault_ruta: String, ruta_papelera_rel: String) -> Result<(), String> {
    let base = base_vault(&vault_ruta)?;
    let destino = ruta_segura(&base, &ruta_papelera_rel)?;
    if !destino.exists() {
        return Ok(()); // ya no está: nada que borrar (idempotente)
    }
    let res = if destino.is_dir() {
        std::fs::remove_dir_all(&destino)
    } else {
        std::fs::remove_file(&destino)
    };
    res.map_err(|e| format!("No se pudo borrar {ruta_papelera_rel}: {e}"))
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
    fn escritura_atomica_crea_el_archivo_y_subdirs() {
        let base = tmp_vault("escribir");
        let v = base.to_string_lossy().to_string();
        escribir_nota(v.clone(), "Proyectos/2026/plan.md".into(), "# Plan ñ".into()).unwrap();
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
        escribir_nota(v.clone(), "n.md".into(), "uno".into()).unwrap();
        escribir_nota(v.clone(), "n.md".into(), "dos".into()).unwrap();
        assert_eq!(std::fs::read_to_string(base.join("n.md")).unwrap(), "dos");
        std::fs::remove_dir_all(&base).unwrap();
    }

    #[test]
    fn mover_renombra_archivo() {
        let base = tmp_vault("mover");
        let v = base.to_string_lossy().to_string();
        escribir_nota(v.clone(), "viejo.md".into(), "x".into()).unwrap();
        mover_ruta(v.clone(), "viejo.md".into(), "sub/nuevo.md".into()).unwrap();
        assert!(!base.join("viejo.md").exists());
        assert!(base.join("sub/nuevo.md").exists());
        std::fs::remove_dir_all(&base).unwrap();
    }

    #[test]
    fn copiar_duplica_archivo() {
        let base = tmp_vault("copiar");
        let v = base.to_string_lossy().to_string();
        escribir_nota(v.clone(), "a.md".into(), "contenido".into()).unwrap();
        copiar_archivo(v.clone(), "a.md".into(), "a (copia).md".into()).unwrap();
        assert!(base.join("a.md").exists());
        assert_eq!(std::fs::read_to_string(base.join("a (copia).md")).unwrap(), "contenido");
        std::fs::remove_dir_all(&base).unwrap();
    }

    #[test]
    fn borrar_a_papelera_mueve_bajo_trash_y_restaura() {
        let base = tmp_vault("papelera");
        let v = base.to_string_lossy().to_string();
        escribir_nota(v.clone(), "Carpeta/nota.md".into(), "hola".into()).unwrap();

        let papelera_rel = borrar_a_papelera(v.clone(), "Carpeta/nota.md".into()).unwrap();
        assert_eq!(papelera_rel, ".mycelium/.trash/Carpeta/nota.md");
        assert!(!base.join("Carpeta/nota.md").exists());
        assert!(base.join(&papelera_rel).exists());

        // Segunda vez con el mismo nombre: sufijo de timestamp (sin colisión).
        escribir_nota(v.clone(), "Carpeta/nota.md".into(), "otra".into()).unwrap();
        let segunda = borrar_a_papelera(v.clone(), "Carpeta/nota.md".into()).unwrap();
        assert_ne!(segunda, papelera_rel, "la colisión debe desambiguar");
        assert!(base.join(&segunda).exists());

        // Restaurar la primera de vuelta a su ruta original.
        restaurar_de_papelera(v.clone(), papelera_rel.clone(), "Carpeta/nota.md".into()).unwrap();
        assert_eq!(std::fs::read_to_string(base.join("Carpeta/nota.md")).unwrap(), "hola");

        // Borrado definitivo del segundo.
        borrar_definitivo(v.clone(), segunda.clone()).unwrap();
        assert!(!base.join(&segunda).exists());
        std::fs::remove_dir_all(&base).unwrap();
    }

    #[test]
    fn borrar_a_papelera_mueve_carpeta_entera() {
        let base = tmp_vault("papelera-dir");
        let v = base.to_string_lossy().to_string();
        escribir_nota(v.clone(), "Sub/a.md".into(), "a".into()).unwrap();
        escribir_nota(v.clone(), "Sub/b.md".into(), "b".into()).unwrap();
        let rel = borrar_a_papelera(v.clone(), "Sub".into()).unwrap();
        assert_eq!(rel, ".mycelium/.trash/Sub");
        assert!(!base.join("Sub").exists());
        assert!(base.join(".mycelium/.trash/Sub/a.md").exists());
        assert!(base.join(".mycelium/.trash/Sub/b.md").exists());
        std::fs::remove_dir_all(&base).unwrap();
    }

    #[test]
    fn todos_rechazan_path_traversal() {
        let base = tmp_vault("traversal");
        let v = base.to_string_lossy().to_string();
        assert!(escribir_nota(v.clone(), "../fuera.md".into(), "x".into()).is_err());
        assert!(mover_ruta(v.clone(), "../a.md".into(), "b.md".into()).is_err());
        assert!(mover_ruta(v.clone(), "a.md".into(), "../b.md".into()).is_err());
        assert!(crear_directorio(v.clone(), "../hack".into()).is_err());
        assert!(copiar_archivo(v.clone(), "../a.md".into(), "b.md".into()).is_err());
        assert!(borrar_a_papelera(v.clone(), "/etc/passwd".into()).is_err());
        assert!(restaurar_de_papelera(v.clone(), "../x".into(), "y.md".into()).is_err());
        assert!(borrar_definitivo(v.clone(), "../../x".into()).is_err());
        std::fs::remove_dir_all(&base).unwrap();
    }
}
