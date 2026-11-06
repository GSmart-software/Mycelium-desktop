//! La **captura global** (`FUN-L-33`, Parte C): Ctrl+Shift+Espacio desde
//! cualquier programa, con Mycelium minimizado o en segundo plano.
//!
//! Hasta la Parte B el atajo lo escuchaba la página (`CapturaRapida.tsx`), así
//! que solo andaba con la ventana de Mycelium enfocada. Ahora se registra como
//! **atajo global del sistema** (`tauri-plugin-global-shortcut`, que en Windows
//! es `RegisterHotKey`) y Rust decide qué hacer con cada pulsación:
//!
//! - **Una ventana de Mycelium con vault tiene el foco**: se le pide que abra o
//!   cierre su cajita de siempre (evento `captura-rapida-alternar`). Es lo que
//!   pasaba antes, y no hay doble disparo: un atajo registrado con
//!   `RegisterHotKey` **se consume** —Windows no le entrega la tecla a la
//!   ventana enfocada—, así que el `keydown` de la página no llega. Igual la
//!   página descarta un segundo alternado en menos de 250 ms, por las dudas.
//! - **La cajita flotante tiene el foco**: se oculta (el atajo la alterna).
//! - **Cualquier otro caso** —otro programa enfocado, Mycelium minimizado, una
//!   ventana en el selector de vaults—: se muestra la **ventana flotante**
//!   (`captura`), chica, sin marco, siempre encima y fuera de la barra de
//!   tareas, centrada en el monitor del puntero. **No** restaura ni trae al
//!   frente ninguna ventana de Mycelium.
//!
//! La ventana flotante se crea **una vez** —unos segundos después de arrancar,
//! para que la primera pulsación ya la encuentre cargada— y después solo se
//! muestra y se oculta. Se oculta al anotar (Enter), con Esc y al perder el
//! foco. Al ocultarse con Enter o Esc el foco vuelve al programa que lo tenía
//! antes (`SetForegroundWindow` sobre la ventana que estaba al frente al
//! pulsar el atajo; si ya no existe, Windows elige solo).
//!
//! ## El destino: el vault de la última ventana usada
//!
//! Rust lleva el **historial de foco** de las ventanas de Mycelium (`main` y
//! `vault-*`). El destino «Vault» es el de la más reciente que tenga un vault
//! registrado (`VentanasState`); si ninguna lo tiene, la cajita solo ofrece la
//! Bandeja personal.
//!
//! > [!important] Por qué la ventana flotante no escribe en el vault
//! > Desde la 2.6.0 los comandos nativos trabajan solo sobre el vault **de la
//! > ventana que los llama**, y la flotante no tiene vault. En vez de darle un
//! > comando que escriba en una carpeta —que habría que validar contra el
//! > registro y que repetiría el formato, la ruta configurada de la Bandeja, el
//! > índice, el árbol, el contador y la recarga de la pestaña—, **le pide a la
//! > ventana del vault que anote ella** (evento `captura-anotar`), con su
//! > propio `anotarEnBandeja` de siempre, y espera su respuesta
//! > (`captura_anotada`). La flotante solo manda el **texto**: no elige
//! > ventana, ni vault, ni ruta. La ventana destino la elige Rust con su
//! > historial, y solo esa ventana puede contestar el pedido (como
//! > `mcp_responder`, `control.rs`). Lo que escribe, lo escribe por los mismos
//! > comandos acotados a su vault que usa al anotar desde su propia cajita.
//!
//! La Bandeja personal la escribe la propia flotante con
//! `bandeja_personal_leer`/`bandeja_personal_guardar`, que no reciben rutas
//! (`bandeja_personal.rs`) y avisan a todas las ventanas.
//!
//! **Si el registro falla** (otro programa ya tiene Ctrl+Shift+Espacio), la
//! primera ventana de vault que arranca lo avisa (`captura_global_aviso`) y la
//! cajita sigue andando como antes, con Mycelium enfocado.

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::Duration;

use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder, WindowEvent};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};
use tokio::sync::oneshot;

/// Etiqueta de la ventana flotante. No empieza por `vault-` a propósito: no es
/// una ventana de vault y tiene su propia capability (`capabilities/captura.json`).
pub const ETIQUETA: &str = "captura";

/// Ancho y alto inicial de la ventana flotante (lógicos). El alto lo ajusta la
/// página a lo que ocupa la cajita (con un error a la vista crece).
const ANCHO: f64 = 600.0;
const ALTO: f64 = 104.0;

/// Cuánto espera la flotante a que la ventana del vault conteste.
const ESPERA_VENTANA: Duration = Duration::from_secs(15);

/// Tope del texto de una captura: es una línea, no un documento.
const TOPE_TEXTO: usize = 8 * 1024;

/// Cuánto después de arrancar se crea la ventana flotante (oculta), para no
/// competir con la carga de la ventana principal.
const PRECARGA: Duration = Duration::from_secs(3);

/// Evento a una ventana de vault enfocada: abrir o cerrar su cajita.
const EVENTO_ALTERNAR: &str = "captura-rapida-alternar";
/// Evento a la ventana del vault destino: anotar este texto en su Bandeja.
const EVENTO_ANOTAR: &str = "captura-anotar";
/// Evento a la flotante al mostrarse: con qué destinos arranca.
const EVENTO_MOSTRAR: &str = "captura-mostrar";

/// Ctrl+Shift+Espacio (en macOS, `CONTROL` es Ctrl; la página escucha además Cmd).
fn atajo() -> Shortcut {
    Shortcut::new(Some(Modifiers::CONTROL | Modifiers::SHIFT), Code::Space)
}

/// ¿Es una ventana de Mycelium (no la flotante)?
pub fn es_ventana_de_app(label: &str) -> bool {
    label == "main" || label.starts_with("vault-")
}

/// Un pedido de anotar esperando la respuesta de la ventana del vault.
struct Pendiente {
    /// Solo ella puede contestar.
    ventana: String,
    respuesta: oneshot::Sender<Option<String>>,
}

#[derive(Default)]
pub struct CapturaState {
    /// Etiquetas de las ventanas de Mycelium, de la enfocada más recientemente
    /// a la más vieja.
    historial: Mutex<Vec<String>>,
    /// El fallo del registro del atajo, hasta que una ventana lo muestre.
    aviso: Mutex<Option<String>>,
    /// La ventana que estaba al frente al pulsar el atajo (HWND, en Windows).
    previa: Mutex<Option<isize>>,
    pendientes: Mutex<HashMap<String, Pendiente>>,
    contador: AtomicU64,
}

fn bloquear<T>(m: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

/// Pone `label` al frente del historial.
fn anotar_foco(historial: &mut Vec<String>, label: &str) {
    historial.retain(|l| l != label);
    historial.insert(0, label.to_string());
}

/// El destino «Vault»: la ventana más reciente del historial con un vault
/// abierto; si ninguna del historial lo tiene, cualquiera que lo tenga (la
/// de etiqueta menor, para que sea estable). Devuelve `(etiqueta, ruta)`.
fn elegir_destino(historial: &[String], abiertas: &HashMap<String, String>) -> Option<(String, String)> {
    historial
        .iter()
        .find_map(|l| abiertas.get(l).map(|r| (l.clone(), r.clone())))
        .or_else(|| {
            let mut todas: Vec<_> = abiertas.iter().filter(|(l, _)| es_ventana_de_app(l)).collect();
            todas.sort();
            todas.first().map(|(l, r)| ((*l).clone(), (*r).clone()))
        })
}

/// El destino de ahora, solo entre las ventanas que siguen existiendo.
fn destino_actual(app: &AppHandle) -> Option<(String, String)> {
    let historial = bloquear(&app.state::<CapturaState>().historial).clone();
    let abiertas: HashMap<String, String> = app
        .state::<crate::ventanas::VentanasState>()
        .0
        .lock()
        .ok()?
        .iter()
        .filter(|(l, _)| app.get_webview_window(l).is_some())
        .map(|(l, r)| (l.clone(), r.clone()))
        .collect();
    elegir_destino(&historial, &abiertas)
}

/// Registra el plugin y el atajo. Llamar desde `setup`. Si el atajo no se
/// puede tomar, queda el aviso para la primera ventana que lo pida; la app
/// arranca igual.
pub fn registrar(app: &AppHandle) {
    let plugin = tauri_plugin_global_shortcut::Builder::new()
        .with_handler(|app, atajo_pulsado, evento| {
            if evento.state() == ShortcutState::Pressed && *atajo_pulsado == atajo() {
                al_atajo(app);
            }
        })
        .build();
    let resultado = app
        .plugin(plugin)
        .map_err(|e| e.to_string())
        .and_then(|_| app.global_shortcut().register(atajo()).map_err(|e| e.to_string()));
    match resultado {
        Ok(()) => {
            // La flotante, precargada y oculta.
            let app = app.clone();
            tauri::async_runtime::spawn(async move {
                tokio::time::sleep(PRECARGA).await;
                let _ = asegurar_ventana(&app);
            });
        }
        Err(e) => {
            log::warn!("no se pudo registrar el atajo global de la captura rápida: {e}");
            *bloquear(&app.state::<CapturaState>().aviso) = Some(
                "Ctrl+Shift+Espacio ya lo usa otro programa, así que la captura rápida solo funciona \
                 con Mycelium enfocado. Para usarla desde cualquier programa, quítale ese atajo al otro \
                 programa y vuelve a abrir Mycelium."
                    .to_string(),
            );
        }
    }
}

/// Lo que hace cada pulsación del atajo (ver el encabezado del módulo).
fn al_atajo(app: &AppHandle) {
    if let Some(flotante) = app.get_webview_window(ETIQUETA) {
        if flotante.is_visible().unwrap_or(false) && flotante.is_focused().unwrap_or(false) {
            ocultar(app, true);
            return;
        }
    }
    let enfocada = app
        .webview_windows()
        .into_iter()
        .find(|(l, w)| es_ventana_de_app(l) && w.is_focused().unwrap_or(false))
        .map(|(l, _)| l);
    if let Some(label) = enfocada {
        let con_vault = app
            .state::<crate::ventanas::VentanasState>()
            .0
            .lock()
            .map(|m| m.contains_key(&label))
            .unwrap_or(false);
        if con_vault {
            let _ = app.emit_to(label.as_str(), EVENTO_ALTERNAR, ());
            return;
        }
    }
    *bloquear(&app.state::<CapturaState>().previa) = ventana_al_frente();
    mostrar(app);
}

/// La ventana flotante, creada si falta. Se crea oculta.
fn asegurar_ventana(app: &AppHandle) -> Result<tauri::WebviewWindow, String> {
    if let Some(w) = app.get_webview_window(ETIQUETA) {
        return Ok(w);
    }
    // Misma distinción que `ventanas::abrir_vault_en_ventana`: en desarrollo
    // Next sirve la ruta; empaquetado, el `.html` suelto del export.
    let pagina = if tauri::is_dev() { "/captura" } else { "captura.html" };
    WebviewWindowBuilder::new(app, ETIQUETA, WebviewUrl::App(pagina.into()))
        .title("Captura rápida")
        .decorations(false)
        .shadow(true)
        .resizable(false)
        .maximizable(false)
        .minimizable(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .visible(false)
        .focused(false)
        .disable_drag_drop_handler()
        .inner_size(ANCHO, ALTO)
        .build()
        .map_err(|e| format!("No se pudo crear la ventana de la captura rápida: {e}"))
}

/// Muestra la flotante centrada en el monitor del puntero, con el foco, y le
/// manda los destinos. Se despacha al runtime asíncrono: crear una ventana en
/// el hilo principal se cuelga en Windows (ver `ventanas::abrir_vault_en_ventana`).
fn mostrar(app: &AppHandle) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let Ok(ventana) = asegurar_ventana(&app) else { return };
        centrar(&app, &ventana);
        let vault = destino_actual(&app).map(|(_, ruta)| ruta);
        let _ = ventana.show();
        let _ = ventana.set_focus();
        let _ = app.emit_to(ETIQUETA, EVENTO_MOSTRAR, serde_json::json!({ "vault": vault }));
    });
}

/// Centra la flotante en el monitor donde está el puntero (o en el principal).
fn centrar(app: &AppHandle, ventana: &tauri::WebviewWindow) {
    let monitor = app
        .cursor_position()
        .ok()
        .and_then(|p| app.monitor_from_point(p.x, p.y).ok().flatten())
        .or_else(|| app.primary_monitor().ok().flatten());
    let Some(monitor) = monitor else { return };
    let escala = monitor.scale_factor();
    let alto = ventana
        .inner_size()
        .map(|s| s.height as f64)
        .unwrap_or(ALTO * escala);
    let (x, y) = posicion_centrada(
        (monitor.position().x, monitor.position().y),
        (monitor.size().width, monitor.size().height),
        (ANCHO * escala, alto),
    );
    let _ = ventana.set_size(tauri::LogicalSize::new(ANCHO, alto / escala));
    let _ = ventana.set_position(tauri::PhysicalPosition::new(x, y));
}

/// Lógica pura de [`centrar`]: la esquina de una ventana de `tam` centrada en
/// el monitor (en píxeles físicos). Un poco arriba del centro, como la cajita
/// de adentro de la app: al crecer con un error, crece hacia abajo.
fn posicion_centrada(origen: (i32, i32), monitor: (u32, u32), tam: (f64, f64)) -> (i32, i32) {
    let x = origen.0 as f64 + (monitor.0 as f64 - tam.0) / 2.0;
    let y = origen.1 as f64 + (monitor.1 as f64 - tam.1) * 0.4;
    (x.round() as i32, y.round() as i32)
}

/// Oculta la flotante. Con `devolver_foco` (Enter, Esc, el atajo), el foco
/// vuelve a la ventana que estaba al frente al pulsar el atajo; al perder el
/// foco por un clic afuera, no hace falta: ya lo tiene otro.
fn ocultar(app: &AppHandle, devolver_foco: bool) {
    let previa = bloquear(&app.state::<CapturaState>().previa).take();
    if devolver_foco {
        if let Some(hwnd) = previa {
            devolver_foco_a(hwnd);
        }
    }
    if let Some(w) = app.get_webview_window(ETIQUETA) {
        let _ = w.hide();
    }
}

#[cfg(windows)]
fn ventana_al_frente() -> Option<isize> {
    use windows::Win32::UI::WindowsAndMessaging::GetForegroundWindow;
    let h = unsafe { GetForegroundWindow() };
    (!h.0.is_null()).then_some(h.0 as isize)
}

#[cfg(not(windows))]
fn ventana_al_frente() -> Option<isize> {
    None
}

/// Le devuelve el frente a `hwnd`, si sigue existiendo. Se puede: el proceso
/// que tiene el frente (el nuestro, con la flotante) puede cedérselo a otro.
#[cfg(windows)]
fn devolver_foco_a(hwnd: isize) {
    use windows::Win32::Foundation::HWND;
    use windows::Win32::UI::WindowsAndMessaging::{IsWindow, SetForegroundWindow};
    let h = HWND(hwnd as *mut core::ffi::c_void);
    unsafe {
        if IsWindow(Some(h)).as_bool() {
            let _ = SetForegroundWindow(h);
        }
    }
}

#[cfg(not(windows))]
fn devolver_foco_a(_hwnd: isize) {}

/// Llamar desde `on_window_event` con cada evento de cada ventana.
pub fn al_evento(ventana: &tauri::Window, evento: &WindowEvent) {
    let label = ventana.label();
    let app = ventana.app_handle();
    match evento {
        WindowEvent::Focused(true) if es_ventana_de_app(label) => {
            anotar_foco(&mut bloquear(&app.state::<CapturaState>().historial), label);
        }
        // Perder el foco la oculta (un clic en otro programa, Alt+Tab).
        WindowEvent::Focused(false) if label == ETIQUETA => ocultar(app, false),
        // Alt+F4 sobre la flotante: se oculta y queda lista para la próxima.
        WindowEvent::CloseRequested { api, .. } if label == ETIQUETA => {
            api.prevent_close();
            ocultar(app, true);
        }
        _ => {}
    }
}

/// Al destruirse una ventana de Mycelium: sale del historial, sus pedidos
/// pendientes fallan, y si era la **última**, se cierra también la flotante —
/// si no, el proceso quedaría vivo y oculto, sin ninguna ventana a la vista.
pub fn al_cerrar(app: &AppHandle, label: &str) {
    if !es_ventana_de_app(label) {
        return;
    }
    let estado = app.state::<CapturaState>();
    bloquear(&estado.historial).retain(|l| l != label);
    bloquear(&estado.pendientes).retain(|_, p| p.ventana != label);
    let quedan = app.webview_windows().keys().any(|l| l != label && es_ventana_de_app(l));
    if !quedan {
        if let Some(w) = app.get_webview_window(ETIQUETA) {
            let _ = w.destroy();
        }
    }
}

/// Los comandos de la flotante solo los puede llamar ella.
fn solo_flotante(ventana: &tauri::Window) -> Result<(), String> {
    if ventana.label() == ETIQUETA {
        Ok(())
    } else {
        Err("Solo la ventana de la captura rápida puede hacer esto.".to_string())
    }
}

/// Con qué destinos arranca la flotante (también se los manda `captura-mostrar`):
/// la ruta del vault de la última ventana usada, o `None` si no hay ninguna
/// con vault (solo se ofrece la Bandeja personal).
#[derive(serde::Serialize)]
pub struct Destinos {
    vault: Option<String>,
}

#[tauri::command]
pub fn captura_flotante_destinos(ventana: tauri::Window) -> Result<Destinos, String> {
    solo_flotante(&ventana)?;
    Ok(Destinos { vault: destino_actual(ventana.app_handle()).map(|(_, r)| r) })
}

/// Oculta la flotante (Enter tras anotar, Esc). `devolver_foco`: devolverle el
/// frente al programa que lo tenía.
#[tauri::command]
pub fn captura_flotante_ocultar(ventana: tauri::Window, devolver_foco: bool) -> Result<(), String> {
    solo_flotante(&ventana)?;
    ocultar(ventana.app_handle(), devolver_foco);
    Ok(())
}

/// Anota `texto` (lo escrito en la cajita, tal cual) en la Bandeja del vault de
/// la última ventana usada: se lo pide a esa ventana y espera su respuesta.
/// Devuelve la ruta del vault donde se anotó.
#[tauri::command]
pub async fn captura_flotante_anotar_vault(
    ventana: tauri::Window,
    estado: tauri::State<'_, CapturaState>,
    texto: String,
) -> Result<String, String> {
    solo_flotante(&ventana)?;
    if texto.len() > TOPE_TEXTO {
        return Err("Es demasiado largo para una captura.".to_string());
    }
    let app = ventana.app_handle().clone();
    let (label, ruta) = destino_actual(&app).ok_or_else(|| "No hay ningún vault abierto.".to_string())?;
    let id = format!("captura-{}", estado.contador.fetch_add(1, Ordering::Relaxed));
    let (tx, rx) = oneshot::channel();
    bloquear(&estado.pendientes).insert(id.clone(), Pendiente { ventana: label.clone(), respuesta: tx });
    let emitido = app.emit_to(label.as_str(), EVENTO_ANOTAR, serde_json::json!({ "id": id, "texto": texto }));
    let respuesta = if emitido.is_err() {
        None
    } else {
        tokio::time::timeout(ESPERA_VENTANA, rx).await.ok().and_then(Result::ok)
    };
    bloquear(&estado.pendientes).remove(&id);
    match respuesta {
        Some(None) => Ok(ruta),
        Some(Some(error)) => Err(error),
        None => Err("La ventana del vault no respondió.".to_string()),
    }
}

/// La respuesta de la ventana del vault a `captura-anotar`: `error` vacío si
/// anotó. Solo cuenta si la manda la ventana a la que se le pidió; un id
/// desconocido (el pedido venció) se ignora.
#[tauri::command]
pub fn captura_anotada(ventana: tauri::Window, estado: tauri::State<'_, CapturaState>, id: String, error: Option<String>) {
    let mut pendientes = bloquear(&estado.pendientes);
    if pendientes.get(&id).is_some_and(|p| p.ventana == ventana.label()) {
        if let Some(p) = pendientes.remove(&id) {
            let _ = p.respuesta.send(error);
        }
    }
}

/// El aviso de que el atajo global no se pudo registrar, **una sola vez**: lo
/// muestra la primera ventana de vault que lo pide al arrancar.
#[tauri::command]
pub fn captura_global_aviso(ventana: tauri::Window, estado: tauri::State<'_, CapturaState>) -> Option<String> {
    if !es_ventana_de_app(ventana.label()) {
        return None;
    }
    bloquear(&estado.aviso).take()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn mapa(pares: &[(&str, &str)]) -> HashMap<String, String> {
        pares.iter().map(|(l, r)| (l.to_string(), r.to_string())).collect()
    }

    fn hist(ls: &[&str]) -> Vec<String> {
        ls.iter().map(|l| l.to_string()).collect()
    }

    #[test]
    fn el_historial_pone_al_frente_sin_repetir() {
        let mut h = hist(&["main", "vault-2"]);
        anotar_foco(&mut h, "vault-2");
        assert_eq!(h, hist(&["vault-2", "main"]));
        anotar_foco(&mut h, "vault-3");
        assert_eq!(h, hist(&["vault-3", "vault-2", "main"]));
    }

    #[test]
    fn el_destino_es_la_ultima_ventana_usada_con_vault() {
        let abiertas = mapa(&[("main", "C:/A"), ("vault-2", "C:/B")]);
        // La última usada tiene vault.
        assert_eq!(elegir_destino(&hist(&["vault-2", "main"]), &abiertas), Some(("vault-2".into(), "C:/B".into())));
        // La última usada está en el selector (sin vault): la siguiente.
        assert_eq!(
            elegir_destino(&hist(&["vault-9", "main", "vault-2"]), &abiertas),
            Some(("main".into(), "C:/A".into()))
        );
        // Sin historial (ninguna tuvo el foco todavía): alguna con vault, estable.
        assert_eq!(elegir_destino(&[], &abiertas), Some(("main".into(), "C:/A".into())));
        // Ninguna con vault: solo la personal.
        assert_eq!(elegir_destino(&hist(&["main"]), &HashMap::new()), None);
        // La flotante nunca es destino, aunque figurara en el registro.
        assert_eq!(elegir_destino(&[], &mapa(&[(ETIQUETA, "C:/X")])), None);
    }

    #[test]
    fn solo_main_y_vault_son_ventanas_de_la_app() {
        assert!(es_ventana_de_app("main"));
        assert!(es_ventana_de_app("vault-123"));
        assert!(!es_ventana_de_app(ETIQUETA));
        assert!(!es_ventana_de_app("otra"));
    }

    #[test]
    fn la_flotante_se_centra_en_el_monitor() {
        // Monitor de 1920×1080 en el origen, ventana de 600×100.
        assert_eq!(posicion_centrada((0, 0), (1920, 1080), (600.0, 100.0)), (660, 392));
        // Segundo monitor a la derecha, con escala 1,5 (ventana de 900×150 físicos).
        assert_eq!(posicion_centrada((1920, 0), (2560, 1440), (900.0, 150.0)), (1920 + 830, 516));
        // Monitor a la izquierda (coordenadas negativas).
        assert_eq!(posicion_centrada((-1920, 0), (1920, 1080), (600.0, 100.0)), (-1260, 392));
    }
}
