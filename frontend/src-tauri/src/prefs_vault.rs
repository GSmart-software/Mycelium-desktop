//! Estado **de un vault**, guardado dentro de él, en `.mycelium/`.
//!
//! Hay ajustes y registros que son del vault y no de la instalación: sus
//! preferencias —números de línea, nombres y disposición del grafo, anchos de
//! tabla, y desde `FUN-L-24` también el tema, el modo oscuro, la atmósfera y la
//! tipografía—, sus snippets CSS, el registro de su papelera y sus
//! recordatorios. Van a `.mycelium/<nombre>.json`, **dentro del vault**, por dos
//! motivos:
//!
//! 1. **Viajan con él.** Copiar la carpeta a otra máquina, o sincronizarla, se
//!    lleva también sus ajustes. Guardarlos en la config de la app los ataría a
//!    la máquina, que es justo lo contrario de «cada vault tiene la suya».
//! 2. **`.mycelium/` ya es ese lugar**: ahí está la papelera, y `mycignore` lo
//!    ignora siempre, así que los archivos no aparecen en la app ni en el grafo.
//!    Es el mismo papel que cumple `.obsidian/` en Obsidian.
//!
//! El contenido es **opaco para Rust**: se guarda y se devuelve el JSON tal
//! cual. El esquema lo decide el frontend, que es quien lo conoce; así agregar
//! una preferencia no obliga a tocar Rust ni a migrar nada.
//!
//! Un solo par de comandos para todos (`leer_estado_vault` /
//! `escribir_estado_vault`). Hasta `FUN-L-24` las preferencias tenían un par
//! propio y la apariencia un archivo aparte, que hoy vive dentro de
//! `preferencias.json` (ver `LEGADOS`).

use std::path::{Path, PathBuf};

use crate::vault_fs::escribir_atomico;

const DIR: &str = ".mycelium";

/// Los archivos de estado que viven en `.mycelium/`.
///
/// Es una lista cerrada a propósito: el nombre llega del frontend, y aceptar
/// cualquiera sería dejar escribir en `.mycelium/` —o, con un `..`, fuera de
/// él— desde la webview.
///
/// - `preferencias.json`: las preferencias y la apariencia del vault
///   (`prefsVaultStore` y `preferencesStore`).
/// - `snippets.json`: los snippets CSS (`cssStore`).
/// - `papelera.json`: el registro de la papelera (`DEF-107`); el índice lo
///   copia en la tabla `papelera`, pero la verdad es el archivo.
/// - `recordatorios.json`: el calendario del vault (`FUN-L-22`).
/// - `diccionario.txt`: el diccionario personal del corrector ortográfico
///   (`FUN-L-12`), una palabra por renglón. Es del vault y viaja con él:
///   «Agregar al diccionario» en un vault no afecta a los demás.
/// - `actividad.jsonl`: el registro de lo que hizo la IA por el MCP de control
///   (`FUN-L-09`, Parte 2), una entrada JSON por renglón y con tope. Lo recorta
///   el frontend al escribir (`stores/actividadIaStore.ts`).
const ESTADOS: &[&str] = &[
    "preferencias.json",
    "snippets.json",
    "papelera.json",
    "recordatorios.json",
    "diccionario.txt",
    "actividad.jsonl",
];

/// Archivos de estado de versiones anteriores que solo se **leen y borran** una
/// vez, al migrarlos: nadie los vuelve a escribir.
///
/// `apariencia.json` (tema, modo oscuro y tipografía, `DEF-107`) se fundió en
/// `preferencias.json` con `FUN-L-24`. La migración lo lee, copia sus claves y
/// lo borra (`lib/db/legado.ts`).
const LEGADOS: &[&str] = &["apariencia.json"];

fn ruta_en(vault: &Path, nombre: &str, permitidos: &[&[&str]]) -> Result<PathBuf, String> {
    if !permitidos.iter().any(|lista| lista.contains(&nombre)) {
        return Err(format!("Archivo de estado desconocido: {nombre}"));
    }
    Ok(vault.join(DIR).join(nombre))
}

/// Lee un archivo de estado del vault (o uno legado, para migrarlo). **Ausente
/// o ilegible → `None`**, nunca un error: que no exista es el caso normal —un
/// vault recién abierto no tiene ninguno— y uno ilegible no debe impedir abrir
/// el vault. El frontend cae a sus valores por defecto y el archivo se reescribe
/// entero en el próximo guardado.
#[tauri::command]
pub fn leer_estado_vault(ruta: String, nombre: String) -> Result<Option<String>, String> {
    let destino = ruta_en(Path::new(&ruta), &nombre, &[ESTADOS, LEGADOS])?;
    Ok(std::fs::read_to_string(destino).ok())
}

/// Escribe un archivo de estado del vault, creando `.mycelium/` si falta.
///
/// Va por `escribir_atomico` —el mismo que las notas— para que una escritura
/// interrumpida no deje el archivo a medias: perder una preferencia es leve,
/// pero un JSON truncado haría que el vault arrancara siempre con los valores
/// por defecto sin decir por qué. Un archivo legado no se puede escribir.
#[tauri::command]
pub fn escribir_estado_vault(ruta: String, nombre: String, contenido: String) -> Result<(), String> {
    let destino = ruta_en(Path::new(&ruta), &nombre, &[ESTADOS])?;
    if let Some(dir) = destino.parent() {
        std::fs::create_dir_all(dir)
            .map_err(|e| format!("No se pudo crear {}: {e}", dir.display()))?;
    }
    escribir_atomico(&destino, &contenido)
}

/// Borra un archivo **legado** ya migrado. Solo los de `LEGADOS`: los estados
/// vigentes no se borran nunca desde la webview. Que no exista no es un error
/// (la migración pudo correr antes, en otra ventana o en otra sesión).
#[tauri::command]
pub fn borrar_estado_vault(ruta: String, nombre: String) -> Result<(), String> {
    let destino = ruta_en(Path::new(&ruta), &nombre, &[LEGADOS])?;
    match std::fs::remove_file(&destino) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(format!("No se pudo borrar {}: {e}", destino.display())),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn vault_temporal(nombre: &str) -> String {
        let dir = std::env::temp_dir().join(format!("mic-prefs-{nombre}"));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir.to_string_lossy().to_string()
    }

    fn leer(v: &str, nombre: &str) -> Option<String> {
        leer_estado_vault(v.to_string(), nombre.to_string()).unwrap()
    }

    fn escribir(v: &str, nombre: &str, contenido: &str) -> Result<(), String> {
        escribir_estado_vault(v.to_string(), nombre.to_string(), contenido.to_string())
    }

    #[test]
    fn un_vault_sin_preferencias_devuelve_none() {
        let v = vault_temporal("vacio");
        assert_eq!(leer(&v, "preferencias.json"), None, "que no exista es el caso normal, no un error");
    }

    #[test]
    fn las_preferencias_se_escriben_y_se_leen_tal_cual() {
        let v = vault_temporal("ida-y-vuelta");
        escribir(&v, "preferencias.json", r#"{"numerosDeLinea":true}"#).unwrap();
        assert_eq!(leer(&v, "preferencias.json").as_deref(), Some(r#"{"numerosDeLinea":true}"#));
    }

    #[test]
    fn se_crea_el_directorio_si_falta() {
        let v = vault_temporal("sin-dir");
        assert!(!Path::new(&v).join(DIR).exists());
        escribir(&v, "preferencias.json", "{}").unwrap();
        assert!(Path::new(&v).join(DIR).join("preferencias.json").is_file());
    }

    #[test]
    fn el_contenido_es_opaco_para_rust() {
        // Rust no valida el esquema: guarda y devuelve lo que le den. Así
        // agregar una preferencia no obliga a tocar este módulo.
        let v = vault_temporal("opaco");
        escribir(&v, "preferencias.json", "cualquier cosa").unwrap();
        assert_eq!(leer(&v, "preferencias.json").as_deref(), Some("cualquier cosa"));
    }

    #[test]
    fn los_estados_se_escriben_y_se_leen() {
        let v = vault_temporal("estados");
        assert_eq!(leer(&v, "snippets.json"), None);
        escribir(&v, "snippets.json", "[]").unwrap();
        assert_eq!(leer(&v, "snippets.json").as_deref(), Some("[]"));
    }

    #[test]
    fn un_nombre_fuera_de_la_lista_se_rechaza() {
        let v = vault_temporal("fuera-de-lista");
        assert!(escribir(&v, "../fuera.json", "x").is_err());
        assert!(escribir(&v, "otro.json", "x").is_err());
        assert!(leer_estado_vault(v.clone(), "otro.json".into()).is_err());
        assert!(borrar_estado_vault(v, "../fuera.json".into()).is_err());
    }

    #[test]
    fn los_recordatorios_son_un_estado_valido() {
        // El calendario (`FUN-L-22`) guarda sus recordatorios en `.mycelium/`:
        // si el nombre no estuviera en la lista, cada guardado fallaría.
        let v = vault_temporal("recordatorios");
        assert_eq!(leer(&v, "recordatorios.json"), None);
        escribir(&v, "recordatorios.json", r#"{"version":1}"#).unwrap();
        assert!(Path::new(&v).join(DIR).join("recordatorios.json").is_file());
        assert_eq!(leer(&v, "recordatorios.json").as_deref(), Some(r#"{"version":1}"#));
    }

    #[test]
    fn el_registro_de_actividad_es_un_estado_valido() {
        // El registro de la IA (`FUN-L-09`) vive en `.mycelium/`: sin el nombre
        // en la lista, lo que hizo el agente no quedaría en ningún lado.
        let v = vault_temporal("actividad");
        assert_eq!(leer(&v, "actividad.jsonl"), None);
        let jsonl = "{\"id\":\"a\"}\n{\"id\":\"b\"}\n";
        escribir(&v, "actividad.jsonl", jsonl).unwrap();
        assert_eq!(leer(&v, "actividad.jsonl").as_deref(), Some(jsonl));
        // Y no se borra desde la webview: se recorta al escribir.
        assert!(borrar_estado_vault(v, "actividad.jsonl".into()).is_err());
    }

    #[test]
    fn el_diccionario_del_vault_es_un_estado_valido() {
        // «Agregar al diccionario del vault» (`FUN-L-12`) escribe acá: sin el
        // nombre en la lista, la palabra se perdería al cerrar la app.
        let v = vault_temporal("diccionario");
        assert_eq!(leer(&v, "diccionario.txt"), None);
        escribir(&v, "diccionario.txt", "Mycelium
vault
").unwrap();
        assert!(Path::new(&v).join(DIR).join("diccionario.txt").is_file());
        assert_eq!(leer(&v, "diccionario.txt").as_deref(), Some("Mycelium
vault
"));
        // Y no se puede borrar desde la webview: quitar palabras es reescribirlo.
        assert!(borrar_estado_vault(v, "diccionario.txt".into()).is_err());
    }

    #[test]
    fn escribir_dos_veces_reemplaza_y_no_acumula() {
        let v = vault_temporal("reemplaza");
        escribir(&v, "preferencias.json", r#"{"a":1}"#).unwrap();
        escribir(&v, "preferencias.json", r#"{"b":2}"#).unwrap();
        assert_eq!(leer(&v, "preferencias.json").as_deref(), Some(r#"{"b":2}"#));
    }

    #[test]
    fn la_apariencia_legada_se_lee_y_se_borra_pero_no_se_escribe() {
        // `apariencia.json` solo existe para migrarlo a `preferencias.json`
        // (`FUN-L-24`): escribirlo lo resucitaría, y la migración lo volvería a
        // fundir encima de lo que el usuario cambió después.
        let v = vault_temporal("legado");
        let archivo = Path::new(&v).join(DIR).join("apariencia.json");
        std::fs::create_dir_all(archivo.parent().unwrap()).unwrap();
        std::fs::write(&archivo, r#"{"tema":"cantarela"}"#).unwrap();

        assert_eq!(leer(&v, "apariencia.json").as_deref(), Some(r#"{"tema":"cantarela"}"#));
        assert!(escribir(&v, "apariencia.json", "{}").is_err());
        borrar_estado_vault(v.clone(), "apariencia.json".into()).unwrap();
        assert!(!archivo.exists());
        // Borrarlo otra vez no falla: la migración puede correr dos veces.
        borrar_estado_vault(v, "apariencia.json".into()).unwrap();
    }

    #[test]
    fn un_estado_vigente_no_se_puede_borrar() {
        let v = vault_temporal("no-borra");
        escribir(&v, "preferencias.json", "{}").unwrap();
        assert!(borrar_estado_vault(v.clone(), "preferencias.json".into()).is_err());
        assert!(Path::new(&v).join(DIR).join("preferencias.json").is_file());
    }
}
