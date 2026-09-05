//! Terminal integrada (FUN-L-07, solo-desktop).
//!
//! Cada terminal del frontend es una sesión de pseudo-terminal (PTY) real del SO
//! (ConPTY en Windows) creada con `portable-pty`: dentro corre la shell elegida
//! (PowerShell, cmd, Git Bash, WSL, bash…), así que los programas interactivos,
//! los colores y las señales (Ctrl+C) funcionan como en una terminal nativa.
//!
//! Protocolo con el frontend (xterm.js):
//! - `terminal_abrir(id, shell, cwd, cols, rows)` crea la sesión; un hilo lector
//!   emite la salida por el evento `terminal-datos` (`{ id, datos }`) y, al
//!   terminar el proceso, `terminal-salida` (`{ id }`).
//! - `terminal_escribir` reenvía el input del usuario; `terminal_redimensionar`
//!   sincroniza el tamaño; `terminal_cerrar` mata el proceso y limpia.

use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;
use tauri::Emitter;

/// Sesión viva: el master (para redimensionar), el writer (input del usuario) y
/// el proceso hijo (para matarlo al cerrar la pestaña).
struct Sesion {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    child: Box<dyn Child + Send + Sync>,
    /// Ventana dueña de la sesión (`FUN-L-16`): sus procesos mueren con ella, y
    /// su salida solo se emite ahí.
    ventana: String,
}

/// Estado gestionado por Tauri. `Arc` porque el hilo lector de cada sesión
/// necesita retirar su propia entrada del mapa cuando el proceso termina.
#[derive(Default, Clone)]
pub struct TerminalesState(Arc<Mutex<HashMap<String, Sesion>>>);

#[derive(Clone, Serialize)]
struct DatosEvento {
    id: String,
    datos: String,
}

#[derive(Clone, Serialize)]
struct SalidaEvento {
    id: String,
}

/// Una shell detectada en el sistema, para el selector de Configuración.
#[derive(Clone, Serialize)]
pub struct ShellInfo {
    /// Identificador estable (se persiste en las preferencias del frontend).
    pub id: String,
    /// Nombre para mostrar.
    pub nombre: String,
    /// Ruta o comando ejecutable.
    pub ruta: String,
}

/// Busca un ejecutable en el PATH (con PATHEXT en Windows).
fn en_path(exe: &str) -> Option<PathBuf> {
    let path = std::env::var_os("PATH")?;
    for dir in std::env::split_paths(&path) {
        let candidato = dir.join(exe);
        if candidato.is_file() {
            return Some(candidato);
        }
        #[cfg(windows)]
        {
            let con_ext = dir.join(format!("{exe}.exe"));
            if con_ext.is_file() {
                return Some(con_ext);
            }
        }
    }
    None
}

/// Shells disponibles en este sistema. La primera de la lista es la sugerida
/// cuando el usuario no configuró ninguna.
#[tauri::command]
pub fn terminal_shells() -> Vec<ShellInfo> {
    let mut shells = Vec::new();

    #[cfg(windows)]
    {
        if let Some(ruta) = en_path("pwsh") {
            shells.push(ShellInfo {
                id: "pwsh".into(),
                nombre: "PowerShell 7".into(),
                ruta: ruta.to_string_lossy().into_owned(),
            });
        }
        if let Some(ruta) = en_path("powershell") {
            shells.push(ShellInfo {
                id: "powershell".into(),
                nombre: "Windows PowerShell".into(),
                ruta: ruta.to_string_lossy().into_owned(),
            });
        }
        if let Some(ruta) = en_path("cmd") {
            shells.push(ShellInfo {
                id: "cmd".into(),
                nombre: "Símbolo del sistema (cmd)".into(),
                ruta: ruta.to_string_lossy().into_owned(),
            });
        }
        // Git Bash no suele estar en el PATH: se prueban sus rutas típicas.
        let git_bash: Vec<PathBuf> = vec![
            PathBuf::from(r"C:\Program Files\Git\bin\bash.exe"),
            PathBuf::from(r"C:\Program Files (x86)\Git\bin\bash.exe"),
            std::env::var_os("LOCALAPPDATA")
                .map(|l| PathBuf::from(l).join(r"Programs\Git\bin\bash.exe"))
                .unwrap_or_default(),
        ];
        if let Some(ruta) = git_bash.into_iter().find(|p| p.is_file()) {
            shells.push(ShellInfo {
                id: "gitbash".into(),
                nombre: "Git Bash".into(),
                ruta: ruta.to_string_lossy().into_owned(),
            });
        }
        if let Some(ruta) = en_path("wsl") {
            shells.push(ShellInfo {
                id: "wsl".into(),
                nombre: "WSL".into(),
                ruta: ruta.to_string_lossy().into_owned(),
            });
        }
    }

    #[cfg(not(windows))]
    {
        // La shell de login del usuario primero (sugerida por defecto).
        if let Ok(login) = std::env::var("SHELL") {
            if PathBuf::from(&login).is_file() {
                let nombre = PathBuf::from(&login)
                    .file_name()
                    .map(|n| n.to_string_lossy().into_owned())
                    .unwrap_or_else(|| login.clone());
                shells.push(ShellInfo {
                    id: "login".into(),
                    nombre: format!("{nombre} (por defecto del sistema)"),
                    ruta: login,
                });
            }
        }
        for (id, exe) in [("bash", "bash"), ("zsh", "zsh"), ("fish", "fish")] {
            if let Some(ruta) = en_path(exe) {
                let ruta = ruta.to_string_lossy().into_owned();
                // Evitar duplicar la shell de login.
                if shells.iter().any(|s| s.ruta == ruta) {
                    continue;
                }
                shells.push(ShellInfo { id: id.into(), nombre: exe.into(), ruta });
            }
        }
    }

    shells
}

/// Crea la sesión PTY `id` corriendo `shell` en `cwd` (o el home del usuario).
/// La salida fluye por el evento `terminal-datos`; el fin del proceso, por
/// `terminal-salida`.
#[tauri::command]
pub fn terminal_abrir(
    ventana: tauri::Window,
    state: tauri::State<TerminalesState>,
    id: String,
    shell: String,
    cwd: Option<String>,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    let mut sesiones = state.0.lock().map_err(|_| "Estado de terminales no disponible")?;
    if sesiones.contains_key(&id) {
        return Ok(()); // ya abierta (remount del componente): se reutiliza
    }

    let pty = native_pty_system();
    let par = pty
        .openpty(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 })
        .map_err(|e| format!("No se pudo crear la pseudo-terminal: {e}"))?;

    let mut cmd = CommandBuilder::new(&shell);
    cmd.env("TERM", "xterm-256color");
    let dir = cwd
        .map(PathBuf::from)
        .filter(|p| p.is_dir())
        .or_else(dirs_home)
        .ok_or("No hay directorio de trabajo válido")?;
    cmd.cwd(dir);

    let child = par
        .slave
        .spawn_command(cmd)
        .map_err(|e| format!("No se pudo iniciar la shell {shell}: {e}"))?;
    drop(par.slave);

    let mut reader = par
        .master
        .try_clone_reader()
        .map_err(|e| format!("No se pudo leer la terminal: {e}"))?;
    let writer = par
        .master
        .take_writer()
        .map_err(|e| format!("No se pudo escribir en la terminal: {e}"))?;

    sesiones.insert(
        id.clone(),
        Sesion { master: par.master, writer, child, ventana: ventana.label().to_string() },
    );
    drop(sesiones);

    // Hilo lector: PTY → frontend. Al agotarse (proceso terminado) limpia la
    // sesión y avisa para que la pestaña se cierre sola (CA7).
    let mapa = state.0.clone();
    let destino = ventana.clone();
    std::thread::spawn(move || {
        let mut buf = [0u8; 8192];
        // Cola de bytes que no llegaron a formar un carácter completo
        // (`DEF-083`). Ver `decodificar`: nunca pasa de 3.
        let mut pendiente: Vec<u8> = Vec::new();
        loop {
            match reader.read(&mut buf) {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    let datos = decodificar(&mut pendiente, &buf[..n]);
                    if datos.is_empty() {
                        continue;
                    }
                    let _ = destino.emit("terminal-datos", DatosEvento { id: id.clone(), datos });
                }
            }
        }
        if let Ok(mut sesiones) = mapa.lock() {
            sesiones.remove(&id);
        }
        let _ = destino.emit("terminal-salida", SalidaEvento { id });
    });

    Ok(())
}

/// Decodifica lo leído del PTY arrastrando el carácter que quedó a medias
/// (`DEF-083`).
///
/// El PTY se lee en trozos de 8 KB, y un carácter UTF-8 ocupa hasta 4 bytes: si
/// uno queda partido entre dos lecturas, decodificar cada trozo por separado
/// —que es lo que se hacía— convierte **las dos mitades** en el carácter de
/// reemplazo. No es solo que se vea un `<?>`: si esos bytes eran parte de una
/// secuencia de escape, la secuencia llega rota y el emulador la interpreta
/// mal, así que aparece texto en el lugar equivocado, repetido, o texto que ya
/// no debería estar.
///
/// Por eso el defecto saltaba con una TUI a pantalla completa —marcos, flechas,
/// emoji, todo multibyte, y escapes de posición todo el tiempo— y casi nunca
/// con una shell normal, que imprime ASCII y avanza hacia abajo.
///
/// La cola solo guarda un carácter **truncado al final**. Los bytes que son
/// inválidos de verdad (no una secuencia a medio llegar) se reemplazan acá
/// mismo y no se arrastran: si no, un byte suelto trabaría el flujo para
/// siempre esperando un carácter que nunca va a completarse.
fn decodificar(pendiente: &mut Vec<u8>, leido: &[u8]) -> String {
    pendiente.extend_from_slice(leido);
    let mut salida = String::new();
    loop {
        match std::str::from_utf8(pendiente) {
            Ok(texto) => {
                salida.push_str(texto);
                pendiente.clear();
                return salida;
            }
            Err(e) => {
                let hasta = e.valid_up_to();
                // `valid_up_to` garantiza que este tramo es UTF-8 válido.
                salida.push_str(std::str::from_utf8(&pendiente[..hasta]).unwrap_or(""));
                match e.error_len() {
                    // Carácter truncado al final: se espera al próximo trozo.
                    None => {
                        pendiente.drain(..hasta);
                        return salida;
                    }
                    // Bytes inválidos: se reemplazan y se sigue con el resto.
                    Some(largo) => {
                        salida.push(char::REPLACEMENT_CHARACTER);
                        pendiente.drain(..hasta + largo);
                    }
                }
            }
        }
    }
}

/// Mata las sesiones de una ventana (`FUN-L-16`). Se llama al cerrarla: sus
/// shells son suyas y no deben quedar corriendo sin nadie que las lea.
pub fn cerrar_de_ventana(state: &TerminalesState, label: &str) {
    let Ok(mut sesiones) = state.0.lock() else {
        return;
    };
    let suyas: Vec<String> = sesiones
        .iter()
        .filter(|(_, s)| s.ventana == label)
        .map(|(id, _)| id.clone())
        .collect();
    for id in suyas {
        if let Some(mut sesion) = sesiones.remove(&id) {
            let _ = sesion.child.kill();
        }
    }
}

/// Home del usuario (fallback de cwd sin depender de crates extra).
fn dirs_home() -> Option<PathBuf> {
    #[cfg(windows)]
    let var = "USERPROFILE";
    #[cfg(not(windows))]
    let var = "HOME";
    std::env::var_os(var).map(PathBuf::from).filter(|p| p.is_dir())
}

/// Input del usuario (teclas de xterm) → PTY.
#[tauri::command]
pub fn terminal_escribir(
    state: tauri::State<TerminalesState>,
    id: String,
    datos: String,
) -> Result<(), String> {
    let mut sesiones = state.0.lock().map_err(|_| "Estado de terminales no disponible")?;
    let sesion = sesiones.get_mut(&id).ok_or("Terminal no encontrada")?;
    sesion
        .writer
        .write_all(datos.as_bytes())
        .map_err(|e| format!("No se pudo escribir en la terminal: {e}"))
}

/// Sincroniza el tamaño del PTY con el del xterm visible (addon fit).
#[tauri::command]
pub fn terminal_redimensionar(
    state: tauri::State<TerminalesState>,
    id: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    let sesiones = state.0.lock().map_err(|_| "Estado de terminales no disponible")?;
    let sesion = sesiones.get(&id).ok_or("Terminal no encontrada")?;
    sesion
        .master
        .resize(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 })
        .map_err(|e| format!("No se pudo redimensionar la terminal: {e}"))
}

/// Mata el proceso y descarta la sesión (cerrar pestaña). Idempotente.
#[tauri::command]
pub fn terminal_cerrar(state: tauri::State<TerminalesState>, id: String) -> Result<(), String> {
    let mut sesiones = state.0.lock().map_err(|_| "Estado de terminales no disponible")?;
    if let Some(mut sesion) = sesiones.remove(&id) {
        let _ = sesion.child.kill();
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::decodificar;

    /// Lo que el defecto rompía: un carácter partido entre dos lecturas.
    /// `─` (U+2500, el marco de una TUI) son tres bytes.
    #[test]
    fn caracter_partido_entre_dos_lecturas() {
        let bytes = "─".as_bytes().to_vec();
        let mut pendiente = Vec::new();
        let a = decodificar(&mut pendiente, &bytes[..2]);
        assert_eq!(a, "", "con el carácter a medias no se emite nada todavía");
        let b = decodificar(&mut pendiente, &bytes[2..]);
        assert_eq!(b, "─", "al completarse sale entero, no dos reemplazos");
        assert!(pendiente.is_empty());
    }

    #[test]
    fn lo_valido_sale_y_solo_la_cola_espera() {
        let mut datos = b"hola ".to_vec();
        datos.extend_from_slice(&"ñ".as_bytes()[..1]); // primera mitad de `ñ`
        let mut pendiente = Vec::new();
        assert_eq!(decodificar(&mut pendiente, &datos), "hola ");
        assert_eq!(pendiente.len(), 1, "solo espera el byte que falta completar");
        assert_eq!(decodificar(&mut pendiente, &"ñ".as_bytes()[1..]), "ñ");
    }

    /// Una secuencia de escape partida tiene que llegar ENTERA al emulador: si
    /// se corrompe, el texto termina dibujado donde no va (`DEF-083`).
    #[test]
    fn secuencia_de_escape_partida_se_recompone() {
        let esc = "\x1b[2J\x1b[H┌─┐";
        let bytes = esc.as_bytes();
        let mut pendiente = Vec::new();
        let mut salida = String::new();
        // Se parte en trozos de 2 bytes, que corta caracteres y escapes.
        for trozo in bytes.chunks(2) {
            salida.push_str(&decodificar(&mut pendiente, trozo));
        }
        assert_eq!(salida, esc);
        assert!(pendiente.is_empty());
    }

    /// Un byte inválido de verdad no puede trabar el flujo esperando un
    /// carácter que nunca va a completarse.
    #[test]
    fn byte_invalido_no_traba_el_flujo() {
        let mut pendiente = Vec::new();
        let salida = decodificar(&mut pendiente, &[b'a', 0xFF, b'b']);
        assert_eq!(salida, "a\u{FFFD}b");
        assert!(pendiente.is_empty());
    }

    #[test]
    fn ascii_puro_pasa_tal_cual() {
        let mut pendiente = Vec::new();
        assert_eq!(decodificar(&mut pendiente, b"$ ls -la\r\n"), "$ ls -la\r\n");
        assert!(pendiente.is_empty());
    }

    /// La cola nunca crece: un carácter UTF-8 ocupa a lo sumo cuatro bytes.
    #[test]
    fn la_cola_nunca_pasa_de_tres_bytes() {
        let texto = "árbol ─ ┌ ┐ 😀 fin";
        let bytes = texto.as_bytes();
        let mut pendiente = Vec::new();
        let mut salida = String::new();
        for trozo in bytes.chunks(1) {
            salida.push_str(&decodificar(&mut pendiente, trozo));
            assert!(pendiente.len() <= 3, "la cola creció a {}", pendiente.len());
        }
        assert_eq!(salida, texto);
    }
}
