//! Un servidor de canal **falso** que hace de app en los tests: atiende con
//! `responder` cada línea que recibe, en un hilo, hasta que se suelta. Habla el
//! mismo pipe (o socket) que la app, así que lo que se prueba es el cliente de
//! verdad.
//!
//! Autocontenido a propósito: lo incluyen por ruta tanto los tests unitarios
//! (`canal.rs`) como la prueba de punta a punta (`tests/punta_a_punta.rs`), que
//! no ve los módulos privados del binario.
#![allow(dead_code)]

use std::io::{BufRead, BufReader, Read, Write};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Arc};
use std::time::Duration;

use serde_json::Value;

type Responder = Arc<dyn Fn(Value) -> Option<Value> + Send + Sync>;
/// Lo que se llama cuando una conexión se cierra, con su número (ver
/// [`levantar_con_cierre`]).
type AlCerrar = Arc<dyn Fn(u64) + Send + Sync>;

pub struct Servidor {
    pub canal: PathBuf,
    parar: Arc<AtomicBool>,
}

impl Drop for Servidor {
    fn drop(&mut self) {
        self.parar.store(true, Ordering::SeqCst);
        // Despertar al hilo bloqueado esperando una conexión.
        plataforma::despertar(&self.canal);
    }
}

/// Un nombre de canal único para un test: no puede chocar con una app real.
pub fn canal_de_prueba(nombre: &str) -> PathBuf {
    static N: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);
    let n = N.fetch_add(1, Ordering::SeqCst);
    let nanos = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0);
    let unico = format!("prueba-{nombre}-{}-{n}-{nanos}", std::process::id());
    mycelium_vault::canal::nombre_canal(&unico, &std::env::temp_dir())
}

/// Levanta el servidor en `canal`. `responder` devuelve `None` para no
/// contestar (y probar así los plazos).
pub fn levantar<F>(canal: PathBuf, responder: F) -> Servidor
where
    F: Fn(Value) -> Option<Value> + Send + Sync + 'static,
{
    levantar_interno(canal, Arc::new(responder), None)
}

/// Como [`levantar`], pero cada pedido llega con `_conexion` (el número de la
/// conexión por la que vino) y `al_cerrar` se llama con ese número cuando la
/// conexión se corta. Sirve para hacer de app con sesiones (`FUN-L-31`): la
/// presencia de un servidor es una conexión que queda abierta mientras vive.
pub fn levantar_con_cierre<F, C>(canal: PathBuf, responder: F, al_cerrar: C) -> Servidor
where
    F: Fn(Value) -> Option<Value> + Send + Sync + 'static,
    C: Fn(u64) + Send + Sync + 'static,
{
    levantar_interno(canal, Arc::new(responder), Some(Arc::new(al_cerrar)))
}

fn levantar_interno(canal: PathBuf, responder: Responder, al_cerrar: Option<AlCerrar>) -> Servidor {
    let parar = Arc::new(AtomicBool::new(false));
    let (p, c) = (parar.clone(), canal.clone());
    let (listo_tx, listo_rx) = mpsc::channel();
    std::thread::spawn(move || plataforma::bucle(c, p, responder, al_cerrar, listo_tx));
    listo_rx.recv_timeout(Duration::from_secs(5)).expect("el servidor falso no arrancó");
    Servidor { canal, parar }
}

fn atender<S: Read + Write>(s: S, responder: &Responder, al_cerrar: Option<AlCerrar>) {
    static CONEXIONES: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(1);
    let conexion = CONEXIONES.fetch_add(1, Ordering::SeqCst);
    atender_lineas(s, responder, al_cerrar.is_some().then_some(conexion));
    if let Some(f) = al_cerrar {
        f(conexion);
    }
}

fn atender_lineas<S: Read + Write>(s: S, responder: &Responder, conexion: Option<u64>) {
    let mut lector = BufReader::new(s);
    let mut linea = String::new();
    while matches!(lector.read_line(&mut linea), Ok(n) if n > 0) {
        let mut pedido: Value = serde_json::from_str(linea.trim()).unwrap_or(Value::Null);
        linea.clear();
        if let (Some(n), Some(o)) = (conexion, pedido.as_object_mut()) {
            o.insert("_conexion".into(), Value::from(n));
        }
        let Some(r) = responder(pedido) else { continue };
        let mut texto = r.to_string();
        texto.push('\n');
        if lector.get_mut().write_all(texto.as_bytes()).is_err() {
            break;
        }
    }
}

#[cfg(windows)]
mod plataforma {
    use super::*;
    use std::os::windows::io::FromRawHandle;
    use windows::core::HSTRING;
    use windows::Win32::Storage::FileSystem::PIPE_ACCESS_DUPLEX;
    use windows::Win32::System::Pipes::{
        ConnectNamedPipe, CreateNamedPipeW, PIPE_READMODE_BYTE, PIPE_REJECT_REMOTE_CLIENTS, PIPE_TYPE_BYTE,
        PIPE_UNLIMITED_INSTANCES, PIPE_WAIT,
    };

    pub fn despertar(canal: &std::path::Path) {
        let _ = std::fs::OpenOptions::new().read(true).write(true).open(canal);
    }

    pub fn bucle(
        canal: PathBuf,
        parar: Arc<AtomicBool>,
        responder: Responder,
        al_cerrar: Option<AlCerrar>,
        listo: mpsc::Sender<()>,
    ) {
        let nombre = HSTRING::from(canal.as_os_str());
        let mut avisado = false;
        while !parar.load(Ordering::SeqCst) {
            let h = unsafe {
                CreateNamedPipeW(
                    &nombre,
                    PIPE_ACCESS_DUPLEX,
                    PIPE_TYPE_BYTE | PIPE_READMODE_BYTE | PIPE_WAIT | PIPE_REJECT_REMOTE_CLIENTS,
                    PIPE_UNLIMITED_INSTANCES,
                    4096,
                    4096,
                    0,
                    None,
                )
            };
            if h.is_invalid() {
                return;
            }
            if !avisado {
                let _ = listo.send(());
                avisado = true;
            }
            // Un cliente que conectó entre el Create y el Connect da
            // ERROR_PIPE_CONNECTED: también es una conexión, por eso se ignora
            // el resultado.
            let _ = unsafe { ConnectNamedPipe(h, None) };
            let archivo = unsafe { std::fs::File::from_raw_handle(h.0) };
            if parar.load(Ordering::SeqCst) {
                break;
            }
            let (r, c) = (responder.clone(), al_cerrar.clone());
            std::thread::spawn(move || atender(archivo, &r, c));
        }
    }
}

#[cfg(unix)]
mod plataforma {
    use super::*;
    use std::os::unix::net::{UnixListener, UnixStream};

    pub fn despertar(canal: &std::path::Path) {
        let _ = UnixStream::connect(canal);
        let _ = std::fs::remove_file(canal);
    }

    pub fn bucle(
        canal: PathBuf,
        parar: Arc<AtomicBool>,
        responder: Responder,
        al_cerrar: Option<AlCerrar>,
        listo: mpsc::Sender<()>,
    ) {
        let _ = std::fs::remove_file(&canal);
        let Ok(oyente) = UnixListener::bind(&canal) else { return };
        let _ = listo.send(());
        for s in oyente.incoming() {
            if parar.load(Ordering::SeqCst) {
                break;
            }
            let Ok(s) = s else { continue };
            let (r, c) = (responder.clone(), al_cerrar.clone());
            std::thread::spawn(move || atender(s, &r, c));
        }
    }
}
