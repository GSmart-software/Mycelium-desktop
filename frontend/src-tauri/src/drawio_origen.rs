//! draw.io en su propio origen (`DEF-168`).
//!
//! La webapp de draw.io (`public/drawio/`, `FUN-L-20`) no se sirve desde el
//! origen de la app sino desde un esquema propio, `drawio`: en Windows queda en
//! `http://drawio.localhost/…` y en macOS/Linux en `drawio://localhost/…`. La app
//! le habla **solo por `postMessage`** (`lib/drawioInstancias.ts`,
//! `lib/drawioRender.ts`), validando origen y ventana en los dos sentidos.
//!
//! Qué se sirve y cómo:
//! - **Solo lo que hay dentro de la carpeta de draw.io.** La ruta se decodifica
//!   y se valida segmento por segmento (`ruta_segura`): nada de `..`, `.`,
//!   segmentos vacíos, ocultos, `\`, `:` ni caracteres de control. Lo que no
//!   pasa, o no existe, es 404.
//! - **De dónde sale**: en el instalador, de los assets embebidos en el binario
//!   (el export de Next copia `public/drawio` a `out/drawio`, y `frontendDist` lo
//!   embebe). Se mira la clave exacta antes de pedirla, porque el resolvedor de
//!   assets de Tauri cae a `index.html` de la app cuando no la encuentra. En
//!   desarrollo (`tauri dev`, sin assets embebidos), del disco: `public/drawio`.
//! - **Con su propia CSP** (`drawio/csp.json`): `connect-src` sin el IPC de
//!   Tauri, y `frame-ancestors` limitado a la app. Los `<script>` en línea de
//!   cada HTML entran por hash, igual que hace Tauri con los de la app.
//! - **Con una guarda** (`drawio/guarda.js`) al principio de cada HTML: draw.io
//!   solo arranca dentro de un marco.
//!
//! Lo que Tauri inyecta en la ventana (el puente con Rust) vive solo en el
//! documento principal; los marcos, y draw.io con ellos, no lo tienen.

use std::collections::{BTreeMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

use base64::Engine as _;
use sha2::{Digest, Sha256};
use tauri::http::{header, Method, Request, Response, StatusCode};
use tauri::{AppHandle, Runtime};

/// El esquema del protocolo. `lib/drawio.ts` (`ESQUEMA_DRAWIO`) usa el mismo.
pub const ESQUEMA: &str = "drawio";

/// La carpeta de draw.io dentro del export (`out/drawio`) y de `public/`.
const CARPETA: &str = "drawio";

/// Las directivas de la CSP de draw.io, salvo `frame-ancestors` (depende de
/// dónde corre la app). Las lee también `scripts/smoke-drawio.mjs`.
const CSP_JSON: &str = include_str!("../drawio/csp.json");

/// El script que va al principio de cada HTML de draw.io.
const GUARDA_JS: &str = include_str!("../drawio/guarda.js");

/// Los orígenes desde los que se sirve la app en el instalador: Windows/Android
/// (`http`/`https://tauri.localhost`) y macOS/Linux (`tauri://localhost`).
const ORIGENES_APP: [&str; 3] = ["http://tauri.localhost", "https://tauri.localhost", "tauri://localhost"];

/// Registra el protocolo en el constructor de la app.
pub fn registrar<R: Runtime>(builder: tauri::Builder<R>) -> tauri::Builder<R> {
    builder.register_asynchronous_uri_scheme_protocol(ESQUEMA, |ctx, pedido, respuesta| {
        let app = ctx.app_handle().clone();
        // Descomprimir un asset grande (app.min.js) no tiene que frenar el hilo
        // del webview.
        tauri::async_runtime::spawn_blocking(move || {
            respuesta.respond(atender_en_app(&app, &pedido));
        });
    })
}

fn atender_en_app<R: Runtime>(app: &AppHandle<R>, pedido: &Request<Vec<u8>>) -> Response<Vec<u8>> {
    let ancestros = ancestros_de(app);
    if tauri::is_dev() {
        let raiz = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..").join("public").join(CARPETA);
        atender(pedido.method(), pedido.uri().path(), |rel| leer_de_carpeta(&raiz, rel), &ancestros)
    } else {
        atender(pedido.method(), pedido.uri().path(), |rel| leer_embebido(app, rel), &ancestros)
    }
}

/// Quién puede enmarcar a draw.io: la app, y en desarrollo también `devUrl`.
fn ancestros_de<R: Runtime>(app: &AppHandle<R>) -> Vec<String> {
    let mut v: Vec<String> = ORIGENES_APP.iter().map(|s| s.to_string()).collect();
    if tauri::is_dev() {
        if let Some(url) = &app.config().build.dev_url {
            v.push(url.origin().ascii_serialization());
        }
    }
    v
}

/// Las claves de los assets embebidos que son de draw.io (`/drawio/…`).
fn claves_embebidas<R: Runtime>(app: &AppHandle<R>) -> &'static HashSet<String> {
    static CLAVES: OnceLock<HashSet<String>> = OnceLock::new();
    CLAVES.get_or_init(|| {
        let prefijo = format!("/{CARPETA}/");
        app.asset_resolver()
            .iter()
            .map(|(k, _)| k.replace('\\', "/"))
            .filter(|k| k.starts_with(&prefijo))
            .collect()
    })
}

fn leer_embebido<R: Runtime>(app: &AppHandle<R>, rel: &str) -> Option<Vec<u8>> {
    let clave = format!("/{CARPETA}/{rel}");
    // Sin esta comprobación, una ruta inexistente devolvería el `index.html` de
    // la app (el resolvedor de Tauri cae ahí).
    if !claves_embebidas(app).contains(&clave) {
        return None;
    }
    app.asset_resolver().get(clave).map(|a| a.bytes)
}

/// Lee `rel` de `raiz`, sin salir de ella aunque haya enlaces simbólicos.
fn leer_de_carpeta(raiz: &Path, rel: &str) -> Option<Vec<u8>> {
    let raiz = raiz.canonicalize().ok()?;
    let archivo = raiz.join(rel).canonicalize().ok()?;
    if !archivo.starts_with(&raiz) || !archivo.is_file() {
        return None;
    }
    std::fs::read(archivo).ok()
}

/// Atiende un pedido. Separado de Tauri para poder probarlo.
fn atender(
    metodo: &Method,
    ruta_cruda: &str,
    leer: impl Fn(&str) -> Option<Vec<u8>>,
    ancestros: &[String],
) -> Response<Vec<u8>> {
    if metodo != Method::GET && metodo != Method::HEAD {
        return respuesta_simple(StatusCode::METHOD_NOT_ALLOWED, ancestros);
    }
    let Some(rel) = ruta_segura(ruta_cruda) else {
        return respuesta_simple(StatusCode::NOT_FOUND, ancestros);
    };
    let Some(bytes) = leer(&rel) else {
        return respuesta_simple(StatusCode::NOT_FOUND, ancestros);
    };
    let tipo = tipo_mime(&rel);
    let (cuerpo, hashes) = if tipo.starts_with("text/html") {
        let html = inyectar_guarda(&String::from_utf8_lossy(&bytes));
        let hashes = hashes_en_linea(&html);
        (html.into_bytes(), hashes)
    } else {
        (bytes, Vec::new())
    };
    let largo = cuerpo.len();
    let cuerpo = if metodo == Method::HEAD { Vec::new() } else { cuerpo };
    Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, tipo)
        .header(header::CONTENT_LENGTH, largo)
        .header(header::CONTENT_SECURITY_POLICY, politica(&hashes, ancestros))
        .header(header::X_CONTENT_TYPE_OPTIONS, "nosniff")
        .header(header::REFERRER_POLICY, "no-referrer")
        .body(cuerpo)
        .unwrap_or_else(|_| Response::new(Vec::new()))
}

fn respuesta_simple(estado: StatusCode, ancestros: &[String]) -> Response<Vec<u8>> {
    Response::builder()
        .status(estado)
        .header(header::CONTENT_TYPE, "text/plain; charset=utf-8")
        .header(header::CONTENT_SECURITY_POLICY, politica(&[], ancestros))
        .header(header::X_CONTENT_TYPE_OPTIONS, "nosniff")
        .body(estado.canonical_reason().unwrap_or("").as_bytes().to_vec())
        .unwrap_or_else(|_| Response::new(Vec::new()))
}

/// La ruta relativa dentro de la carpeta de draw.io, o `None` si no es una ruta
/// limpia. `/` es `index.html`.
fn ruta_segura(cruda: &str) -> Option<String> {
    let decodificada = percent_encoding::percent_decode_str(cruda).decode_utf8().ok()?;
    let rel = decodificada.strip_prefix('/').unwrap_or(&decodificada);
    if rel.is_empty() {
        return Some("index.html".to_string());
    }
    for segmento in rel.split('/') {
        if segmento.is_empty() || segmento.starts_with('.') {
            return None;
        }
        if segmento.chars().any(|c| c == '\\' || c == ':' || c.is_control()) {
            return None;
        }
    }
    Some(rel.to_string())
}

/// El tipo MIME por extensión. Lo que no está en la lista va como binario.
fn tipo_mime(rel: &str) -> &'static str {
    let ext = rel.rsplit_once('.').map(|(_, e)| e.to_ascii_lowercase()).unwrap_or_default();
    match ext.as_str() {
        "html" | "htm" => "text/html; charset=utf-8",
        "js" | "mjs" => "text/javascript; charset=utf-8",
        "css" => "text/css; charset=utf-8",
        "json" | "map" => "application/json; charset=utf-8",
        "xml" => "application/xml; charset=utf-8",
        "txt" | "md" => "text/plain; charset=utf-8",
        "svg" => "image/svg+xml",
        "png" => "image/png",
        "gif" => "image/gif",
        "jpg" | "jpeg" => "image/jpeg",
        "webp" => "image/webp",
        "ico" => "image/x-icon",
        "woff" => "font/woff",
        "woff2" => "font/woff2",
        "ttf" => "font/ttf",
        "otf" => "font/otf",
        "wasm" => "application/wasm",
        _ => "application/octet-stream",
    }
}

/// Pone la guarda como primer script del documento.
fn inyectar_guarda(html: &str) -> String {
    let script = format!("<script>{GUARDA_JS}</script>");
    let bajo = html.to_ascii_lowercase();
    if let Some(i) = bajo.find("<head") {
        if let Some(fin) = bajo[i..].find('>') {
            let corte = i + fin + 1;
            return format!("{}{}{}", &html[..corte], script, &html[corte..]);
        }
    }
    format!("{script}{html}")
}

/// Los hashes (`'sha256-…'`) de los `<script>` en línea no vacíos. El texto se
/// normaliza como lo hace el parser HTML (CRLF y CR sueltos → LF), igual que
/// `tauri_utils::html` con los de la app.
fn hashes_en_linea(html: &str) -> Vec<String> {
    let bajo = html.to_ascii_lowercase();
    let mut hashes = Vec::new();
    let mut desde = 0;
    while let Some(p) = bajo[desde..].find("<script") {
        let inicio = desde + p;
        let tras = inicio + "<script".len();
        // `<scripts>` o `<script-x>` no son la etiqueta.
        match bajo.as_bytes().get(tras) {
            Some(b'>') | Some(b'/') => {}
            Some(c) if c.is_ascii_whitespace() => {}
            _ => {
                desde = tras;
                continue;
            }
        }
        let Some(fin_etiqueta) = bajo[inicio..].find('>').map(|f| inicio + f) else { break };
        let Some(cierre) = bajo[fin_etiqueta..].find("</script").map(|f| fin_etiqueta + f) else {
            break;
        };
        let etiqueta = &bajo[inicio..fin_etiqueta];
        let con_src = etiqueta
            .split(|c: char| c.is_ascii_whitespace())
            .any(|t| t.starts_with("src=") || t == "src");
        let contenido = &html[fin_etiqueta + 1..cierre];
        if !con_src && !contenido.is_empty() {
            let normalizado = contenido.replace("\r\n", "\n").replace('\r', "\n");
            let digesto = Sha256::digest(normalizado.as_bytes());
            hashes.push(format!(
                "'sha256-{}'",
                base64::engine::general_purpose::STANDARD.encode(digesto)
            ));
        }
        desde = cierre + "</script".len();
    }
    hashes
}

/// La CSP de una respuesta: las directivas de `csp.json`, los hashes de los
/// scripts en línea en `script-src` y `frame-ancestors` con los orígenes de la app.
fn politica(hashes: &[String], ancestros: &[String]) -> String {
    static BASE: OnceLock<BTreeMap<String, Vec<String>>> = OnceLock::new();
    let base = BASE.get_or_init(|| serde_json::from_str(CSP_JSON).expect("drawio/csp.json es válido"));
    let mut partes = Vec::with_capacity(base.len() + 1);
    for (directiva, fuentes) in base {
        let mut fuentes = fuentes.clone();
        if directiva == "script-src" {
            fuentes.extend(hashes.iter().cloned());
        }
        partes.push(format!("{directiva} {}", fuentes.join(" ")));
    }
    partes.push(format!("frame-ancestors {}", ancestros.join(" ")));
    partes.join("; ")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ancestros() -> Vec<String> {
        vec!["http://tauri.localhost".into(), "tauri://localhost".into()]
    }

    #[test]
    fn rutas_limpias() {
        assert_eq!(ruta_segura("").as_deref(), Some("index.html"));
        assert_eq!(ruta_segura("/").as_deref(), Some("index.html"));
        assert_eq!(ruta_segura("/index.html").as_deref(), Some("index.html"));
        assert_eq!(ruta_segura("/js/app.min.js").as_deref(), Some("js/app.min.js"));
        assert_eq!(
            ruta_segura("/img/lib/Mi%20forma.svg").as_deref(),
            Some("img/lib/Mi forma.svg")
        );
    }

    #[test]
    fn rutas_trampa() {
        for r in [
            "/../secreto",
            "/js/../../secreto",
            "/%2e%2e/secreto",
            "/js%2f..%2f..%2fsecreto",
            "/js/%2E%2E/x",
            "/./index.html",
            "//etc/passwd",
            "/js//app.js",
            "/js/",
            "/C:/Windows/win.ini",
            "/js\\..\\..\\x",
            "/js%5c..%5cx",
            "/.preparado.json",
            "/js/.oculto",
            "/a%00b",
            "/%ff",
        ] {
            assert_eq!(ruta_segura(r), None, "{r}");
        }
    }

    #[test]
    fn tipos_mime() {
        assert_eq!(tipo_mime("index.html"), "text/html; charset=utf-8");
        assert_eq!(tipo_mime("js/app.min.js"), "text/javascript; charset=utf-8");
        assert_eq!(tipo_mime("styles/grapheditor.css"), "text/css; charset=utf-8");
        assert_eq!(tipo_mime("stencils/x.XML"), "application/xml; charset=utf-8");
        assert_eq!(tipo_mime("img/a.svg"), "image/svg+xml");
        assert_eq!(tipo_mime("img/a.png"), "image/png");
        assert_eq!(tipo_mime("fonts/a.woff2"), "font/woff2");
        assert_eq!(tipo_mime("LICENSE"), "application/octet-stream");
    }

    #[test]
    fn la_guarda_va_primero_y_entra_por_hash() {
        let html = "<!DOCTYPE html><html><head lang=\"es\"><script src=\"js/a.js\"></script></head></html>";
        let con = inyectar_guarda(html);
        assert!(con.starts_with("<!DOCTYPE html><html><head lang=\"es\"><script>"));
        let hashes = hashes_en_linea(&con);
        assert_eq!(hashes.len(), 1, "solo la guarda: el de src no cuenta");
        let esperado = base64::engine::general_purpose::STANDARD
            .encode(Sha256::digest(GUARDA_JS.replace("\r\n", "\n").as_bytes()));
        assert_eq!(hashes[0], format!("'sha256-{esperado}'"));
    }

    #[test]
    fn hashes_de_scripts_en_linea() {
        let html = "<SCRIPT type=\"x\">a\r\nb</SCRIPT><script></script><scripts>no</scripts><script src=x></script>";
        let h = hashes_en_linea(html);
        let esperado = base64::engine::general_purpose::STANDARD.encode(Sha256::digest(b"a\nb"));
        assert_eq!(h, vec![format!("'sha256-{esperado}'")]);
    }

    #[test]
    fn la_politica_no_deja_hablar_con_el_ipc() {
        let p = politica(&["'sha256-x'".into()], &ancestros());
        assert!(p.contains("frame-ancestors http://tauri.localhost tauri://localhost"));
        assert!(p.contains("script-src 'self' 'wasm-unsafe-eval' 'sha256-x'"));
        assert!(p.contains("connect-src 'self' data: blob:"));
        assert!(!p.contains("ipc"));
        assert!(!p.contains("'unsafe-eval'"));
        assert!(p.contains("object-src 'none'"));
    }

    fn lector(rel: &str) -> Option<Vec<u8>> {
        match rel {
            "index.html" => Some(b"<html><head></head><body>x</body></html>".to_vec()),
            "js/a.js" => Some(b"1".to_vec()),
            _ => None,
        }
    }

    #[test]
    fn atender_sirve_lo_de_adentro_con_su_csp() {
        let r = atender(&Method::GET, "/", lector, &ancestros());
        assert_eq!(r.status(), StatusCode::OK);
        assert_eq!(r.headers()[header::CONTENT_TYPE], "text/html; charset=utf-8");
        let csp = r.headers()[header::CONTENT_SECURITY_POLICY].to_str().unwrap();
        assert!(csp.contains("'sha256-"), "la guarda entra por hash");
        assert!(String::from_utf8_lossy(r.body()).contains("window.stop()"));

        let r = atender(&Method::GET, "/js/a.js", lector, &ancestros());
        assert_eq!(r.status(), StatusCode::OK);
        assert_eq!(r.body(), b"1");
        assert_eq!(r.headers()[header::X_CONTENT_TYPE_OPTIONS], "nosniff");
    }

    #[test]
    fn atender_no_sale_de_la_carpeta() {
        for ruta in ["/../index.html", "/js/../../x", "/no-existe.js", "/%2e%2e/%2e%2e/Cargo.toml"] {
            let r = atender(&Method::GET, ruta, lector, &ancestros());
            assert_eq!(r.status(), StatusCode::NOT_FOUND, "{ruta}");
        }
        let r = atender(&Method::POST, "/index.html", lector, &ancestros());
        assert_eq!(r.status(), StatusCode::METHOD_NOT_ALLOWED);
        let r = atender(&Method::HEAD, "/js/a.js", lector, &ancestros());
        assert_eq!(r.status(), StatusCode::OK);
        assert!(r.body().is_empty());
    }

    #[test]
    fn leer_de_carpeta_no_escapa() {
        let base = std::env::temp_dir().join(format!("mycelium-drawio-{}", std::process::id()));
        let raiz = base.join("drawio");
        std::fs::create_dir_all(raiz.join("js")).unwrap();
        std::fs::write(raiz.join("js").join("a.js"), b"ok").unwrap();
        std::fs::write(base.join("secreto.txt"), b"no").unwrap();
        assert_eq!(leer_de_carpeta(&raiz, "js/a.js").as_deref(), Some(&b"ok"[..]));
        assert_eq!(leer_de_carpeta(&raiz, "../secreto.txt"), None);
        assert_eq!(leer_de_carpeta(&raiz, "js"), None, "una carpeta no se sirve");
        assert_eq!(leer_de_carpeta(&raiz, "no.js"), None);
        let _ = std::fs::remove_dir_all(&base);
    }
}
