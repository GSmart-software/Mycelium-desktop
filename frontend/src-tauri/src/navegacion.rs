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
//!
//! > [!warning] Al sistema solo van `http`, `https` y `mailto` (`DEF-163`)
//! > El guardián abría en el sistema **cualquier** URL de afuera. Como lo hacía
//! > desde Rust, se salteaba el alcance del opener y la lista
//! > `ESQUEMAS_PERMITIDOS` del frontend (`lib/enlacesExternos.ts`): un
//! > `[Factura](search-ms:…)`, `ms-word:ofe|u|…` o `ms-officecmd:` que el
//! > frontend descartaba por esquema llegaba igual a `ShellExecute`, sin el
//! > diálogo que WebView2 habría mostrado. Ahora el guardián aplica la misma
//! > lista: lo demás se cancela y se registra.
//!
//! > [!info] Ventanas nuevas (`window.open`, `target="_blank"`)
//! > No pasan por acá: van por `NewWindowRequested`. Mientras ninguna ventana
//! > registre `on_new_window`, wry contesta `SetHandled(true)` sin crear nada
//! > (`wry/src/webview2/mod.rs`), o sea que **se descartan**. Si alguien agrega
//! > un `on_new_window`, tiene que pasar por `que_hacer` igual que esto.

use tauri::plugin::TauriPlugin;
use tauri::{Runtime, Url};

/// Los esquemas que se pueden mandar al sistema. Es la misma lista que
/// `ESQUEMAS_PERMITIDOS` de `lib/enlacesExternos.ts`: si cambia una, cambia la
/// otra.
const ESQUEMAS_AL_SISTEMA: [&str; 3] = ["http", "https", "mailto"];

/// ¿Esta URL es la propia aplicación?
///
/// En producción Tauri sirve el front por `tauri://localhost` (y
/// `http://tauri.localhost` en Windows); en desarrollo, desde
/// `http://localhost:3000` (`devUrl` de `tauri.conf.json`). Todo lo demás es
/// «afuera».
///
/// `localhost` y `127.0.0.1` cuentan como la app **solo en desarrollo**
/// (`DEF-163`): en producción la app nunca se sirve desde ahí, así que dejarlos
/// pasar le daba a cualquier servicio local —en cualquier puerto— la ventana
/// entera, con el IPC de Tauri a mano si el origen coincidiera.
fn es_la_app(url: &Url, en_desarrollo: bool) -> bool {
    match url.scheme() {
        // El esquema propio de Tauri, y el `asset:` con el que se sirven los
        // archivos del vault al visor (`FUN-L-11`).
        "tauri" | "asset" => true,
        "http" | "https" => match url.host_str() {
            Some("tauri.localhost") => true,
            Some("localhost") | Some("127.0.0.1") => en_desarrollo,
            _ => false,
        },
        // `about:blank` es el estado inicial de cualquier webview.
        "about" => true,
        _ => false,
    }
}

/// Lo que el guardián hace con una navegación.
#[derive(Debug, PartialEq, Eq)]
enum Decision {
    /// Es la app: la webview navega.
    Navegar,
    /// Es de afuera y con un esquema conocido: se cancela y se abre en el
    /// navegador (o el cliente de correo) del sistema.
    AbrirEnElSistema,
    /// Es de afuera con cualquier otro esquema: se cancela y nada más.
    Cancelar,
}

/// Decide qué hacer con una navegación. Separado del plugin para poder probarlo.
///
/// `Url` ya normaliza el esquema (lo pasa a minúsculas y recorta los espacios y
/// controles de los bordes, como el `URL` del navegador); el `to_ascii_lowercase`
/// es por si algún día llega una URL armada a mano.
fn que_hacer(url: &Url, en_desarrollo: bool) -> Decision {
    if es_la_app(url, en_desarrollo) {
        return Decision::Navegar;
    }
    let esquema = url.scheme().to_ascii_lowercase();
    if ESQUEMAS_AL_SISTEMA.contains(&esquema.as_str()) {
        Decision::AbrirEnElSistema
    } else {
        Decision::Cancelar
    }
}

/// Registra el guardián de navegación para **todas** las ventanas.
///
/// Va como plugin y no como `WebviewWindowBuilder::on_navigation` a propósito:
/// la ventana principal la crea `tauri.conf.json`, así que un `on_navigation`
/// por constructor dejaría fuera justo la ventana donde se reportó el defecto.
pub fn init<R: Runtime>() -> TauriPlugin<R> {
    tauri::plugin::Builder::new("navegacion-segura")
        .on_navigation(|_webview, url| match que_hacer(url, tauri::is_dev()) {
            Decision::Navegar => true,
            Decision::AbrirEnElSistema => {
                // Fuera de la app: no se navega, se abre en el navegador del
                // sistema. Llegar acá significa que el frontend no interceptó
                // el clic —un camino sin cubrir—, así que además de no romper
                // nada se hace lo que el usuario esperaba.
                let destino = url.to_string();
                log::warn!(
                    "navegación a un origen ajeno bloqueada y derivada al navegador: {destino}"
                );
                let _ = tauri_plugin_opener::open_url(destino, None::<&str>);
                false
            }
            Decision::Cancelar => {
                // Un esquema que el sistema resolvería con otro programa
                // (`search-ms:`, `ms-word:`, `file:`…): ni se navega ni se abre.
                log::warn!(
                    "navegación bloqueada: el esquema «{}» no se abre fuera de la app: {url}",
                    url.scheme()
                );
                false
            }
        })
        .build()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn u(s: &str) -> Url {
        Url::parse(s).unwrap()
    }

    /// Lo que decide el guardián en producción.
    fn en_release(s: &str) -> Decision {
        que_hacer(&u(s), false)
    }

    #[test]
    fn la_app_puede_navegar_dentro_de_si_misma() {
        for dev in [false, true] {
            assert!(es_la_app(&u("tauri://localhost/workspace"), dev));
            assert!(es_la_app(&u("http://tauri.localhost/workspace"), dev));
            assert!(es_la_app(&u("about:blank"), dev));
            // El editor de draw.io se sirve del mismo origen (`FUN-L-20`).
            assert!(es_la_app(&u("http://tauri.localhost/drawio/index.html?embed=1"), dev));
        }
    }

    #[test]
    fn localhost_es_la_app_solo_en_desarrollo() {
        // `DEF-163`: en desarrollo el front se sirve de `devUrl`.
        assert!(es_la_app(&u("http://localhost:3000/workspace"), true));
        assert!(es_la_app(&u("http://127.0.0.1:3000/"), true));
        // En producción la app nunca está ahí: un servicio local cualquiera no
        // se queda con la ventana. Como es `http`, va al navegador.
        assert!(!es_la_app(&u("http://localhost:3000/workspace"), false));
        assert!(!es_la_app(&u("http://127.0.0.1:8080/"), false));
        assert_eq!(en_release("http://localhost:3000/"), Decision::AbrirEnElSistema);
        assert_eq!(que_hacer(&u("http://localhost:3000/"), true), Decision::Navegar);
    }

    #[test]
    fn un_sitio_de_afuera_no_se_lleva_la_ventana() {
        // Esto es `DEF-101`: el clic que hacía desaparecer la app.
        assert!(!es_la_app(&u("https://www.wikipedia.org/"), true));
        assert!(!es_la_app(&u("http://example.com/"), true));
        assert!(!es_la_app(&u("https://www.youtube-nocookie.com/embed/x"), true));
    }

    #[test]
    fn un_host_parecido_al_nuestro_tampoco_pasa() {
        // `localhost.evil.com` termina distinto de `localhost`: la comparación
        // es por host COMPLETO, no por sufijo.
        assert!(!es_la_app(&u("http://localhost.evil.com/"), true));
        assert!(!es_la_app(&u("http://notlocalhost/"), true));
        assert!(!es_la_app(&u("http://tauri.localhost.evil.com/"), true));
    }

    #[test]
    fn la_web_y_el_correo_se_abren_en_el_sistema() {
        assert_eq!(en_release("https://x"), Decision::AbrirEnElSistema);
        assert_eq!(en_release("http://example.com/"), Decision::AbrirEnElSistema);
        assert_eq!(en_release("mailto:alguien@ejemplo.com"), Decision::AbrirEnElSistema);
        // La misma normalización que el `URL` del frontend.
        assert_eq!(en_release("HTTPS://x"), Decision::AbrirEnElSistema);
        assert_eq!(en_release("  MailTo:a@b.c"), Decision::AbrirEnElSistema);
    }

    #[test]
    fn los_demas_esquemas_se_cancelan_sin_abrir_nada() {
        // `DEF-163`: lo que el frontend descarta por esquema no puede llegar a
        // `ShellExecute` por la puerta de atrás.
        for url in [
            r"search-ms:query=x&crumb=location:\atacante\share",
            "ms-word:ofe|u|https://atacante.example/doc.docx",
            "ms-officecmd:%7B%7D",
            "ms-msdt:/id PCWDiagnostic",
            "file:///C:/Windows/System32/cmd.exe",
            "javascript:alert(1)",
            "data:text/html,<script>alert(1)</script>",
            "vbscript:msgbox(1)",
            "esquema-inventado:lo-que-sea",
            "SEARCH-MS:query=x",
        ] {
            assert_eq!(en_release(url), Decision::Cancelar, "{url}");
            assert_eq!(que_hacer(&u(url), true), Decision::Cancelar, "{url} (dev)");
        }
    }

    #[test]
    fn una_ruta_unc_no_se_abre() {
        // `\servidor\share` no es una URL absoluta: si WebView2 la resuelve,
        // llega como `file://servidor/share`, que se cancela.
        assert!(Url::parse(r"\servidor\share").is_err());
        assert_eq!(en_release("file://servidor/share"), Decision::Cancelar);
    }
}
