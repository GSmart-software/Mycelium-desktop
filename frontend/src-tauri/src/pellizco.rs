//! El pellizco del touchpad llega a la página (`DEF-187`), sin que vuelva el
//! zoom de toda la interfaz.
//!
//! ## El problema
//!
//! El visor de imágenes (`FUN-S-41`) y el lienzo hacen zoom con la rueda +
//! `ctrlKey`, que es como Chromium entrega a la página el pellizco de un
//! touchpad de precisión. Pero wry apaga **juntos** dos ajustes de WebView2 con
//! una sola bandera (`zoom_hotkeys_enabled`, `false` por defecto):
//! `IsZoomControlEnabled` (Ctrl+/Ctrl-/Ctrl+0 y Ctrl+rueda como zoom del
//! navegador) e `IsPinchZoomEnabled`. Con el segundo apagado, WebView2 se come
//! el gesto y la página no recibe **ningún** `wheel`: medido por CDP con
//! `Input.synthesizePinchGesture`, 0 eventos.
//!
//! ## Por qué no basta con encenderlo después
//!
//! Lo natural sería fijar `IsPinchZoomEnabled(true)` al crearse el webview, como
//! hace `devtools.rs` con sus manejadores. No sirve: según la documentación de
//! `ICoreWebView2Settings` y `ICoreWebView2Settings5`, este ajuste —como todos
//! salvo los dos de autocompletado— hecho después de `NavigationStarting` rige
//! **desde la próxima navegación de primer nivel** («the end user cannot pinch
//! zoom after the next navigation», y el ejemplo de Microsoft lo avisa igual al
//! encenderlo). Cuando `on_webview_ready` corre, wry ya navegó a la página, y la
//! app es de una sola página: no vuelve a navegar. Es la misma trampa que
//! `devtools.rs` documenta para `AreDevToolsEnabled`.
//!
//! ## Cómo se resuelve
//!
//! 1. **Antes de la primera navegación**, con la bandera de wry encendida en
//!    Windows: [`habilitar_en_config`] para las ventanas de `tauri.conf.json` y
//!    [`con_pellizco`] para las que se crean por código. Así wry fija los dos
//!    ajustes en `true` antes de navegar, y el pellizco llega.
//! 2. **El zoom del navegador se vuelve a cerrar a mano**, porque la bandera
//!    también encendió `IsZoomControlEnabled` (y por lo mismo de arriba, apagarlo
//!    después no rige):
//!    - Ctrl+/Ctrl-/Ctrl+0 (también los del teclado numérico): un manejador de
//!      `AcceleratorKeyPressed` los marca con
//!      `IsBrowserAcceleratorKeyEnabled(false)`. El navegador no los atiende y
//!      la página **sí** recibe la tecla, igual que en `devtools.rs`.
//!    - Ctrl+rueda y el pellizco: el frontend llama a `preventDefault` en todo
//!      `wheel` con `ctrlKey` (`components/ventana/SinZoomDePagina.tsx`). Eso
//!      impide tanto el zoom del navegador como el de página (la escala del
//!      visual viewport) que Chromium aplica si nadie cancela el evento.
//!    - Red de seguridad: si aun así el `ZoomFactor` se mueve (una rueda que
//!      llegara antes de que la página monte su guarda), `ZoomFactorChanged` lo
//!      devuelve a 1. La app no usa el zoom del navegador para nada.
//!    - Además se fija `IsZoomControlEnabled(false)`: no rige ahora, pero sí
//!      tras una recarga (F5), y deja el ajuste como lo quería wry.
//!
//! ## macOS y Linux
//!
//! No se toca nada: ahí Tauri implementa `zoom_hotkeys_enabled` inyectando un
//! script propio de zoom con Ctrl+/Ctrl-, que es justo lo que no se quiere, así
//! que la bandera se enciende **solo en Windows**. En WKWebView y WebKitGTK el
//! pellizco del touchpad no depende de un ajuste equivalente.

use tauri::plugin::TauriPlugin;
use tauri::{Manager, Runtime, WebviewWindowBuilder};

/// Enciende el pellizco de WebView2 en las ventanas de `tauri.conf.json`
/// **antes** de que se creen. Solo Windows (ver el módulo).
pub fn habilitar_en_config<R: Runtime>(contexto: &mut tauri::Context<R>) {
    #[cfg(windows)]
    for ventana in &mut contexto.config_mut().app.windows {
        ventana.zoom_hotkeys_enabled = true;
    }
    #[cfg(not(windows))]
    let _ = contexto;
}

/// Lo mismo para una ventana creada por código: todo `WebviewWindowBuilder`
/// de la app pasa por acá.
pub fn con_pellizco<'a, R: Runtime, M: Manager<R>>(
    constructor: WebviewWindowBuilder<'a, R, M>,
) -> WebviewWindowBuilder<'a, R, M> {
    #[cfg(windows)]
    return constructor.zoom_hotkeys_enabled(true);
    #[cfg(not(windows))]
    constructor
}

/// Teclas virtuales de Win32 del zoom de Chromium.
const VK_OEM_PLUS: u32 = 0xBB;
const VK_OEM_MINUS: u32 = 0xBD;
const VK_ADD: u32 = 0x6B;
const VK_SUBTRACT: u32 = 0x6D;
const VK_0: u32 = 0x30;
const VK_NUMPAD0: u32 = 0x60;

/// ¿Es un atajo con el que Chromium cambia el zoom del navegador? Ctrl con
/// `+`, `-` o `0`, de la fila principal o del teclado numérico (con o sin
/// Shift: Chromium acepta Ctrl+Shift+`+`, que en varias distribuciones es la
/// forma de escribir el `+`).
pub fn es_atajo_zoom(tecla: u32, ctrl: bool) -> bool {
    ctrl && matches!(tecla, VK_OEM_PLUS | VK_OEM_MINUS | VK_ADD | VK_SUBTRACT | VK_0 | VK_NUMPAD0)
}

/// Cierra el zoom del navegador en un webview que nació con la bandera de wry
/// encendida (ver el módulo).
#[cfg(windows)]
fn cerrar_zoom_del_navegador<R: Runtime>(webview: &tauri::Webview<R>) {
    use webview2_com::Microsoft::Web::WebView2::Win32::{
        ICoreWebView2AcceleratorKeyPressedEventArgs2, COREWEBVIEW2_KEY_EVENT_KIND,
        COREWEBVIEW2_KEY_EVENT_KIND_KEY_DOWN, COREWEBVIEW2_KEY_EVENT_KIND_SYSTEM_KEY_DOWN,
    };
    use webview2_com::{AcceleratorKeyPressedEventHandler, ZoomFactorChangedEventHandler};
    use windows::core::Interface;
    use windows::Win32::UI::Input::KeyboardAndMouse::{GetKeyState, VK_CONTROL};

    let label = webview.label().to_string();
    let r = webview.with_webview(move |pw| {
        let controlador = pw.controller();

        // SAFETY: COM sobre el controlador vivo, en el hilo de la UI (donde
        // `with_webview` corre el cierre); los manejadores corren en ese hilo.
        let r_teclas = unsafe {
            let mut token = 0i64;
            controlador.add_AcceleratorKeyPressed(
                &AcceleratorKeyPressedEventHandler::create(Box::new(move |_, args| {
                    let Some(args) = args else { return Ok(()) };
                    let mut tipo = COREWEBVIEW2_KEY_EVENT_KIND::default();
                    args.KeyEventKind(&mut tipo)?;
                    if tipo != COREWEBVIEW2_KEY_EVENT_KIND_KEY_DOWN
                        && tipo != COREWEBVIEW2_KEY_EVENT_KIND_SYSTEM_KEY_DOWN
                    {
                        return Ok(());
                    }
                    let mut tecla = 0u32;
                    args.VirtualKey(&mut tecla)?;
                    if !es_atajo_zoom(tecla, GetKeyState(VK_CONTROL.0 as i32) < 0) {
                        return Ok(());
                    }
                    match args.cast::<ICoreWebView2AcceleratorKeyPressedEventArgs2>() {
                        // El navegador no la atiende; la página la recibe igual.
                        Ok(args2) => args2.SetIsBrowserAcceleratorKeyEnabled(false),
                        // WebView2 anterior a 1.0.2210: se la come entera.
                        Err(_) => args.SetHandled(true),
                    }
                })),
                &mut token,
            )
        };
        if let Err(e) = r_teclas {
            log::warn!("pellizco: no se pudo vigilar los atajos de zoom de «{label}»: {e}");
        }

        // Red de seguridad: el zoom del navegador siempre vuelve a 1.
        let r_factor = unsafe {
            let mut token = 0i64;
            controlador.add_ZoomFactorChanged(
                &ZoomFactorChangedEventHandler::create(Box::new(move |c, _| {
                    let Some(c) = c else { return Ok(()) };
                    let mut factor = 1.0f64;
                    c.ZoomFactor(&mut factor)?;
                    if (factor - 1.0).abs() > f64::EPSILON {
                        c.SetZoomFactor(1.0)?;
                    }
                    Ok(())
                })),
                &mut token,
            )
        };
        if let Err(e) = r_factor {
            log::warn!("pellizco: no se pudo vigilar el zoom de «{label}»: {e}");
        }

        // Rige recién tras una recarga (F5); ahí deja el ajuste como lo quería
        // wry. El pellizco sigue encendido: `IsPinchZoomEnabled` no se toca.
        let r_ajuste = unsafe { controlador.CoreWebView2().and_then(|c| c.Settings()) }
            .and_then(|ajustes| unsafe { ajustes.SetIsZoomControlEnabled(false) });
        if let Err(e) = r_ajuste {
            log::warn!("pellizco: no se pudo fijar IsZoomControlEnabled en «{label}»: {e}");
        }
    });
    if let Err(e) = r {
        log::warn!("pellizco: no se llegó al webview «{}»: {e}", webview.label());
    }
}

/// En Windows, cada webview cierra el zoom del navegador al crearse.
pub fn init<R: Runtime>() -> TauriPlugin<R> {
    tauri::plugin::Builder::new("pellizco")
        .on_webview_ready(|webview| {
            #[cfg(windows)]
            cerrar_zoom_del_navegador(&webview);
            #[cfg(not(windows))]
            let _ = webview;
        })
        .build()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reconoce_los_atajos_de_zoom() {
        for tecla in [VK_OEM_PLUS, VK_OEM_MINUS, VK_ADD, VK_SUBTRACT, VK_0, VK_NUMPAD0] {
            assert!(es_atajo_zoom(tecla, true), "Ctrl+{tecla:#x}");
            assert!(!es_atajo_zoom(tecla, false), "sin Ctrl, {tecla:#x} no");
        }
        // Atajos de la app que no son del zoom.
        for tecla in [b'1' as u32, b'9' as u32, b'Z' as u32, b'P' as u32, 0x61 /* Numpad1 */] {
            assert!(!es_atajo_zoom(tecla, true), "Ctrl+{tecla:#x}");
        }
    }
}
