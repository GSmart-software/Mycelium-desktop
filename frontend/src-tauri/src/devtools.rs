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
//! ## Cuándo se decide
//!
//! Cada webview lleva su propio [`Estado`]: `permitidas` dice si en este momento
//! se pueden abrir. Lo fija [`permitidas_en`] según el momento:
//!
//! | Momento | Valor |
//! |---|---|
//! | Se crea el webview (sin vault todavía) | apagadas |
//! | `ventanas::registrar_vault` | lo que esta máquina decidió para ese vault |
//! | Se mueve el interruptor (`config_local_fijar`) | el valor nuevo, en el acto |
//! | `ventanas::soltar_vault` | apagadas |
//!
//! En desarrollo (`tauri::is_dev()`), siempre encendidas.
//!
//! ## Cómo se apagan en Windows (WebView2)
//!
//! **No con `AreDevToolsEnabled`.** Ese ajuste —como casi todos los de
//! `ICoreWebView2Settings`— no se aplica en el acto: un cambio hecho después de
//! `NavigationStarting` espera a la **próxima navegación de primer nivel**. La
//! app es de una sola página y no vuelve a navegar, así que el `false` que la
//! versión anterior fijaba al crear el webview (ya navegando) no llegaba nunca a
//! aplicarse: Ctrl+Shift+I y F12 nativos seguían abriendo la consola con el
//! interruptor apagado. Y al revés: encenderlo tampoco habría tenido efecto hasta
//! recargar. El ajuste queda en `true` (lo que pone wry) y la puerta la hacen dos
//! manejadores de WebView2 que miran `permitidas` en cada evento:
//!
//! - **`AcceleratorKeyPressed`** (del controlador): con las DevTools apagadas,
//!   F12, Ctrl+Shift+I, Ctrl+Shift+J y Ctrl+Shift+C se marcan con
//!   `IsBrowserAcceleratorKeyEnabled(false)`: el navegador **no** los atiende,
//!   pero la tecla **sí** sigue a la página. Eso importa: Ctrl+Shift+C es el
//!   código en línea del editor, y F12 llega a `DevToolsHotkey`, que avisa dónde
//!   se encienden. No se usa `AreBrowserAcceleratorKeysEnabled(false)` porque
//!   apaga además la búsqueda, la impresión, la recarga y el zoom del navegador.
//! - **`ContextMenuRequested`**: con las DevTools apagadas, se quita
//!   «Inspeccionar» (`inspectElement`) del menú contextual nativo.
//!
//! Si registrar alguno falla, se avisa en el log y el webview queda **sin
//! puerta**: se cae al ajuste `AreDevToolsEnabled` (lado seguro: `false` hasta
//! que el vault lo encienda), sabiendo que solo rige desde la próxima navegación.
//!
//! **La consola no se puede cerrar desde la app.** WebView2 tiene
//! `OpenDevToolsWindow` pero ningún método para cerrarla, y wry responde siempre
//! `false` a `is_devtools_open` en Windows. Por eso F12 solo abre, y apagar el
//! interruptor con la consola abierta no la cierra: se cierra con su X (lo dicen
//! la configuración y la ayuda).
//!
//! ## macOS y Linux
//!
//! wry no expone cómo cambiarlo en tiempo de ejecución y hacerlo a mano
//! (WKWebView `isInspectable`, WebKitGTK `enable-developer-extras`) es código de
//! plataforma que no se puede probar desde Windows. Ahí el interruptor controla
//! el atajo y la apertura programática ([`alternar_devtools`]); el «Inspeccionar
//! elemento» nativo del menú contextual queda. Ahí sí se sabe si la consola está
//! abierta, y F12 la cierra.

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use tauri::plugin::TauriPlugin;
use tauri::{Manager, Runtime};

/// Lo que cada webview necesita saber en el momento de un evento.
#[derive(Debug, Default)]
pub struct Estado {
    /// ¿Se pueden abrir ahora? Lo leen los manejadores de WebView2 en su hilo.
    permitidas: AtomicBool,
    /// ¿Quedaron registrados los manejadores que hacen de puerta? Sin ellos se
    /// cae al ajuste `AreDevToolsEnabled`.
    con_puerta: AtomicBool,
}

/// El [`Estado`] de cada webview, por etiqueta.
#[derive(Default)]
struct EstadosDevtools(Mutex<HashMap<String, Arc<Estado>>>);

/// Los momentos en que se decide si las DevTools de una ventana se pueden abrir.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Momento {
    /// El webview acaba de crearse: no tiene vault todavía.
    Creada,
    /// Se registró el vault de la ventana; lleva lo que esta máquina decidió para él.
    VaultRegistrado(bool),
    /// Se movió el interruptor en Configuración → Avanzado.
    Interruptor(bool),
    /// La ventana soltó su vault.
    VaultSoltado,
}

/// Qué valor rige en cada momento. En desarrollo, siempre encendidas.
pub fn permitidas_en(momento: Momento, es_dev: bool) -> bool {
    es_dev
        || match momento {
            Momento::Creada | Momento::VaultSoltado => false,
            Momento::VaultRegistrado(v) | Momento::Interruptor(v) => v,
        }
}

/// Teclas virtuales de Win32 que importan acá.
const VK_F12: u32 = 0x7B;

/// ¿Es un atajo con el que Chromium abre las DevTools? F12 con cualquier
/// modificador; Ctrl+Shift+I (herramientas), J (consola) y C (inspeccionar).
pub fn es_atajo_devtools(tecla: u32, ctrl: bool, shift: bool) -> bool {
    tecla == VK_F12 || (ctrl && shift && matches!(tecla, 0x49 | 0x4A | 0x43))
}

/// Índices de los ítems que hay que quitar del menú contextual, **de mayor a
/// menor** (para borrarlos sin correr los que siguen).
pub fn items_a_quitar<S: AsRef<str>>(nombres: &[S]) -> Vec<usize> {
    let mut indices: Vec<usize> = nombres
        .iter()
        .enumerate()
        .filter(|(_, n)| n.as_ref() == "inspectElement")
        .map(|(i, _)| i)
        .collect();
    indices.reverse();
    indices
}

fn estado_de<R: Runtime>(app: &tauri::AppHandle<R>, label: &str) -> Arc<Estado> {
    let estados = app.state::<EstadosDevtools>();
    let mut mapa = estados.0.lock().unwrap_or_else(|e| e.into_inner());
    mapa.entry(label.to_string()).or_default().clone()
}

/// Fija `AreDevToolsEnabled` del webview. Solo se usa cuando el webview no
/// tiene puerta: rige desde la próxima navegación (ver el módulo).
#[cfg(windows)]
fn fijar_ajuste<R: Runtime>(webview: &tauri::Webview<R>, habilitar: bool) {
    let label = webview.label().to_string();
    let r = webview.with_webview(move |pw| {
        // SAFETY: llamadas COM sobre el controlador vivo del webview, en el
        // hilo en que `with_webview` ejecuta el cierre (el de la UI).
        let r = unsafe { pw.controller().CoreWebView2().and_then(|c| c.Settings()) }
            .and_then(|ajustes| unsafe { ajustes.SetAreDevToolsEnabled(habilitar) });
        if let Err(e) = r {
            log::warn!("devtools: no se pudo fijar AreDevToolsEnabled={habilitar} en «{label}»: {e}");
        }
    });
    if let Err(e) = r {
        log::warn!("devtools: no se llegó al webview «{}»: {e}", webview.label());
    }
}

/// Registra los dos manejadores que hacen de puerta (ver el módulo). Si alguno
/// falla, el webview queda sin puerta y con el ajuste apagado.
#[cfg(windows)]
fn instalar_puerta<R: Runtime>(webview: &tauri::Webview<R>, estado: Arc<Estado>) {
    use webview2_com::Microsoft::Web::WebView2::Win32::{
        ICoreWebView2AcceleratorKeyPressedEventArgs2, ICoreWebView2_11,
        COREWEBVIEW2_KEY_EVENT_KIND, COREWEBVIEW2_KEY_EVENT_KIND_KEY_DOWN,
        COREWEBVIEW2_KEY_EVENT_KIND_SYSTEM_KEY_DOWN,
    };
    use webview2_com::{AcceleratorKeyPressedEventHandler, ContextMenuRequestedEventHandler};
    use windows::core::{Interface, PWSTR};
    use windows::Win32::UI::Input::KeyboardAndMouse::{GetKeyState, VK_CONTROL, VK_SHIFT};

    let label = webview.label().to_string();
    let r = webview.with_webview(move |pw| {
        let controlador = pw.controller();
        let teclas = Arc::clone(&estado);
        let menu = Arc::clone(&estado);

        // SAFETY: COM sobre el controlador vivo, en el hilo de la UI; los
        // manejadores corren en ese mismo hilo.
        let r_teclas = unsafe {
            let mut token = 0i64;
            controlador.add_AcceleratorKeyPressed(
                &AcceleratorKeyPressedEventHandler::create(Box::new(move |_, args| {
                    let Some(args) = args else { return Ok(()) };
                    if teclas.permitidas.load(Ordering::SeqCst) {
                        return Ok(());
                    }
                    let mut tipo = COREWEBVIEW2_KEY_EVENT_KIND::default();
                    args.KeyEventKind(&mut tipo)?;
                    if tipo != COREWEBVIEW2_KEY_EVENT_KIND_KEY_DOWN
                        && tipo != COREWEBVIEW2_KEY_EVENT_KIND_SYSTEM_KEY_DOWN
                    {
                        return Ok(());
                    }
                    let mut tecla = 0u32;
                    args.VirtualKey(&mut tecla)?;
                    let ctrl = GetKeyState(VK_CONTROL.0 as i32) < 0;
                    let shift = GetKeyState(VK_SHIFT.0 as i32) < 0;
                    if !es_atajo_devtools(tecla, ctrl, shift) {
                        return Ok(());
                    }
                    match args.cast::<ICoreWebView2AcceleratorKeyPressedEventArgs2>() {
                        // El navegador no la atiende; la página la recibe igual.
                        Ok(args2) => args2.SetIsBrowserAcceleratorKeyEnabled(false),
                        // WebView2 anterior a 1.0.2210: se la come entera
                        // (la página tampoco la ve).
                        Err(_) => args.SetHandled(true),
                    }
                })),
                &mut token,
            )
        };

        let r_menu = unsafe {
            controlador.CoreWebView2().and_then(|c| c.cast::<ICoreWebView2_11>()).and_then(|c| {
                let mut token = 0i64;
                c.add_ContextMenuRequested(
                    &ContextMenuRequestedEventHandler::create(Box::new(move |_, args| {
                        let Some(args) = args else { return Ok(()) };
                        if menu.permitidas.load(Ordering::SeqCst) {
                            return Ok(());
                        }
                        let items = args.MenuItems()?;
                        let mut cuantos = 0u32;
                        items.Count(&mut cuantos)?;
                        let mut nombres = Vec::with_capacity(cuantos as usize);
                        for i in 0..cuantos {
                            let mut nombre = PWSTR::null();
                            items.GetValueAtIndex(i)?.Name(&mut nombre)?;
                            nombres.push(webview2_com::take_pwstr(nombre));
                        }
                        for i in items_a_quitar(&nombres) {
                            items.RemoveValueAtIndex(i as u32)?;
                        }
                        Ok(())
                    })),
                    &mut token,
                )
            })
        };

        let mut con_puerta = true;
        if let Err(e) = r_teclas {
            log::warn!("devtools: no se pudo vigilar los atajos de «{label}»: {e}");
            con_puerta = false;
        }
        if let Err(e) = r_menu {
            log::warn!("devtools: no se pudo vigilar el menú contextual de «{label}»: {e}");
            con_puerta = false;
        }
        estado.con_puerta.store(con_puerta, Ordering::SeqCst);
        if !con_puerta {
            // Lado seguro: el ajuste apagado (rige desde la próxima navegación).
            let permitidas = estado.permitidas.load(Ordering::SeqCst);
            let r = unsafe { controlador.CoreWebView2().and_then(|c| c.Settings()) }
                .and_then(|ajustes| unsafe { ajustes.SetAreDevToolsEnabled(permitidas) });
            if let Err(e) = r {
                log::warn!("devtools: tampoco se pudo fijar AreDevToolsEnabled en «{label}»: {e}");
            }
        }
    });
    if let Err(e) = r {
        log::warn!("devtools: no se llegó al webview «{}» para instalar la puerta: {e}", webview.label());
    }
}

/// Fija el valor de un momento en el webview `label`. Con puerta basta con
/// cambiar `permitidas`, que los manejadores leen en cada evento; sin puerta,
/// se fija además el ajuste de WebView2.
fn aplicar<R: Runtime>(app: &tauri::AppHandle<R>, label: &str, momento: Momento) {
    let permitidas = permitidas_en(momento, tauri::is_dev());
    let estado = estado_de(app, label);
    estado.permitidas.store(permitidas, Ordering::SeqCst);
    #[cfg(windows)]
    if !estado.con_puerta.load(Ordering::SeqCst) {
        if let Some(w) = app.get_webview_window(label) {
            fijar_ajuste(w.as_ref(), permitidas);
        }
    }
}

/// Se registró el vault de la ventana `label`; `devtools` es lo que esta
/// máquina decidió para él.
pub fn al_registrar_vault<R: Runtime>(app: &tauri::AppHandle<R>, label: &str, devtools: bool) {
    aplicar(app, label, Momento::VaultRegistrado(devtools));
}

/// Se movió el interruptor en la ventana `label`: rige en el acto.
pub fn al_mover_interruptor<R: Runtime>(app: &tauri::AppHandle<R>, label: &str, devtools: bool) {
    aplicar(app, label, Momento::Interruptor(devtools));
}

/// La ventana `label` soltó su vault.
pub fn al_soltar_vault<R: Runtime>(app: &tauri::AppHandle<R>, label: &str) {
    aplicar(app, label, Momento::VaultSoltado);
}

/// Cada webview nace con su estado apagado (salvo en desarrollo) y, en Windows,
/// con la puerta puesta. Al destruirse la ventana se olvida su estado.
pub fn init<R: Runtime>() -> TauriPlugin<R> {
    tauri::plugin::Builder::new("devtools-por-vault")
        .setup(|app, _| {
            app.manage(EstadosDevtools::default());
            Ok(())
        })
        .on_webview_ready(|webview| {
            let estado = Arc::new(Estado::default());
            estado
                .permitidas
                .store(permitidas_en(Momento::Creada, tauri::is_dev()), Ordering::SeqCst);
            {
                let estados = webview.app_handle().state::<EstadosDevtools>();
                let mut mapa = estados.0.lock().unwrap_or_else(|e| e.into_inner());
                mapa.insert(webview.label().to_string(), Arc::clone(&estado));
            }
            #[cfg(windows)]
            instalar_puerta(&webview, estado);
            #[cfg(not(windows))]
            let _ = estado;
        })
        .on_event(|app, evento| {
            if let tauri::RunEvent::WindowEvent { label, event: tauri::WindowEvent::Destroyed, .. } = evento {
                let estados = app.state::<EstadosDevtools>();
                let mut mapa = estados.0.lock().unwrap_or_else(|e| e.into_inner());
                mapa.remove(label);
            }
        })
        .build()
}

/// ¿Se pueden abrir en esta ventana ahora?
fn permitidas<R: Runtime>(app: &tauri::AppHandle<R>, label: &str) -> bool {
    tauri::is_dev() || estado_de(app, label).permitidas.load(Ordering::SeqCst)
}

/// Abre las herramientas de desarrollo de la ventana (y, en macOS y Linux, las
/// cierra si ya estaban abiertas). Lo invoca el frontend con F12 /
/// Ctrl+Shift+I.
///
/// En Windows no hay cómo cerrarlas ni cómo saber si están abiertas (ver el
/// módulo): `is_devtools_open` da siempre `false`, así que acá solo se abren.
///
/// `forzar` lo manda solo un comando interno de la paleta, que no depende del
/// interruptor (no es una frontera: ver el módulo). No cambia el estado: los
/// atajos nativos siguen como estaban.
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
    // Sin puerta, el ajuste puede estar apagado: WebView2 no abre nada así.
    #[cfg(windows)]
    if !estado_de(webview.app_handle(), webview.label()).con_puerta.load(Ordering::SeqCst) {
        fijar_ajuste(webview.as_ref(), true);
    }
    webview.open_devtools();
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cada_momento_fija_su_valor() {
        assert!(!permitidas_en(Momento::Creada, false), "nacen apagadas");
        assert!(permitidas_en(Momento::VaultRegistrado(true), false));
        assert!(!permitidas_en(Momento::VaultRegistrado(false), false));
        assert!(permitidas_en(Momento::Interruptor(true), false));
        assert!(!permitidas_en(Momento::Interruptor(false), false));
        assert!(!permitidas_en(Momento::VaultSoltado, false), "sin vault, apagadas");
    }

    #[test]
    fn en_desarrollo_siempre_encendidas() {
        for m in [
            Momento::Creada,
            Momento::VaultRegistrado(false),
            Momento::Interruptor(false),
            Momento::VaultSoltado,
        ] {
            assert!(permitidas_en(m, true), "{m:?}");
        }
    }

    #[test]
    fn reconoce_los_atajos_de_chromium() {
        assert!(es_atajo_devtools(VK_F12, false, false));
        assert!(es_atajo_devtools(VK_F12, true, true), "F12 con modificadores también");
        for tecla in [b'I', b'J', b'C'] {
            assert!(es_atajo_devtools(tecla as u32, true, true), "Ctrl+Shift+{}", tecla as char);
            assert!(!es_atajo_devtools(tecla as u32, true, false), "Ctrl+{} no", tecla as char);
            assert!(!es_atajo_devtools(tecla as u32, false, true), "Shift+{} no", tecla as char);
        }
        // Atajos de la app y del navegador que no son de las DevTools.
        for tecla in [b'P', b'F', b'K', b'T', b'Z'] {
            assert!(!es_atajo_devtools(tecla as u32, true, true), "Ctrl+Shift+{}", tecla as char);
        }
        assert!(!es_atajo_devtools(0x74 /* F5 */, false, false));
    }

    #[test]
    fn quita_solo_inspeccionar_de_atras_hacia_adelante() {
        let nombres = ["back", "inspectElement", "copy", "inspectElement"];
        assert_eq!(items_a_quitar(&nombres), vec![3, 1]);
        assert!(items_a_quitar(&["copy", "paste", "selectAll"]).is_empty());
        assert!(items_a_quitar::<&str>(&[]).is_empty());
    }
}
