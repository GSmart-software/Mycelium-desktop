//! Preferencias **de un vault**, guardadas dentro de él.
//!
//! Hasta ahora las preferencias eran del **usuario**: viven en el servidor y
//! valen para todo (`preferencesStore` → `PUT /auth/preferencias`). Pero hay
//! ajustes que son del vault y no de la persona —si los números de línea se ven
//! o no, cómo se muestran los nombres en el grafo— y para esos no había casa
//! (`FUN-M-28` / `FUN-M-21`).
//!
//! Van a `.mycelium/preferencias.json`, **dentro del vault**, por dos motivos:
//!
//! 1. **Viajan con él.** Copiar la carpeta a otra máquina, o sincronizarla, se
//!    lleva también sus ajustes. Guardarlos en la config de la app los ataría a
//!    la máquina, que es justo lo contrario de «cada vault tiene la suya».
//! 2. **`.mycelium/` ya es ese lugar**: ahí están la papelera y el índice, y
//!    `mycignore` lo ignora siempre, así que el archivo no aparece en la app ni
//!    en el grafo. Es el mismo papel que cumple `.obsidian/` en Obsidian.
//!
//! El contenido es **opaco para Rust**: se guarda y se devuelve el JSON tal
//! cual. El esquema lo decide el frontend, que es quien conoce las preferencias;
//! así agregar una no obliga a tocar Rust ni a migrar nada.

use std::path::{Path, PathBuf};

use crate::vault_fs::escribir_atomico;

const DIR: &str = ".mycelium";
const ARCHIVO: &str = "preferencias.json";

/// Dónde vive el archivo de preferencias de un vault.
fn ruta_prefs(vault: &Path) -> PathBuf {
    vault.join(DIR).join(ARCHIVO)
}

/// Los demás archivos de estado que viven en `.mycelium/` (`DEF-107`): lo que
/// antes estaba **solo** en el índice y se perdía al reconstruirlo. El índice
/// los sigue teniendo como tablas, pero la verdad es el archivo.
///
/// Es una lista cerrada a propósito: el nombre llega del frontend, y aceptar
/// cualquiera sería dejar escribir en `.mycelium/` —o, con un `..`, fuera de
/// él— desde la webview.
///
/// `recordatorios.json` es el calendario del vault (`FUN-L-22`): no es un
/// archivo del vault —no aparece en el explorador, la búsqueda ni el grafo—
/// pero viaja con él, y por eso vive acá y no en la config de la app.
const ESTADOS: &[&str] = &[
    "apariencia.json",
    "snippets.json",
    "papelera.json",
    "recordatorios.json",
];

fn ruta_estado(vault: &Path, nombre: &str) -> Result<PathBuf, String> {
    if !ESTADOS.contains(&nombre) {
        return Err(format!("Archivo de estado desconocido: {nombre}"));
    }
    Ok(vault.join(DIR).join(nombre))
}

/// Lee las preferencias del vault. **Ausente o ilegible → `None`**, nunca un
/// error: un archivo que todavía no existe es el caso normal —un vault recién
/// abierto no tiene ninguno— y uno corrupto no debe impedir abrir el vault. El
/// frontend cae a sus valores por defecto y el archivo se reescribe entero en el
/// próximo guardado.
fn leer(vault: &Path) -> Option<String> {
    std::fs::read_to_string(ruta_prefs(vault)).ok()
}

/// Escribe las preferencias del vault, creando `.mycelium/` si falta.
///
/// Va por `escribir_atomico` —el mismo que las notas— para que una escritura
/// interrumpida no deje el archivo a medias: perder una preferencia es leve,
/// pero un JSON truncado haría que el vault arrancara siempre con los valores
/// por defecto sin decir por qué.
fn escribir(vault: &Path, contenido: &str) -> Result<(), String> {
    let destino = ruta_prefs(vault);
    if let Some(dir) = destino.parent() {
        std::fs::create_dir_all(dir)
            .map_err(|e| format!("No se pudo crear {}: {e}", dir.display()))?;
    }
    escribir_atomico(&destino, contenido)
}

/// Lee un archivo de estado del vault. Ausente o ilegible → `None`, como las
/// preferencias: que no exista es el caso normal de un vault que todavía no lo
/// escribió.
#[tauri::command]
pub fn leer_estado_vault(ruta: String, nombre: String) -> Result<Option<String>, String> {
    let destino = ruta_estado(Path::new(&ruta), &nombre)?;
    Ok(std::fs::read_to_string(destino).ok())
}

/// Escribe un archivo de estado del vault, atómico y creando `.mycelium/`.
#[tauri::command]
pub fn escribir_estado_vault(ruta: String, nombre: String, contenido: String) -> Result<(), String> {
    let destino = ruta_estado(Path::new(&ruta), &nombre)?;
    if let Some(dir) = destino.parent() {
        std::fs::create_dir_all(dir)
            .map_err(|e| format!("No se pudo crear {}: {e}", dir.display()))?;
    }
    escribir_atomico(&destino, &contenido)
}

#[tauri::command]
pub fn leer_prefs_vault(ruta: String) -> Option<String> {
    leer(Path::new(&ruta))
}

#[tauri::command]
pub fn escribir_prefs_vault(ruta: String, contenido: String) -> Result<(), String> {
    escribir(Path::new(&ruta), &contenido)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn vault_temporal(nombre: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("mic-prefs-{nombre}"));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn un_vault_sin_preferencias_devuelve_none() {
        let v = vault_temporal("vacio");
        assert_eq!(leer(&v), None, "que no exista es el caso normal, no un error");
    }

    #[test]
    fn se_escribe_y_se_lee_tal_cual() {
        let v = vault_temporal("ida-y-vuelta");
        escribir(&v, r#"{"numerosDeLinea":true}"#).unwrap();
        assert_eq!(leer(&v).as_deref(), Some(r#"{"numerosDeLinea":true}"#));
    }

    #[test]
    fn se_crea_el_directorio_si_falta() {
        let v = vault_temporal("sin-dir");
        assert!(!v.join(DIR).exists());
        escribir(&v, "{}").unwrap();
        assert!(v.join(DIR).join(ARCHIVO).is_file());
    }

    #[test]
    fn el_contenido_es_opaco_para_rust() {
        // Rust no valida el esquema: guarda y devuelve lo que le den. Así
        // agregar una preferencia no obliga a tocar este módulo.
        let v = vault_temporal("opaco");
        escribir(&v, "cualquier cosa").unwrap();
        assert_eq!(leer(&v).as_deref(), Some("cualquier cosa"));
    }

    #[test]
    fn los_estados_se_escriben_y_se_leen() {
        let v = vault_temporal("estados");
        let r = v.to_string_lossy().to_string();
        assert_eq!(leer_estado_vault(r.clone(), "snippets.json".into()).unwrap(), None);
        escribir_estado_vault(r.clone(), "snippets.json".into(), "[]".into()).unwrap();
        assert_eq!(
            leer_estado_vault(r, "snippets.json".into()).unwrap().as_deref(),
            Some("[]")
        );
    }

    #[test]
    fn un_nombre_fuera_de_la_lista_se_rechaza() {
        let v = vault_temporal("fuera-de-lista");
        let r = v.to_string_lossy().to_string();
        assert!(escribir_estado_vault(r.clone(), "../fuera.json".into(), "x".into()).is_err());
        assert!(escribir_estado_vault(r.clone(), "preferencias.json".into(), "x".into()).is_err());
        assert!(leer_estado_vault(r, "otro.json".into()).is_err());
    }

    #[test]
    fn los_recordatorios_son_un_estado_valido() {
        // El calendario (`FUN-L-22`) guarda sus recordatorios en `.mycelium/`:
        // si el nombre no estuviera en la lista, cada guardado fallaría.
        let v = vault_temporal("recordatorios");
        let r = v.to_string_lossy().to_string();
        assert_eq!(leer_estado_vault(r.clone(), "recordatorios.json".into()).unwrap(), None);
        escribir_estado_vault(r.clone(), "recordatorios.json".into(), r#"{"version":1}"#.into())
            .unwrap();
        assert!(v.join(DIR).join("recordatorios.json").is_file());
        assert_eq!(
            leer_estado_vault(r, "recordatorios.json".into()).unwrap().as_deref(),
            Some(r#"{"version":1}"#)
        );
    }

    #[test]
    fn escribir_dos_veces_reemplaza_y_no_acumula() {
        let v = vault_temporal("reemplaza");
        escribir(&v, r#"{"a":1}"#).unwrap();
        escribir(&v, r#"{"b":2}"#).unwrap();
        assert_eq!(leer(&v).as_deref(), Some(r#"{"b":2}"#));
    }
}
