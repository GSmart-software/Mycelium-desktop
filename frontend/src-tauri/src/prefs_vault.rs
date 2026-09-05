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
    fn escribir_dos_veces_reemplaza_y_no_acumula() {
        let v = vault_temporal("reemplaza");
        escribir(&v, r#"{"a":1}"#).unwrap();
        escribir(&v, r#"{"b":2}"#).unwrap();
        assert_eq!(leer(&v).as_deref(), Some(r#"{"b":2}"#));
    }
}
