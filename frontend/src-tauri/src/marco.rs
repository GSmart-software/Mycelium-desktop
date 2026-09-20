//! Menú de anclaje de Windows 11 con marco propio (`FUN-M-31`, solo-desktop).
//!
//! Con `decorations: false` la ventana ya no tiene la barra del sistema, y con
//! ella se fue el **menú de anclaje**: el desplegable con los diseños de
//! pantalla que Windows 11 muestra al dejar el puntero sobre el botón de
//! maximizar. No lo dibuja la app; lo dibuja Windows, y solo se lo ofrece a la
//! ventana que conteste `HTMAXBUTTON` cuando él pregunta qué hay bajo el
//! puntero (`WM_NCHITTEST`).
//!
//! > [!warning] Contestar desde la ventana principal NO alcanza
//! > La página vive dentro de una **ventana hija del WebView2** que tapa toda el
//! > área de cliente, así que Windows le pregunta a ESA y a la principal no le
//! > llega nada mientras el puntero esté sobre el contenido. Medido acá el
//! > 2026-09-20: se enganchó su procedimiento y, con el puntero sobre el botón,
//! > no entró un solo mensaje; solo llegaban los de los bordes.
//!
//! Por eso el botón lleva encima una **ventana nativa propia**, hija y sin
//! pintar: mide lo que el botón, no dibuja nada —el diseño se sigue viendo
//! debajo— y contesta `HTMAXBUTTON`. Es la misma salida a la que llegaron por
//! separado los plugins de la comunidad.
//!
//! Esa ventanita se queda con el ratón en ese rectángulo, así que tiene que
//! devolverle a la página lo que le saca: el clic (lo atiende acá, alternando
//! maximizar y restaurar) y el hover (va por el evento `marco://hover-maximizar`,
//! que el componente pinta). Solo Windows; en el resto los comandos existen y no
//! hacen nada.

#[cfg(target_os = "windows")]
mod win {
    use std::collections::HashMap;
    use std::ffi::c_void;
    use std::sync::{Mutex, OnceLock};

    use tauri::{Emitter, WebviewWindow};
    use windows::core::{w, PCWSTR};
    use windows::Win32::Foundation::{HINSTANCE, HWND, LPARAM, LRESULT, WPARAM};
    use windows::Win32::Graphics::Gdi::{GetStockObject, HBRUSH, NULL_BRUSH};
    use windows::Win32::System::LibraryLoader::GetModuleHandleW;
    use windows::Win32::UI::Input::KeyboardAndMouse::{
        TrackMouseEvent, TME_LEAVE, TME_NONCLIENT, TRACKMOUSEEVENT,
    };
    use windows::Win32::UI::WindowsAndMessaging::{
        CreateWindowExW, DefWindowProcW, DestroyWindow, GetParent, IsZoomed, RegisterClassW,
        SetWindowPos, ShowWindow, HTMAXBUTTON, HWND_TOP, SWP_NOACTIVATE, SW_MAXIMIZE, SW_RESTORE,
        WINDOW_EX_STYLE, WM_NCHITTEST, WM_NCLBUTTONDOWN, WM_NCLBUTTONUP, WM_NCMOUSELEAVE,
        WM_NCMOUSEMOVE, WM_NCRBUTTONDOWN, WM_NCRBUTTONUP, WNDCLASSW, WS_CHILD, WS_CLIPSIBLINGS,
        WS_VISIBLE,
    };

    /// El evento con el que el frontend pinta el hover del botón, ya que el
    /// puntero —para Windows— está sobre esta ventanita y no sobre la página.
    const EVENTO_HOVER: &str = "marco://hover-maximizar";

    /// La ventanita de una ventana de la app: su HWND y a quién avisarle.
    struct Capa {
        capa: isize,
        ventana: WebviewWindow,
        hover: bool,
    }

    /// Una entrada por ventana de la app (la clave es su HWND principal).
    fn capas() -> &'static Mutex<HashMap<isize, Capa>> {
        static CAPAS: OnceLock<Mutex<HashMap<isize, Capa>>> = OnceLock::new();
        CAPAS.get_or_init(|| Mutex::new(HashMap::new()))
    }

    /// Avisa al frontend, solo cuando el estado cambia: el movimiento del
    /// puntero llega muchas veces por segundo.
    fn marcar_hover(capa: HWND, encendido: bool) {
        if let Ok(mut guard) = capas().lock() {
            if let Some(c) = guard.values_mut().find(|c| c.capa == capa.0 as isize) {
                if c.hover != encendido {
                    c.hover = encendido;
                    let _ = c.ventana.emit(EVENTO_HOVER, encendido);
                }
            }
        }
    }

    fn alternar_maximizada(hwnd: HWND) {
        unsafe {
            let _ = ShowWindow(
                hwnd,
                if IsZoomed(hwnd).as_bool() { SW_RESTORE } else { SW_MAXIMIZE },
            );
        }
    }

    /// Pide que Windows avise cuando el puntero se vaya: sin esto, el hover
    /// queda encendido si el puntero sale rápido de la ventanita.
    fn seguir_salida(capa: HWND) {
        let mut seguimiento = TRACKMOUSEEVENT {
            cbSize: std::mem::size_of::<TRACKMOUSEEVENT>() as u32,
            dwFlags: TME_LEAVE | TME_NONCLIENT,
            hwndTrack: capa,
            dwHoverTime: 0,
        };
        unsafe {
            let _ = TrackMouseEvent(&mut seguimiento);
        }
    }

    unsafe extern "system" fn procedimiento(
        hwnd: HWND,
        mensaje: u32,
        wparam: WPARAM,
        lparam: LPARAM,
    ) -> LRESULT {
        match mensaje {
            // La razón de existir de esta ventana: contestar siempre que lo que
            // hay bajo el puntero es el botón de maximizar.
            WM_NCHITTEST => LRESULT(HTMAXBUTTON as isize),
            WM_NCMOUSEMOVE => {
                seguir_salida(hwnd);
                marcar_hover(hwnd, true);
                LRESULT(0)
            }
            WM_NCMOUSELEAVE => {
                marcar_hover(hwnd, false);
                LRESULT(0)
            }
            // El clic tampoco llega a la página: se atiende acá. El de bajar se
            // consume para que Windows no abra el menú de la ventana.
            WM_NCLBUTTONDOWN | WM_NCRBUTTONDOWN => LRESULT(0),
            WM_NCLBUTTONUP => {
                if let Ok(padre) = unsafe { GetParent(hwnd) } {
                    alternar_maximizada(padre);
                }
                marcar_hover(hwnd, false);
                LRESULT(0)
            }
            WM_NCRBUTTONUP => LRESULT(0),
            _ => unsafe { DefWindowProcW(hwnd, mensaje, wparam, lparam) },
        }
    }

    const CLASE: PCWSTR = w!("MyceliumCapaMaximizar");

    /// Registra la clase de ventana una sola vez por proceso.
    fn clase_registrada() -> bool {
        static CLASE_OK: OnceLock<bool> = OnceLock::new();
        *CLASE_OK.get_or_init(|| unsafe {
            let instancia: HINSTANCE = GetModuleHandleW(None).map(|m| m.into()).unwrap_or_default();
            let clase = WNDCLASSW {
                lpfnWndProc: Some(procedimiento),
                hInstance: instancia,
                lpszClassName: CLASE,
                // Sin pincel de fondo: la ventanita no pinta nada y por debajo
                // se sigue viendo el botón de la página.
                hbrBackground: HBRUSH(GetStockObject(NULL_BRUSH).0),
                ..Default::default()
            };
            RegisterClassW(&clase) != 0
        })
    }

    /// Crea (la primera vez) y coloca la ventanita sobre el botón.
    pub fn registrar(
        ventana: &WebviewWindow,
        x: f64,
        y: f64,
        ancho: f64,
        alto: f64,
    ) -> Result<(), String> {
        if !clase_registrada() {
            return Err("no se pudo registrar la clase de la capa".into());
        }
        let principal = ventana.hwnd().map_err(|e| format!("sin ventana nativa: {e}"))?;
        let principal = principal.0 as isize;
        // El frontend mide en píxeles CSS y Windows coloca en físicos.
        let escala = ventana.scale_factor().unwrap_or(1.0);
        let (px, py) = ((x * escala).round() as i32, (y * escala).round() as i32);
        let (pw, ph) = ((ancho * escala).round() as i32, (alto * escala).round() as i32);
        if pw <= 0 || ph <= 0 {
            return Ok(());
        }

        let existente = capas().lock().ok().and_then(|g| g.get(&principal).map(|c| c.capa));
        let ventana_clon = ventana.clone();

        ventana
            .run_on_main_thread(move || unsafe {
                let padre = HWND(principal as *mut c_void);
                let capa = match existente {
                    Some(h) => HWND(h as *mut c_void),
                    None => {
                        let instancia: HINSTANCE =
                            GetModuleHandleW(None).map(|m| m.into()).unwrap_or_default();
                        match CreateWindowExW(
                            WINDOW_EX_STYLE(0),
                            CLASE,
                            PCWSTR::null(),
                            // `WS_CLIPSIBLINGS` para convivir con la ventana del
                            // webview, que es su hermana y ocupa todo.
                            WS_CHILD | WS_VISIBLE | WS_CLIPSIBLINGS,
                            px,
                            py,
                            pw,
                            ph,
                            Some(padre),
                            None,
                            Some(instancia),
                            None,
                        ) {
                            Ok(h) => h,
                            Err(e) => {
                                log::warn!("[marco] no se pudo crear la capa del botón: {e}");
                                return;
                            }
                        }
                    }
                };

                // Siempre por encima del webview, y recolocada en cada cambio.
                let _ = SetWindowPos(capa, Some(HWND_TOP), px, py, pw, ph, SWP_NOACTIVATE);

                if let Ok(mut guard) = capas().lock() {
                    guard.insert(
                        principal,
                        Capa { capa: capa.0 as isize, ventana: ventana_clon.clone(), hover: false },
                    );
                }
            })
            .map_err(|e| format!("no se pudo agendar en el hilo de la ventana: {e}"))?;
        Ok(())
    }

    /// El botón dejó de existir (se desmontó el componente o se cierra la
    /// ventana): la ventanita se destruye para no quedar flotando encima.
    pub fn olvidar(ventana: &WebviewWindow) {
        let Ok(principal) = ventana.hwnd() else { return };
        let principal = principal.0 as isize;
        let capa = capas().lock().ok().and_then(|mut g| g.remove(&principal).map(|c| c.capa));
        let Some(capa) = capa else { return };
        let _ = ventana.run_on_main_thread(move || unsafe {
            let _ = DestroyWindow(HWND(capa as *mut c_void));
        });
    }
}

/// Dónde está dibujado el botón de maximizar, en píxeles CSS relativos al área
/// de cliente. Lo informa el frontend al montarse y cada vez que cambia de
/// lugar; en Windows coloca ahí la ventanita del menú de anclaje.
#[tauri::command]
pub fn marco_zona_maximizar(
    window: tauri::WebviewWindow,
    x: f64,
    y: f64,
    ancho: f64,
    alto: f64,
) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        return win::registrar(&window, x, y, ancho, alto);
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = (window, x, y, ancho, alto);
        Ok(())
    }
}

/// El botón dejó de existir (se desmontó el componente o se cierra la ventana).
#[tauri::command]
pub fn marco_olvidar_zona(window: tauri::WebviewWindow) {
    #[cfg(target_os = "windows")]
    win::olvidar(&window);
    #[cfg(not(target_os = "windows"))]
    let _ = window;
}
