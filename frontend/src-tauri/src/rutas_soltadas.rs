//! La ruta de los archivos que se sueltan desde fuera de la app (`FUN-S-43`).
//!
//! Soltar un archivo sobre la consola integrada escribe su ruta, como Windows
//! Terminal. El arrastre interno de la app es HTML5 y por eso `tauri.conf.json`
//! tiene `dragDropEnabled: false` **a propósito**: con `true`, Tauri intercepta
//! todo arrastre y el HTML5 deja de funcionar. Pero así un archivo que llega del
//! Explorador de Windows es un `File` de HTML5, y WebView2 no da su ruta a la
//! página, por seguridad.
//!
//! La vía documentada de WebView2 para eso: la página llama a
//! `chrome.webview.postMessageWithAdditionalObjects(mensaje, [file, …])` y el
//! host recibe `WebMessageReceived`, cuyos argumentos
//! (`ICoreWebView2WebMessageReceivedEventArgs2::AdditionalObjects`, desde el SDK
//! 1.0.1661) traen cada `File` como `ICoreWebView2File`, con `Path`. Este módulo
//! registra ese manejador y devuelve las rutas a la misma ventana con el evento
//! `rutas-soltadas` (`{ id, rutas }`); el frontend las espera en
//! `lib/consolaSoltar.ts`.
//!
//! ## Convivencia con el IPC de Tauri
//!
//! wry ya tiene su manejador de `WebMessageReceived` (el `postMessage` del IPC).
//! WebView2 llama a **todos** los manejadores registrados, así que los dos ven
//! cada mensaje:
//!
//! - El de wry lee el mensaje con `TryGetWebMessageAsString`, que **falla** si el
//!   mensaje no es un texto. Por eso la página manda un **objeto**
//!   (`{ mycelium: "rutas-soltadas", id }`) y no un JSON en texto: wry corta en
//!   ese `?` y nunca llega a Tauri. Un texto sí llegaría, Tauri no lo podría
//!   leer como invocación y dejaría un `console.error` en la página por cada
//!   soltada.
//! - Este lee con `WebMessageAsJson` y descarta en el acto lo que no lleve la
//!   marca: los mensajes del IPC son textos (su JSON empieza con `"`), así que
//!   ni se parsean.
//!
//! ## Seguridad
//!
//! Solo se devuelven rutas de `File` que **la propia página** le pasó al host, y
//! la página solo tiene `File` que el usuario soltó o eligió: no se amplía lo
//! que la webview ya podía hacer (no se puede pedir la ruta de un archivo
//! cualquiera, solo de uno que el usuario le entregó). Además se descarta todo
//! mensaje que no venga del origen de la app (`Source`): ni un iframe ni una
//! página ajena, si alguna vez llegara a cargarse, recibe nada.
//!
//! Solo Windows. En macOS y Linux no hay equivalente (WKWebView y WebKitGTK no
//! dan la ruta de un `File`): la consola no ofrece soltar archivos de afuera.
//! El arrastre interno (del explorador del vault) no pasa por acá y funciona
//! en todas.

use tauri::plugin::TauriPlugin;
use tauri::{Runtime, Url};

/// La marca del pedido y el nombre del evento con la respuesta.
const MARCA: &str = "rutas-soltadas";

/// Lo que se le devuelve a la ventana: el `id` del pedido y sus rutas.
#[derive(Clone, serde::Serialize)]
struct RutasSoltadas {
    id: u64,
    rutas: Vec<String>,
}

/// El `id` de un pedido de rutas, si el mensaje (su JSON, como lo da
/// `WebMessageAsJson`) es `{"mycelium":"rutas-soltadas","id":<n>}`. Cualquier
/// otra cosa —un mensaje del IPC, que es un texto— es `None` sin parsear.
pub fn id_del_pedido(json: &str) -> Option<u64> {
    if !json.trim_start().starts_with('{') {
        return None;
    }
    let v: serde_json::Value = serde_json::from_str(json).ok()?;
    if v.get("mycelium")?.as_str()? != MARCA {
        return None;
    }
    v.get("id")?.as_u64()
}

/// ¿El mensaje viene de la app? En Windows la app se sirve por
/// `http(s)://tauri.localhost`; en desarrollo, además, desde `devUrl`.
pub fn origen_permitido(fuente: &str, dev: Option<&Url>) -> bool {
    let Ok(url) = Url::parse(fuente) else { return false };
    match (url.scheme(), url.host_str()) {
        ("http" | "https", Some("tauri.localhost")) => true,
        _ => dev.is_some_and(|d| d.origin() == url.origin()),
    }
}

/// Las rutas de los `File` que vinieron con el mensaje. Lo que no sea un
/// archivo, o un archivo sin ruta, se saltea.
#[cfg(windows)]
fn rutas_del_mensaje(
    args: &webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2WebMessageReceivedEventArgs,
) -> Vec<String> {
    use webview2_com::Microsoft::Web::WebView2::Win32::{
        ICoreWebView2File, ICoreWebView2WebMessageReceivedEventArgs2,
    };
    use windows::core::{Interface, PWSTR};

    // Sin la interfaz 2 (WebView2 anterior a 1.0.1661) o sin objetos, nada.
    let Ok(args2) = args.cast::<ICoreWebView2WebMessageReceivedEventArgs2>() else {
        return Vec::new();
    };
    // SAFETY: COM sobre los argumentos vivos del evento, en el hilo de la UI
    // (el del manejador).
    let Ok(objetos) = (unsafe { args2.AdditionalObjects() }) else {
        return Vec::new();
    };
    let mut cuantos = 0u32;
    if unsafe { objetos.Count(&mut cuantos) }.is_err() {
        return Vec::new();
    }
    let mut rutas = Vec::with_capacity(cuantos as usize);
    for i in 0..cuantos {
        let Ok(objeto) = (unsafe { objetos.GetValueAtIndex(i) }) else { continue };
        let Ok(archivo) = objeto.cast::<ICoreWebView2File>() else { continue };
        let mut ruta = PWSTR::null();
        if unsafe { archivo.Path(&mut ruta) }.is_err() {
            continue;
        }
        let ruta = webview2_com::take_pwstr(ruta);
        if !ruta.is_empty() {
            rutas.push(ruta);
        }
    }
    rutas
}

/// Registra el manejador en el webview.
#[cfg(windows)]
fn instalar<R: Runtime>(webview: &tauri::Webview<R>) {
    use tauri::{Emitter, Manager};
    use webview2_com::WebMessageReceivedEventHandler;
    use windows::core::PWSTR;

    let destino = webview.clone();
    let dev = if tauri::is_dev() {
        webview.app_handle().config().build.dev_url.clone()
    } else {
        None
    };
    let label = webview.label().to_string();
    let r = webview.with_webview(move |pw| {
        // SAFETY: COM sobre el controlador vivo, en el hilo de la UI; el
        // manejador corre en ese mismo hilo.
        let r = unsafe {
            pw.controller().CoreWebView2().and_then(|core| {
                let mut token = 0i64;
                core.add_WebMessageReceived(
                    &WebMessageReceivedEventHandler::create(Box::new(move |_, args| {
                        let Some(args) = args else { return Ok(()) };
                        let mut json = PWSTR::null();
                        args.WebMessageAsJson(&mut json)?;
                        let Some(id) = id_del_pedido(&webview2_com::take_pwstr(json)) else {
                            return Ok(());
                        };
                        let mut fuente = PWSTR::null();
                        args.Source(&mut fuente)?;
                        let fuente = webview2_com::take_pwstr(fuente);
                        if !origen_permitido(&fuente, dev.as_ref()) {
                            log::warn!("rutas soltadas: se ignora un pedido de un origen ajeno ({fuente})");
                            return Ok(());
                        }
                        let rutas = rutas_del_mensaje(&args);
                        // Se contesta siempre, aun sin rutas: la página deja de esperar.
                        // A la ventana que lo pidió: `emit` llegaría a todas (`DEF-158`).
                        let _ = destino.emit_to(destino.label(), MARCA, RutasSoltadas { id, rutas });
                        Ok(())
                    })),
                    &mut token,
                )
            })
        };
        if let Err(e) = r {
            log::warn!("rutas soltadas: no se pudo escuchar los mensajes de «{label}»: {e}");
        }
    });
    if let Err(e) = r {
        log::warn!("rutas soltadas: no se llegó al webview «{}»: {e}", webview.label());
    }
}

/// El plugin: en Windows, cada webview nace con el manejador puesto.
pub fn init<R: Runtime>() -> TauriPlugin<R> {
    tauri::plugin::Builder::new("rutas-soltadas")
        .on_webview_ready(|webview| {
            #[cfg(windows)]
            instalar(&webview);
            #[cfg(not(windows))]
            let _ = webview;
        })
        .build()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reconoce_solo_el_pedido_con_la_marca() {
        assert_eq!(id_del_pedido(r#"{"mycelium":"rutas-soltadas","id":7}"#), Some(7));
        assert_eq!(id_del_pedido(r#" {"id":3,"mycelium":"rutas-soltadas"}"#), Some(3));
        // Lo que manda el IPC de Tauri es un texto: su JSON empieza con comillas.
        assert_eq!(id_del_pedido(r#""{\"cmd\":\"x\"}""#), None);
        assert_eq!(id_del_pedido(r#"{"mycelium":"otra-cosa","id":1}"#), None);
        assert_eq!(id_del_pedido(r#"{"mycelium":"rutas-soltadas"}"#), None, "sin id");
        assert_eq!(id_del_pedido(r#"{"mycelium":"rutas-soltadas","id":-1}"#), None);
        assert_eq!(id_del_pedido(r#"{"mycelium":"rutas-soltadas","id":"1"}"#), None);
        assert_eq!(id_del_pedido("{roto"), None);
        assert_eq!(id_del_pedido(""), None);
    }

    #[test]
    fn acepta_solo_el_origen_de_la_app() {
        assert!(origen_permitido("http://tauri.localhost/workspace?note=x", None));
        assert!(origen_permitido("https://tauri.localhost/", None));
        assert!(!origen_permitido("http://tauri.localhost.evil.com/", None));
        assert!(!origen_permitido("https://ejemplo.com/", None));
        assert!(!origen_permitido("http://localhost:3000/", None), "sin devUrl, localhost no");
        assert!(!origen_permitido("no es una url", None));
        assert!(!origen_permitido("drawio://localhost/", None));

        let dev = Url::parse("http://localhost:3000").unwrap();
        assert!(origen_permitido("http://localhost:3000/workspace", Some(&dev)));
        assert!(!origen_permitido("http://localhost:3001/", Some(&dev)), "otro puerto");
        assert!(!origen_permitido("http://127.0.0.1:3000/", Some(&dev)));
    }
}
