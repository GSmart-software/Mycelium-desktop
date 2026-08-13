//! Varios vaults abiertos a la vez, uno por ventana (`FUN-L-16`, solo-desktop).
//!
//! Tauri sabe abrir varias ventanas y cada una es un webview con su propio
//! contexto de JavaScript, así que los stores del frontend no se pisan solos. Lo
//! que había que resolver es todo lo que en Rust era **global a la app** y en
//! realidad pertenece a una ventana: el watcher del vault (`vault_watch`) y las
//! sesiones de terminal (`terminal`). Este módulo añade la pieza que faltaba:
//! saber **qué vault tiene abierto cada ventana**.
//!
//! > [!danger] Un vault no se abre en dos ventanas a la vez
//! > Cada ventana abre el índice SQLite de su vault y lanza su propio watcher
//! > sobre la misma carpeta. Dos ventanas sobre el mismo vault serían dos
//! > indexadores escribiendo el mismo índice y dos watchers reaccionando a los
//! > escritos del otro. En vez de intentar coordinarlos —que es un problema de
//! > concurrencia real, no un detalle de UI— se impide: si el vault ya está
//! > abierto, se levanta esa ventana.

use std::collections::HashMap;
use std::sync::Mutex;

use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

/// Qué vault tiene abierto cada ventana: etiqueta → ruta de la carpeta.
#[derive(Default)]
pub struct VentanasState(pub Mutex<HashMap<String, String>>);

/// Comparación de rutas tolerante a mayúsculas y a las barras de Windows: la
/// misma carpeta escrita de dos formas sigue siendo la misma carpeta.
fn misma_ruta(a: &str, b: &str) -> bool {
    let norm = |s: &str| s.replace('\\', "/").trim_end_matches('/').to_lowercase();
    norm(a) == norm(b)
}

/// Etiqueta de la ventana que tiene abierto ese vault, si alguna.
fn ventana_con(state: &VentanasState, ruta: &str) -> Option<String> {
    let mapa = state.0.lock().ok()?;
    mapa.iter()
        .find(|(_, abierta)| misma_ruta(abierta, ruta))
        .map(|(label, _)| label.clone())
}

/// Anota que esta ventana abrió ese vault. Falla si lo tiene **otra**, para que
/// el frontend pueda decirlo en vez de terminar con dos índices sobre la misma
/// carpeta.
#[tauri::command]
pub fn registrar_vault(
    ventana: tauri::Window,
    state: tauri::State<VentanasState>,
    ruta: String,
) -> Result<(), String> {
    let propia = ventana.label().to_string();
    if let Some(otra) = ventana_con(&state, &ruta) {
        if otra != propia {
            return Err("Ese vault ya está abierto en otra ventana.".to_string());
        }
    }
    state
        .0
        .lock()
        .map_err(|_| "Registro de ventanas no disponible".to_string())?
        .insert(propia, ruta);
    Ok(())
}

/// Suelta el vault de esta ventana (al salir del vault).
#[tauri::command]
pub fn soltar_vault(ventana: tauri::Window, state: tauri::State<VentanasState>) {
    soltar_de(&state, ventana.label());
}

/// Suelta el vault de una ventana por su etiqueta. Lo usa además el cierre de
/// ventana, donde ya no hay un `Window` del que partir.
pub fn soltar_de(state: &VentanasState, label: &str) {
    if let Ok(mut mapa) = state.0.lock() {
        mapa.remove(label);
    }
}

/// Abre `ruta` en una ventana nueva, o levanta la que ya lo tenga.
///
/// El vault viaja en la URL (`?vault=…`) y no en un estado compartido: la
/// ventana nueva arranca con su `sessionStorage` vacío y tiene que saber por sí
/// misma qué abrir. Devuelve `true` si se creó una ventana, `false` si se
/// enfocó una existente — al frontend le sirve para decidir qué contar.
#[tauri::command]
pub fn abrir_vault_en_ventana(
    app: AppHandle,
    state: tauri::State<VentanasState>,
    ruta: String,
) -> Result<bool, String> {
    if let Some(label) = ventana_con(&state, &ruta) {
        if let Some(win) = app.get_webview_window(&label) {
            let _ = win.unminimize();
            let _ = win.set_focus();
            return Ok(false);
        }
        // La ventana ya no existe (se cerró sin avisar): se limpia y se sigue.
        soltar_de(&state, &label);
    }

    // La etiqueta empieza por `vault-` a propósito: la capability de
    // `capabilities/default.json` la lista como `vault-*`, y sin eso la ventana
    // nueva nacería sin permisos —ni SQL, ni diálogos— y no podría abrir nada.
    let label = format!("vault-{}", sufijo_unico());
    // `workspace.html` y no `/workspace`: la exportación estática de Next genera
    // el archivo suelto, no un `workspace/index.html`, así que la ruta con barra
    // no resuelve y la ventana abriría en blanco.
    let destino = format!("workspace.html?vault={}", urlencode(&ruta));
    WebviewWindowBuilder::new(&app, &label, WebviewUrl::App(destino.into()))
        .title("Mycelium")
        .inner_size(1280.0, 800.0)
        .min_inner_size(640.0, 480.0)
        .build()
        .map_err(|e| format!("No se pudo abrir la ventana: {e}"))?;
    Ok(true)
}

fn sufijo_unico() -> String {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis().to_string())
        .unwrap_or_else(|_| "0".to_string())
}

/// Codifica la ruta para que quepa en un query string. Se hace a mano —el juego
/// de caracteres es acotado y conocido— para no sumar una dependencia solo por
/// esto.
fn urlencode(s: &str) -> String {
    let mut out = String::with_capacity(s.len() * 3);
    for b in s.as_bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(*b as char)
            }
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}

/// Limpieza al cerrarse una ventana: su watcher, sus terminales y su vault.
///
/// Sin esto, cerrar una ventana dejaría el vault marcado como abierto para
/// siempre —no se podría volver a abrir en ninguna— y sus shells corriendo sin
/// nadie que las lea.
pub fn al_cerrar(app: &AppHandle, label: &str) {
    crate::vault_watch::detener_de(&app.state::<crate::vault_watch::WatcherState>(), label);
    crate::terminal::cerrar_de_ventana(&app.state::<crate::terminal::TerminalesState>(), label);
    soltar_de(&app.state::<VentanasState>(), label);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn misma_ruta_tolera_barras_y_mayusculas() {
        assert!(misma_ruta("C:\\Notas\\Vault", "c:/notas/vault"));
        assert!(misma_ruta("/home/x/vault/", "/home/x/vault"));
        assert!(!misma_ruta("C:/notas/a", "C:/notas/b"));
    }

    #[test]
    fn urlencode_escapa_lo_que_rompe_una_url() {
        assert_eq!(urlencode("C:/Mis Notas"), "C%3A%2FMis%20Notas");
        assert_eq!(urlencode("simple-1.0_x~"), "simple-1.0_x~");
    }
}
