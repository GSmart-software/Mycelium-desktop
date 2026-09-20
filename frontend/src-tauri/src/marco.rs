//! Menú de anclaje de Windows 11 con marco propio (`FUN-M-31`, solo-desktop).
//!
//! Con `decorations: false` la ventana ya no tiene la barra del sistema, y con
//! ella se fue el **menú de anclaje**: el desplegable con los diseños de
//! pantalla que Windows 11 muestra al dejar el puntero sobre el botón de
//! maximizar. No lo dibuja la app; lo dibuja Windows, y solo lo ofrece cuando la
//! ventana contesta `HTMAXBUTTON` a `WM_NCHITTEST` —«lo que hay bajo el puntero
//! es mi botón de maximizar»—. Esa respuesta la daba el marco del sistema.
//!
//! Acá se repone: se engancha un *subclass* al procedimiento de la ventana y se
//! contesta `HTMAXBUTTON` cuando el puntero cae sobre el rectángulo que el
//! frontend informa (`marco_zona_maximizar`). Eso trae tres consecuencias que
//! hay que atender, y son el resto del módulo:
//!
//! 1. Windows deja de mandarle ese clic al webview: el botón de HTML no se
//!    entera. El clic se atiende acá (`WM_NCLBUTTONUP`).
//! 2. Tampoco hay `:hover` de CSS: el puntero está, para Windows, fuera del
//!    área de cliente. Se avisa al frontend con un evento para que lo pinte.
//! 3. Solo aplica a Windows. En el resto, los comandos existen y no hacen nada,
//!    para que el frontend no tenga que preguntar en qué sistema corre.

#[cfg(target_os = "windows")]
mod win {
    use std::collections::HashMap;
    use std::ffi::c_void;
    use std::sync::{Mutex, OnceLock};

    use tauri::{Emitter, WebviewWindow};
    use windows::Win32::Foundation::{HWND, LPARAM, LRESULT, POINT, RECT, WPARAM};
    use windows::Win32::Graphics::Gdi::ScreenToClient;
    use windows::Win32::UI::Shell::{DefSubclassProc, SetWindowSubclass};
    use windows::Win32::UI::WindowsAndMessaging::{
        IsZoomed, ShowWindow, HTCLIENT, HTMAXBUTTON, SW_MAXIMIZE, SW_RESTORE, WM_NCLBUTTONDOWN,
        WM_NCLBUTTONUP, WM_NCMOUSELEAVE, WM_NCRBUTTONDOWN, WM_NCRBUTTONUP,
    };

    /// El evento con el que el frontend pinta el hover del botón, ya que el
    /// puntero —para Windows— está fuera del área de cliente.
    const EVENTO_HOVER: &str = "marco://hover-maximizar";

    /// Id del subclass. Cualquier número sirve mientras sea siempre el mismo:
    /// es lo que identifica ESTE enganche entre los que pueda haber.
    const ID_SUBCLASS: usize = 0x6d79_6365; // "myce"

    struct Zona {
        /// Rectángulo del botón en píxeles físicos, relativo al área de cliente.
        rect: RECT,
        ventana: WebviewWindow,
        hover: bool,
    }

    /// Una entrada por ventana (la clave es su HWND). Las ventanas se cierran,
    /// así que la entrada se borra cuando su HWND deja de ser válido.
    fn zonas() -> &'static Mutex<HashMap<isize, Zona>> {
        static ZONAS: OnceLock<Mutex<HashMap<isize, Zona>>> = OnceLock::new();
        ZONAS.get_or_init(|| Mutex::new(HashMap::new()))
    }

    /// El puntero (en coordenadas de pantalla, como viene en `WM_NCHITTEST`)
    /// llevado al área de cliente y comparado con el rectángulo del botón.
    fn sobre_el_boton(hwnd: HWND, lparam: LPARAM) -> bool {
        // El x va en la palabra baja y el y en la alta, ambos con signo: en un
        // monitor a la izquierda del principal las coordenadas son negativas.
        let mut punto = POINT {
            x: (lparam.0 & 0xFFFF) as i16 as i32,
            y: ((lparam.0 >> 16) & 0xFFFF) as i16 as i32,
        };
        unsafe {
            if !ScreenToClient(hwnd, &mut punto).as_bool() {
                return false;
            }
        }
        let guard = match zonas().lock() {
            Ok(g) => g,
            Err(_) => return false,
        };
        match guard.get(&(hwnd.0 as isize)) {
            Some(z) => {
                punto.x >= z.rect.left
                    && punto.x < z.rect.right
                    && punto.y >= z.rect.top
                    && punto.y < z.rect.bottom
            }
            None => false,
        }
    }

    /// Avisa al frontend, solo cuando el estado cambia: `WM_NCHITTEST` llega
    /// con cada movimiento del puntero y no hace falta repetirlo.
    fn marcar_hover(hwnd: HWND, encendido: bool) {
        if let Ok(mut guard) = zonas().lock() {
            if let Some(z) = guard.get_mut(&(hwnd.0 as isize)) {
                if z.hover != encendido {
                    z.hover = encendido;
                    let _ = z.ventana.emit(EVENTO_HOVER, encendido);
                }
            }
        }
    }

    fn alternar_maximizada(hwnd: HWND) {
        unsafe {
            let _ = ShowWindow(hwnd, if IsZoomed(hwnd).as_bool() { SW_RESTORE } else { SW_MAXIMIZE });
        }
    }

    unsafe extern "system" fn procedimiento(
        hwnd: HWND,
        mensaje: u32,
        wparam: WPARAM,
        lparam: LPARAM,
        _id: usize,
        _datos: usize,
    ) -> LRESULT {
        const WM_NCHITTEST: u32 = 0x0084;
        let en_boton = || wparam.0 as i32 == HTMAXBUTTON as i32;

        match mensaje {
            WM_NCHITTEST => {
                let respuesta = unsafe { DefSubclassProc(hwnd, mensaje, wparam, lparam) };
                // Solo se reinterpreta el área de cliente: los bordes y todo lo
                // que Windows ya resuelve se dejan como están.
                if respuesta.0 as i32 == HTCLIENT as i32 && sobre_el_boton(hwnd, lparam) {
                    marcar_hover(hwnd, true);
                    return LRESULT(HTMAXBUTTON as isize);
                }
                marcar_hover(hwnd, false);
                respuesta
            }
            // El puntero salió del área no-cliente: apagar el hover aunque no
            // haya vuelto a pasar por el botón.
            WM_NCMOUSELEAVE => {
                marcar_hover(hwnd, false);
                unsafe { DefSubclassProc(hwnd, mensaje, wparam, lparam) }
            }
            // Los clics sobre el botón los atiende este módulo: al contestar
            // `HTMAXBUTTON`, Windows deja de pasárselos al webview. El de bajar
            // se consume para que no salga el menú de la ventana.
            WM_NCLBUTTONDOWN | WM_NCRBUTTONDOWN if en_boton() => LRESULT(0),
            WM_NCLBUTTONUP if en_boton() => {
                alternar_maximizada(hwnd);
                LRESULT(0)
            }
            WM_NCRBUTTONUP if en_boton() => LRESULT(0),
            _ => unsafe { DefSubclassProc(hwnd, mensaje, wparam, lparam) },
        }
    }

    /// Guarda el rectángulo del botón y, la primera vez, engancha el subclass.
    pub fn registrar(ventana: &WebviewWindow, x: f64, y: f64, ancho: f64, alto: f64) -> Result<(), String> {
        let hwnd = ventana.hwnd().map_err(|e| format!("sin ventana nativa: {e}"))?;
        let hwnd = HWND(hwnd.0 as *mut c_void);
        // El frontend mide en píxeles CSS y Windows pregunta en físicos.
        let escala = ventana.scale_factor().unwrap_or(1.0);
        let rect = RECT {
            left: (x * escala).round() as i32,
            top: (y * escala).round() as i32,
            right: ((x + ancho) * escala).round() as i32,
            bottom: ((y + alto) * escala).round() as i32,
        };

        let mut guard = zonas().lock().map_err(|_| "estado del marco bloqueado".to_string())?;
        let clave = hwnd.0 as isize;
        let nueva = !guard.contains_key(&clave);
        guard.insert(
            clave,
            Zona { rect, ventana: ventana.clone(), hover: false },
        );
        drop(guard);

        if nueva {
            // El enganche se hace desde el hilo dueño de la ventana, que es el
            // que corre su bucle de mensajes; desde otro, Windows lo rechaza.
            // `HWND` no viaja entre hilos, así que va el número y se rearma.
            let crudo = clave;
            ventana
                .run_on_main_thread(move || {
                    let hwnd = HWND(crudo as *mut c_void);
                    let ok = unsafe { SetWindowSubclass(hwnd, Some(procedimiento), ID_SUBCLASS, 0) };
                    if !ok.as_bool() {
                        if let Ok(mut g) = zonas().lock() {
                            g.remove(&crudo);
                        }
                        log::warn!("[marco] no se pudo enganchar el procedimiento de la ventana");
                    }
                })
                .map_err(|e| format!("no se pudo agendar en el hilo de la ventana: {e}"))?;
        }
        Ok(())
    }

    /// Al cerrarse una ventana, su entrada deja de tener sentido (y su HWND se
    /// puede reutilizar para otra).
    pub fn olvidar(ventana: &WebviewWindow) {
        if let Ok(hwnd) = ventana.hwnd() {
            if let Ok(mut guard) = zonas().lock() {
                guard.remove(&(hwnd.0 as isize));
            }
        }
    }
}

/// Dónde está dibujado el botón de maximizar, en píxeles CSS relativos al área
/// de cliente. Lo informa el frontend al montarse y cada vez que cambia de
/// lugar; en Windows habilita además el menú de anclaje.
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
