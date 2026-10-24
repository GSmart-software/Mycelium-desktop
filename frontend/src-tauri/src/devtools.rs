//! Las herramientas de desarrollo, **por vault y apagadas por defecto**.
//!
//! La feature `devtools` del crate `tauri` sigue compilada en producción (sin
//! ella las APIs no existen fuera de debug), pero ya no basta con apretar F12:
//! la ventana tiene que tener abierto un vault con el interruptor «Herramientas
//! de desarrollo» encendido **en esta máquina** (`config_local.rs`). Encendido
//! en un vault, sigue apagado en los demás; un vault ajeno no puede traerlo
//! puesto porque la decisión no viaja en `.mycelium/`.
//!
//! El motivo es la ingeniería social de siempre —«pegá esto en la consola»—: con
//! el IPC de Tauri a mano, un código pegado ahí puede leer los archivos del
//! vault. Este interruptor **no** es una frontera contra código que ya corre en
//! la webview (ese código ya tiene el IPC); es que la consola no esté a un F12
//! de distancia para quien no la pidió.
//!
//! ## Cómo se apagan
//!
//! - **Windows (WebView2)**: `ICoreWebView2Settings::SetAreDevToolsEnabled`,
//!   por webview y en tiempo de ejecución, llegando al controlador con
//!   `with_webview`. Con `false`, WebView2 ignora F12 y Ctrl+Shift+I y quita
//!   «Inspeccionar» del menú contextual. Se apaga al crearse cada webview
//!   (plugin [`init`]), se fija según el vault al registrarlo
//!   (`ventanas::registrar_vault`) y se vuelve a apagar al soltarlo.
//! - **Todas las plataformas**: [`alternar_devtools`] —el atajo del frontend y
//!   el `open_devtools` programático— comprueba el interruptor antes de abrir.
//! - **macOS y Linux**: wry no expone cómo cambiarlo en tiempo de ejecución y
//!   hacerlo a mano (WKWebView `isInspectable`, WebKitGTK
//!   `enable-developer-extras`) es código de plataforma que no se puede probar
//!   desde Windows. Ahí el interruptor controla el atajo y la apertura
//!   programática; el «Inspeccionar elemento» nativo del menú contextual queda.
//!
//! En desarrollo (`tauri::is_dev()`) siguen siempre disponibles.

use tauri::plugin::TauriPlugin;
use tauri::{Manager, Runtime};

/// Habilita o no las DevTools de un webview de WebView2. En las demás
/// plataformas no hace nada (ver el módulo).
fn fijar_en_webview<R: Runtime>(webview: &tauri::Webview<R>, habilitar: bool) {
    #[cfg(windows)]
    {
        let _ = webview.with_webview(move |pw| {
            // SAFETY: llamadas COM sobre el controlador vivo del webview, en el
            // hilo en que `with_webview` ejecuta el cierre (el de la UI).
            unsafe {
                if let Ok(core) = pw.controller().CoreWebView2() {
                    if let Ok(ajustes) = core.Settings() {
                        let _ = ajustes.SetAreDevToolsEnabled(habilitar);
                    }
                }
            }
        });
    }
    #[cfg(not(windows))]
    {
        let _ = (webview, habilitar);
    }
}

/// Aplica el interruptor a la ventana `label`. En desarrollo, siempre
/// habilitadas.
pub fn aplicar_a<R: Runtime>(app: &tauri::AppHandle<R>, label: &str, habilitar: bool) {
    let habilitar = habilitar || tauri::is_dev();
    if let Some(w) = app.get_webview_window(label) {
        fijar_en_webview(w.as_ref(), habilitar);
    }
}

/// Apaga las DevTools de cada webview apenas se crea (en producción). La
/// ventana no tiene vault todavía: el interruptor se mira al registrarlo.
pub fn init<R: Runtime>() -> TauriPlugin<R> {
    tauri::plugin::Builder::new("devtools-por-vault")
        .on_webview_ready(|webview| {
            if !tauri::is_dev() {
                fijar_en_webview(&webview, false);
            }
        })
        .build()
}

/// ¿Se pueden abrir en esta ventana? En desarrollo, siempre; si no, según el
/// vault que tenga abierto.
fn permitidas<R: Runtime>(app: &tauri::AppHandle<R>, label: &str) -> bool {
    tauri::is_dev() || crate::config_local::de_ventana(app, label).devtools
}

/// Abre o cierra las herramientas de desarrollo de la ventana. Lo invoca el
/// frontend con F12 / Ctrl+Shift+I.
///
/// `forzar` lo manda solo un comando interno de la paleta, que no depende del
/// interruptor (no es una frontera: ver el módulo).
#[tauri::command]
pub fn alternar_devtools(webview: tauri::WebviewWindow, forzar: Option<bool>) -> Result<(), String> {
    if webview.is_devtools_open() {
        webview.close_devtools();
        return Ok(());
    }
    if !(forzar == Some(true) || permitidas(webview.app_handle(), webview.label())) {
        return Err(
            "Las herramientas de desarrollo están apagadas en este vault. Se encienden en Configuración → Avanzado."
                .to_string(),
        );
    }
    // Habilitadas antes de abrir: WebView2 no abre nada con el ajuste apagado.
    fijar_en_webview(webview.as_ref(), true);
    webview.open_devtools();
    Ok(())
}
