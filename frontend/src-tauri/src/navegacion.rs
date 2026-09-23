//! Red de seguridad contra que la app se vaya de su propia página (`FUN-S-20`).
//!
//! El defecto que la motiva (`DEF-101`) era el más grave del catálogo: un clic en
//! un `[texto](https://…)` **navegaba la webview** y se llevaba Mycelium entero.
//! El marco de ventana es propio (`FUN-M-31`), así que no quedaba barra de
//! dirección ni botón de volver: la única salida era cerrar la app.
//!
//! El arreglo de verdad está en el frontend, que intercepta el clic y abre el
//! navegador. Esto es lo de abajo: **si algún camino se olvida —o aparece uno
//! nuevo— la navegación no llega a ocurrir**. Es deliberadamente tonto y
//! deliberadamente el último en decidir.
//!
//! > [!important] Solo el documento de arriba, no los iframes
//! > `on_navigation` se conecta en Windows a `NavigationStarting` de WebView2
//! > (ver `wry/src/webview2/mod.rs`), que **solo dispara para el documento
//! > principal**: los iframes usan `FrameNavigationStarting`, que wry no
//! > engancha. Por eso esto NO estorba al iframe de draw.io (`FUN-L-20`) ni al
//! > del reproductor de vídeo (`FUN-S-21`), que cargan orígenes ajenos por
//! > diseño.
//! >
//! > Si algún día wry engancha también los iframes, **el vídeo dejaría de
//! > cargar** y habría que distinguir el marco acá. Queda dicho porque el
//! > síntoma (un recuadro vacío) no apunta ni de lejos a este archivo.

use tauri::plugin::TauriPlugin;
use tauri::{Runtime, Url};

/// ¿Esta URL es la propia aplicación?
///
/// En producción Tauri sirve el front por `tauri://localhost` (y
/// `http://tauri.localhost` en Windows); en desarrollo, desde
/// `http://localhost:3000`. Todo lo demás es «afuera».
fn es_la_app(url: &Url) -> bool {
    match url.scheme() {
        // El esquema propio de Tauri, y el `asset:` con el que se sirven los
        // archivos del vault al visor (`FUN-L-11`).
        "tauri" | "asset" => true,
        "http" | "https" => matches!(
            url.host_str(),
            Some("tauri.localhost") | Some("localhost") | Some("127.0.0.1")
        ),
        // `about:blank` es el estado inicial de cualquier webview.
        "about" => true,
        _ => false,
    }
}

/// Registra el guardián de navegación para **todas** las ventanas.
///
/// Va como plugin y no como `WebviewWindowBuilder::on_navigation` a propósito:
/// la ventana principal la crea `tauri.conf.json`, así que un `on_navigation`
/// por constructor dejaría fuera justo la ventana donde se reportó el defecto.
pub fn init<R: Runtime>() -> TauriPlugin<R> {
    tauri::plugin::Builder::new("navegacion-segura")
        .on_navigation(|webview, url| {
            if es_la_app(url) {
                return true;
            }
            // Fuera de la app: no se navega, se abre en el navegador del
            // sistema. Llegar acá significa que el frontend no interceptó el
            // clic —un camino sin cubrir—, así que además de no romper nada se
            // hace lo que el usuario esperaba.
            let destino = url.to_string();
            log::warn!(
                "navegación a un origen ajeno bloqueada y derivada al navegador: {destino}"
            );
            let _ = tauri_plugin_opener::open_url(destino, None::<&str>);
            let _ = webview;
            false
        })
        .build()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn u(s: &str) -> Url {
        Url::parse(s).unwrap()
    }

    #[test]
    fn la_app_puede_navegar_dentro_de_si_misma() {
        assert!(es_la_app(&u("tauri://localhost/workspace")));
        assert!(es_la_app(&u("http://tauri.localhost/workspace")));
        assert!(es_la_app(&u("http://localhost:3000/workspace")));
        assert!(es_la_app(&u("http://127.0.0.1:3000/")));
        assert!(es_la_app(&u("about:blank")));
        // El editor de draw.io se sirve del mismo origen (`FUN-L-20`).
        assert!(es_la_app(&u("http://tauri.localhost/drawio/index.html?embed=1")));
    }

    #[test]
    fn un_sitio_de_afuera_no_se_lleva_la_ventana() {
        // Esto es `DEF-101`: el clic que hacía desaparecer la app.
        assert!(!es_la_app(&u("https://www.wikipedia.org/")));
        assert!(!es_la_app(&u("http://example.com/")));
        assert!(!es_la_app(&u("https://www.youtube-nocookie.com/embed/x")));
    }

    #[test]
    fn un_host_parecido_al_nuestro_tampoco_pasa() {
        // `localhost.evil.com` termina distinto de `localhost`: la comparación
        // es por host COMPLETO, no por sufijo.
        assert!(!es_la_app(&u("http://localhost.evil.com/")));
        assert!(!es_la_app(&u("http://notlocalhost/")));
        assert!(!es_la_app(&u("http://tauri.localhost.evil.com/")));
    }

    #[test]
    fn los_esquemas_raros_no_son_la_app() {
        assert!(!es_la_app(&u("file:///C:/Windows/System32/cmd.exe")));
        assert!(!es_la_app(&u("mailto:alguien@ejemplo.com")));
        assert!(!es_la_app(&u("ms-msdt:/id")));
    }
}
