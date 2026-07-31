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
use tauri::{AppHandle, Emitter};

/// Sesión viva: el master (para redimensionar), el writer (input del usuario) y
/// el proceso hijo (para matarlo al cerrar la pestaña).
struct Sesion {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    child: Box<dyn Child + Send + Sync>,
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
    app: AppHandle,
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

    sesiones.insert(id.clone(), Sesion { master: par.master, writer, child });
    drop(sesiones);

    // Hilo lector: PTY → frontend. Al agotarse (proceso terminado) limpia la
    // sesión y avisa para que la pestaña se cierre sola (CA7).
    let mapa = state.0.clone();
    std::thread::spawn(move || {
        let mut buf = [0u8; 8192];
        loop {
            match reader.read(&mut buf) {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    let datos = String::from_utf8_lossy(&buf[..n]).into_owned();
                    let _ = app.emit("terminal-datos", DatosEvento { id: id.clone(), datos });
                }
            }
        }
        if let Ok(mut sesiones) = mapa.lock() {
            sesiones.remove(&id);
        }
        let _ = app.emit("terminal-salida", SalidaEvento { id });
    });

    Ok(())
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
