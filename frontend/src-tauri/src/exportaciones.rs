//! Exportar a un archivo **fuera del vault** con aviso (`FUN-M-22`).
//!
//! Hasta `FUN-M-22` exportar una nota como `.md`, el vault como `.zip` o un
//! dibujo como imagen era una descarga del webview (`<a download>`): el archivo
//! iba a parar a Descargas sin ninguna señal, y la app no sabía dónde había
//! quedado. Ahora el destino lo elige el usuario en el diálogo **Guardar como**
//! nativo, que abre Rust; Rust lo anota para la ventana que lo pidió y es lo
//! único que aceptan [`escribir_exportacion`] y [`revelar_exportacion`]. Es la
//! misma defensa de `DEF-161` (`dialogos.rs`): una ruta que llega de JS es una
//! ruta que pudo escribir un XSS, así que no se escribe ni se revela nada que el
//! usuario no haya elegido.
//!
//! La carpeta de «Exportar a carpeta…» ya la anota `dialogos::elegir_carpeta`:
//! [`revelar_exportacion`] también la acepta, para ofrecer abrirla al terminar.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use tauri::Manager;
use tauri_plugin_dialog::DialogExt;

/// Archivos elegidos en «Guardar como» para exportar, por etiqueta de ventana,
/// en su forma comparable ([`comparable`]). Se olvidan al cerrar la ventana.
#[derive(Default)]
pub struct ExportadosState(Mutex<HashMap<String, Vec<PathBuf>>>);

/// La forma de comparar una ruta de archivo que quizá todavía no existe: su
/// carpeta canónica más el nombre. `None` si la carpeta no existe.
fn comparable(ruta: &Path) -> Option<PathBuf> {
    let nombre = ruta.file_name()?;
    let padre = ruta.parent()?.canonicalize().ok()?;
    Some(padre.join(nombre))
}

/// Anota `ruta` como destino de exportación elegido por la ventana `label`.
fn anotar(state: &ExportadosState, label: &str, ruta: &Path) -> Result<(), String> {
    let clave = comparable(ruta).ok_or_else(|| format!("No se pudo resolver {}", ruta.display()))?;
    let mut mapa = state.0.lock().map_err(|_| "Registro de exportaciones no disponible".to_string())?;
    let lista = mapa.entry(label.to_string()).or_default();
    if !lista.contains(&clave) {
        lista.push(clave);
    }
    Ok(())
}

/// ¿Eligió la ventana `label` el archivo `pedida` en «Guardar como»?
fn fue_elegido(state: &ExportadosState, label: &str, pedida: &str) -> bool {
    let Some(clave) = comparable(Path::new(pedida)) else { return false };
    state
        .0
        .lock()
        .map(|mapa| mapa.get(label).is_some_and(|l| l.contains(&clave)))
        .unwrap_or(false)
}

/// Olvida lo que exportó una ventana (al cerrarse).
pub fn olvidar_de(state: &ExportadosState, label: &str) {
    if let Ok(mut mapa) = state.0.lock() {
        mapa.remove(label);
    }
}

/// Abre el diálogo **Guardar como** nativo con `nombre` sugerido y un filtro
/// por `extension` (sin punto), lo anota para esta ventana y devuelve la ruta
/// elegida, o `null` si el usuario canceló. El diálogo ya pregunta si
/// sobrescribir un archivo que existe.
#[tauri::command]
pub async fn elegir_destino_exportacion(
    ventana: tauri::Window,
    nombre: String,
    extension: String,
    descripcion: String,
) -> Result<Option<String>, String> {
    let (tx, rx) = tokio::sync::oneshot::channel();
    let mut dialogo = ventana
        .app_handle()
        .dialog()
        .file()
        .set_title("Exportar")
        .set_parent(&ventana)
        .set_file_name(&nombre);
    if !extension.is_empty() {
        dialogo = dialogo.add_filter(&descripcion, &[extension.as_str()]);
    }
    dialogo.save_file(move |elegido| {
        let _ = tx.send(elegido);
    });
    let elegido = rx.await.map_err(|_| "El diálogo para guardar se cerró sin responder.".to_string())?;
    let Some(ruta) = elegido else { return Ok(None) };
    let ruta = ruta
        .into_path()
        .map_err(|e| format!("El archivo elegido no es una ruta del disco: {e}"))?;
    anotar(&ventana.state::<ExportadosState>(), ventana.label(), &ruta)?;
    Ok(Some(ruta.to_string_lossy().to_string()))
}

/// Escribe el cuerpo de la llamada (IPC binario, como `escribir_trozo_importacion`)
/// en el archivo del encabezado `x-ruta` (con `encodeURIComponent`), que tiene
/// que ser uno elegido por esta ventana en [`elegir_destino_exportacion`].
/// Escribe en un temporal al lado y lo renombra: un fallo a mitad no deja un
/// archivo cortado con el nombre del bueno.
#[tauri::command(async)]
pub fn escribir_exportacion(ventana: tauri::Window, request: tauri::ipc::Request<'_>) -> Result<(), String> {
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err("Se esperaban los bytes del archivo en el cuerpo de la llamada.".into());
    };
    let valor = request
        .headers()
        .get("x-ruta")
        .ok_or_else(|| "Falta el encabezado x-ruta".to_string())?
        .to_str()
        .map_err(|_| "El encabezado x-ruta no es ASCII".to_string())?;
    let ruta = crate::archivos::decodificar_uri(valor)?;
    if !fue_elegido(&ventana.state::<ExportadosState>(), ventana.label(), &ruta) {
        return Err(format!("«{ruta}» no es un archivo elegido para exportar: no se escribe."));
    }
    escribir_en(Path::new(&ruta), bytes)
}

fn escribir_en(destino: &Path, bytes: &[u8]) -> Result<(), String> {
    let nombre = destino
        .file_name()
        .ok_or_else(|| format!("Ruta sin nombre de archivo: {}", destino.display()))?;
    let mut temporal = nombre.to_os_string();
    temporal.push(".mycelium-tmp");
    let temporal = destino.with_file_name(temporal);
    std::fs::write(&temporal, bytes).map_err(|e| format!("No se pudo escribir {}: {e}", destino.display()))?;
    std::fs::rename(&temporal, destino).map_err(|e| {
        let _ = std::fs::remove_file(&temporal);
        format!("No se pudo escribir {}: {e}", destino.display())
    })
}

/// Muestra en el explorador del sistema lo que se acaba de exportar: el archivo
/// seleccionado en su carpeta, o la carpeta misma si se exportó a una carpeta.
/// Solo acepta un archivo elegido en [`elegir_destino_exportacion`] o una
/// carpeta elegida en `dialogos::elegir_carpeta`, por esta ventana.
#[tauri::command(async)]
pub fn revelar_exportacion(ventana: tauri::Window, ruta: String) -> Result<(), String> {
    let elegido = fue_elegido(&ventana.state::<ExportadosState>(), ventana.label(), &ruta)
        || crate::dialogos::elegida_por(&ventana, &ruta).is_ok();
    if !elegido {
        return Err(format!("«{ruta}» no es algo que se haya exportado: no se muestra."));
    }
    let destino = PathBuf::from(&ruta);
    if !destino.exists() {
        return Err(format!("Ya no existe: {ruta}"));
    }
    crate::vault_fs::mostrar_en_explorador(&destino)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn solo_vale_el_archivo_que_eligio_esa_ventana() {
        let base = std::env::temp_dir().join(format!("mic-exportaciones-{}", std::process::id()));
        std::fs::create_dir_all(&base).unwrap();
        let elegido = base.join("Nota.md");
        let state = ExportadosState::default();
        anotar(&state, "vault-1", &elegido).unwrap();

        let e = elegido.to_string_lossy().to_string();
        assert!(fue_elegido(&state, "vault-1", &e), "todavía no existe y ya vale");
        assert!(fue_elegido(&state, "vault-1", &base.join(".").join("Nota.md").to_string_lossy()));
        assert!(!fue_elegido(&state, "vault-1", &base.join("Otra.md").to_string_lossy()));
        assert!(!fue_elegido(&state, "vault-2", &e), "otra ventana no");
        assert!(!fue_elegido(&state, "vault-1", "Z:/no/existe/Nota.md"));

        escribir_en(&elegido, b"hola").unwrap();
        assert_eq!(std::fs::read(&elegido).unwrap(), b"hola");
        escribir_en(&elegido, b"de nuevo").unwrap();
        assert_eq!(std::fs::read(&elegido).unwrap(), b"de nuevo", "sobrescribe");
        assert!(!base.join("Nota.md.mycelium-tmp").exists(), "no deja el temporal");

        olvidar_de(&state, "vault-1");
        assert!(!fue_elegido(&state, "vault-1", &e));
        let _ = std::fs::remove_dir_all(base);
    }
}
