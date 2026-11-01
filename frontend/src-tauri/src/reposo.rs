//! La ventana minimizada deja de dibujar (`DEF-174`).
//!
//! > [!warning] El WebView2 no se entera solo de que la ventana se minimizó
//! > Medido en la `2.6.0`: con la ventana minimizada, la página seguía con
//! > `document.visibilityState === "visible"` y `requestAnimationFrame` corría a
//! > 40 cuadros por segundo o más. Toda animación —la consola estilada, el grafo—
//! > seguía gastando CPU y GPU para una ventana que nadie ve (13 % de la CPU con
//! > la consola estilada a la vista).
//! >
//! > El que decide si el WebView2 dibuja es su **controlador**
//! > (`ICoreWebView2Controller::IsVisible`), y wry solo lo toca al mostrar u
//! > ocultar la ventana, no al minimizarla. Microsoft recomienda ponerlo en
//! > `false` al minimizar: el WebView2 pasa la página a `hidden`, deja de
//! > componer cuadros y frena `requestAnimationFrame` y los temporizadores, igual
//! > que una pestaña de fondo de Edge.
//!
//! Minimizar llega como un `Resized` (Windows manda `WM_SIZE` con
//! `SIZE_MINIMIZED`) y restaurar, como otro. Solo se actúa en el **cambio** de
//! estado: `Resized` llega muchas veces seguidas al redimensionar.
//!
//! Lo que no es minimizar —la ventana sin foco, tapada por otras— lo resuelve
//! el frontend pausando las animaciones (`components/ventana/ReposoVentana.tsx`):
//! ahí la ventana puede estar a la vista en otro monitor, y la página tiene que
//! seguir mostrándose.

use std::collections::HashSet;
use std::sync::Mutex;

use tauri::{Manager, Runtime, Window, WindowEvent};

/// Las ventanas (por etiqueta) cuyo WebView2 está oculto por minimizadas.
static OCULTAS: Mutex<Option<HashSet<String>>> = Mutex::new(None);

/// Llamar desde `on_window_event` con cada evento de cada ventana.
pub fn al_evento<R: Runtime>(ventana: &Window<R>, evento: &WindowEvent) {
    match evento {
        WindowEvent::Resized(_) => {
            let minimizada = ventana.is_minimized().unwrap_or(false);
            let etiqueta = ventana.label().to_string();
            let cambio = {
                let mut g = OCULTAS.lock().unwrap_or_else(|e| e.into_inner());
                let ocultas = g.get_or_insert_with(HashSet::new);
                if minimizada {
                    ocultas.insert(etiqueta)
                } else {
                    ocultas.remove(&etiqueta)
                }
            };
            if cambio {
                fijar_visible(ventana, !minimizada);
            }
        }
        WindowEvent::Destroyed => {
            let mut g = OCULTAS.lock().unwrap_or_else(|e| e.into_inner());
            if let Some(ocultas) = g.as_mut() {
                ocultas.remove(ventana.label());
            }
        }
        _ => {}
    }
}

#[cfg(windows)]
fn fijar_visible<R: Runtime>(ventana: &Window<R>, visible: bool) {
    let Some(webview) = ventana.app_handle().get_webview_window(ventana.label()) else {
        return;
    };
    let etiqueta = ventana.label().to_string();
    let r = webview.with_webview(move |pw| {
        // SAFETY: COM sobre el controlador vivo del webview, en el hilo en que
        // `with_webview` ejecuta el cierre (el de la UI).
        if let Err(e) = unsafe { pw.controller().SetIsVisible(visible) } {
            log::warn!("reposo: no se pudo fijar IsVisible={visible} en «{etiqueta}»: {e}");
        }
    });
    if let Err(e) = r {
        log::warn!("reposo: no se llegó al webview «{}»: {e}", ventana.label());
    }
}

#[cfg(not(windows))]
fn fijar_visible<R: Runtime>(_ventana: &Window<R>, _visible: bool) {
    // En macOS y Linux el sistema ya frena el webview de una ventana minimizada.
}
