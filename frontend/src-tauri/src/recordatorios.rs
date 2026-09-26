//! La notificación del sistema de un recordatorio del calendario (`FUN-L-22`).
//!
//! La tarjeta de aviso vive en la webview y trae el detalle y los botones; esta
//! notificación es **solo** para cuando la ventana no se ve —minimizada, sin foco
//! o tapada—, y su único trabajo es traer la ventana al frente con la tarjeta.
//!
//! En Windows **no** va por la API JS de `tauri-plugin-notification`: esa API no
//! avisa del clic en escritorio, y sin clic la notificación no puede «traer la
//! ventana». Peor: sin un manejador propio, Windows resuelve el clic relanzando el
//! ejecutable por su AppUserModelID, y el relanzamiento sin argumentos es justo lo
//! que la instancia única convierte en **una ventana nueva** (`DEF-073`). Por eso se
//! arma el toast directamente con `tauri-winrt-notification` —la misma crate que el
//! plugin usa por debajo, así que no se compila nada dos veces— y se le cuelga un
//! `on_activated` que enfoca la ventana que lo pidió.
//!
//! En los demás sistemas se cae al plugin, sin manejo del clic.

use tauri::{AppHandle, Emitter, Manager, Runtime, WebviewWindow};

/// Evento que recibe la ventana cuando el usuario hace clic en la notificación.
const EVENTO_ACTIVADA: &str = "recordatorio-notificacion-activada";

/// Trae una ventana al frente: la desminimiza, la muestra y le da el foco.
fn traer_al_frente<R: Runtime>(ventana: &WebviewWindow<R>) {
    let _ = ventana.unminimize();
    let _ = ventana.show();
    let _ = ventana.set_focus();
}

/// Muestra la notificación de un recordatorio. `cuerpo` ya viene recortado (el
/// primer renglón del detalle): una notificación del sistema no es lugar para el
/// markdown entero, que se lee en la tarjeta.
///
/// Nunca devuelve error por la notificación en sí: si el sistema la rechaza
/// (notificaciones desactivadas, modo concentración), la tarjeta ya está en la
/// ventana y se verá al volver. Se deja constancia en el log y nada más.
#[tauri::command]
pub fn notificar_recordatorio<R: Runtime>(
    app: AppHandle<R>,
    ventana: WebviewWindow<R>,
    titulo: String,
    cuerpo: String,
) -> Result<(), String> {
    let etiqueta = ventana.label().to_string();
    mostrar(app, etiqueta, titulo, cuerpo);
    Ok(())
}

#[cfg(windows)]
fn mostrar<R: Runtime>(app: AppHandle<R>, etiqueta: String, titulo: String, cuerpo: String) {
    use tauri_winrt_notification::Toast;

    // El AppUserModelID: el del instalador cuando es la app instalada; en
    // desarrollo, el de PowerShell, porque el binario de `target/` no tiene uno
    // registrado y Windows descartaría el toast en silencio. Es el mismo criterio
    // que usa `tauri-plugin-notification`.
    let instalada = tauri::utils::platform::current_exe()
        .ok()
        .and_then(|exe| exe.parent().map(|d| d.to_path_buf()))
        .map(|dir| {
            let d = dir.to_string_lossy().replace('/', "\\");
            !(d.ends_with("\\target\\debug") || d.ends_with("\\target\\release"))
        })
        .unwrap_or(false);
    let app_id = if instalada {
        app.config().identifier.clone()
    } else {
        Toast::POWERSHELL_APP_ID.to_string()
    };

    // En su propio hilo: `show` es una llamada WinRT bloqueante y el comando corre
    // en el hilo de IPC.
    std::thread::spawn(move || {
        let app_clic = app.clone();
        let etiqueta_clic = etiqueta.clone();
        let resultado = Toast::new(&app_id)
            .title(&titulo)
            .text1(&cuerpo)
            .on_activated(move |_| {
                if let Some(v) = app_clic.get_webview_window(&etiqueta_clic) {
                    traer_al_frente(&v);
                    let _ = v.emit(EVENTO_ACTIVADA, ());
                }
                Ok(())
            })
            .show();
        if let Err(e) = resultado {
            log::warn!("[recordatorios] no se pudo mostrar la notificación: {e}");
        }
    });
}

#[cfg(not(windows))]
fn mostrar<R: Runtime>(app: AppHandle<R>, _etiqueta: String, titulo: String, cuerpo: String) {
    use tauri_plugin_notification::NotificationExt;
    if let Err(e) = app.notification().builder().title(titulo).body(cuerpo).show() {
        log::warn!("[recordatorios] no se pudo mostrar la notificación: {e}");
    }
}
