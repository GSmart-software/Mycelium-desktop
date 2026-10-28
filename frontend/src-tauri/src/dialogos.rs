//! Carpetas **fuera del vault** que el usuario eligió en un selector nativo
//! abierto desde Rust (`DEF-161`).
//!
//! Hay tres cosas que la app hace legítimamente fuera de la carpeta del vault:
//! vincular una carpeta como vault nuevo, exportar el vault a una carpeta y
//! copiar (importar) una carpeta dentro del vault. Hasta `DEF-161` las tres
//! recibían la ruta de JS: el selector lo abría el frontend con el plugin
//! `dialog` y mandaba lo que el usuario eligió. Pero para Rust una ruta que
//! llega de JS es una ruta que pudo escribir un XSS, y con ella se exportaba a
//! cualquier carpeta del disco (sobrescribiendo) o se copiaba cualquier árbol
//! al vault para leerlo.
//!
//! Ahora el selector lo abre **Rust**, y la carpeta elegida queda anotada para
//! la ventana que lo pidió. Los comandos que trabajan fuera del vault solo
//! aceptan una de esas carpetas ([`carpeta_elegida`]). JS sigue viendo la ruta
//! (la muestra en los mensajes), pero no puede inventarla.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use tauri::Manager;
use tauri_plugin_dialog::DialogExt;

/// Una carpeta elegida: la ruta tal cual la devolvió el selector (la que se usa
/// para trabajar y la que ve el usuario) y su forma canónica (la que se compara).
struct Elegida {
    ruta: PathBuf,
    canonica: PathBuf,
}

/// Carpetas elegidas en el selector nativo, por etiqueta de ventana. Se olvidan
/// al cerrar la ventana (`ventanas::al_cerrar`).
#[derive(Default)]
pub struct ElegidasState(Mutex<HashMap<String, Vec<Elegida>>>);

/// Abre el selector de carpetas nativo **desde Rust**, como hijo de `ventana`.
/// `None` si el usuario cancela.
///
/// Con `pick_folder` y un canal, no con `blocking_pick_folder`: el diálogo se
/// arma en el hilo principal, y el comando que espera es `async` (corre fuera
/// de él), así que no se bloquean mutuamente.
pub async fn elegir_carpeta_nativa<R: tauri::Runtime>(
    ventana: &tauri::Window<R>,
    titulo: &str,
) -> Result<Option<PathBuf>, String> {
    let (tx, rx) = tokio::sync::oneshot::channel();
    ventana
        .app_handle()
        .dialog()
        .file()
        .set_title(titulo)
        .set_parent(ventana)
        .pick_folder(move |elegida| {
            let _ = tx.send(elegida);
        });
    let elegida = rx.await.map_err(|_| "El selector de carpetas se cerró sin responder.".to_string())?;
    match elegida {
        None => Ok(None),
        Some(ruta) => ruta
            .into_path()
            .map(Some)
            .map_err(|e| format!("La carpeta elegida no es una ruta del disco: {e}")),
    }
}

/// Abre el selector, anota la carpeta para esta ventana y devuelve su ruta (o
/// `null` si se canceló). Es lo único que habilita a `exportar_a_carpeta`,
/// `carpeta_no_vacia` y a la importación de carpetas a usar una ruta de fuera
/// del vault.
#[tauri::command]
pub async fn elegir_carpeta(
    ventana: tauri::Window,
    titulo: Option<String>,
) -> Result<Option<String>, String> {
    let titulo = titulo.unwrap_or_else(|| "Elegí una carpeta".to_string());
    let Some(ruta) = elegir_carpeta_nativa(&ventana, &titulo).await? else {
        return Ok(None);
    };
    anotar(&ventana.state::<ElegidasState>(), ventana.label(), &ruta)?;
    Ok(Some(ruta.to_string_lossy().to_string()))
}

/// Abre el selector de archivos nativo para elegir un `.zip` a importar, lo
/// anota para esta ventana como una carpeta elegida y devuelve su ruta (o
/// `null` si se canceló). Es lo único que habilita a `extraer_zip_importacion`
/// (`DEF-165`): Rust necesita saber de qué archivo viene lo extraído para
/// pasarle su marca de la web, y la webview no puede inventarle una ruta.
#[tauri::command]
pub async fn elegir_zip(ventana: tauri::Window, titulo: Option<String>) -> Result<Option<String>, String> {
    let titulo = titulo.unwrap_or_else(|| "Elegí un .zip".to_string());
    let (tx, rx) = tokio::sync::oneshot::channel();
    ventana
        .app_handle()
        .dialog()
        .file()
        .set_title(&titulo)
        .set_parent(&ventana)
        .add_filter("Archivo .zip", &["zip"])
        .pick_file(move |elegido| {
            let _ = tx.send(elegido);
        });
    let elegido = rx.await.map_err(|_| "El selector de archivos se cerró sin responder.".to_string())?;
    let Some(ruta) = elegido else { return Ok(None) };
    let ruta = ruta
        .into_path()
        .map_err(|e| format!("El archivo elegido no es una ruta del disco: {e}"))?;
    anotar(&ventana.state::<ElegidasState>(), ventana.label(), &ruta)?;
    Ok(Some(ruta.to_string_lossy().to_string()))
}

/// Anota `ruta` como elegida por la ventana `label`.
fn anotar(state: &ElegidasState, label: &str, ruta: &Path) -> Result<(), String> {
    let canonica = ruta
        .canonicalize()
        .map_err(|e| format!("No se pudo resolver {}: {e}", ruta.display()))?;
    let mut mapa = state.0.lock().map_err(|_| "Registro de carpetas no disponible".to_string())?;
    let lista = mapa.entry(label.to_string()).or_default();
    if !lista.iter().any(|e| e.canonica == canonica) {
        lista.push(Elegida { ruta: ruta.to_path_buf(), canonica });
    }
    Ok(())
}

/// La carpeta `pedida` **si** la ventana `label` la eligió en el selector
/// nativo; si no, error. Devuelve la ruta tal cual la dio el selector.
pub fn carpeta_elegida(state: &ElegidasState, label: &str, pedida: &str) -> Result<PathBuf, String> {
    let rechazo = || format!("«{pedida}» no es una carpeta elegida en el selector: no se usa.");
    let canonica = Path::new(pedida).canonicalize().map_err(|_| rechazo())?;
    let mapa = state.0.lock().map_err(|_| "Registro de carpetas no disponible".to_string())?;
    mapa.get(label)
        .and_then(|lista| lista.iter().find(|e| e.canonica == canonica))
        .map(|e| e.ruta.clone())
        .ok_or_else(rechazo)
}

/// Atajo para los comandos: [`carpeta_elegida`] de la ventana que invoca.
pub fn elegida_por<R: tauri::Runtime>(ventana: &tauri::Window<R>, pedida: &str) -> Result<PathBuf, String> {
    carpeta_elegida(&ventana.state::<ElegidasState>(), ventana.label(), pedida)
}

/// Olvida lo que eligió una ventana (al cerrarse).
pub fn olvidar_de(state: &ElegidasState, label: &str) {
    if let Ok(mut mapa) = state.0.lock() {
        mapa.remove(label);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn solo_vale_la_carpeta_que_eligio_esa_ventana() {
        let base = std::env::temp_dir().join(format!("mic-dialogos-{}", std::process::id()));
        let elegida = base.join("Exportar");
        let otra = base.join("Otra");
        std::fs::create_dir_all(&elegida).unwrap();
        std::fs::create_dir_all(&otra).unwrap();
        let state = ElegidasState::default();
        anotar(&state, "vault-1", &elegida).unwrap();

        let e = elegida.to_string_lossy().to_string();
        assert_eq!(carpeta_elegida(&state, "vault-1", &e).unwrap(), elegida);
        // Otra escritura de la misma carpeta, también.
        assert!(carpeta_elegida(&state, "vault-1", &format!("{e}/./")).is_ok());
        // Una carpeta que nadie eligió: no.
        assert!(carpeta_elegida(&state, "vault-1", &otra.to_string_lossy()).is_err());
        // Una subcarpeta o el padre de la elegida: no.
        assert!(carpeta_elegida(&state, "vault-1", &base.to_string_lossy()).is_err());
        // La misma carpeta desde otra ventana: no.
        assert!(carpeta_elegida(&state, "vault-2", &e).is_err());
        // Ni algo que no existe.
        assert!(carpeta_elegida(&state, "vault-1", "Z:/no/existe").is_err());
        // Al cerrar la ventana se olvida.
        olvidar_de(&state, "vault-1");
        assert!(carpeta_elegida(&state, "vault-1", &e).is_err());

        let _ = std::fs::remove_dir_all(base);
    }
}
