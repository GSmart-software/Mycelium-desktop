//! Cliente del canal con la ventana del vault (`mcp-control` § 2.1).
//!
//! Un pedido por conexión: se abre el pipe (o el socket), se escribe una línea
//! JSON, se lee una línea de respuesta y se cierra. La app acepta varios
//! pedidos por conexión, pero el servidor atiende una llamada a la vez y
//! reconectar cuesta microsegundos; así no hay estado de conexión que cuidar.
//!
//! > [!important] Nunca se queda esperando
//! > La conexión tiene plazo (un pipe ocupado se reintenta poco tiempo) y la
//! > lectura también ([`ESPERA_CLIENTE`]). La lectura bloqueante de un pipe en
//! > Windows no admite plazo, así que se hace en un hilo y se espera con
//! > `recv_timeout`: si vence, el hilo queda colgado hasta que la app conteste
//! > o cierre el pipe, y el servidor sigue atendiendo. Es un hilo por pedido
//! > vencido, y vencer ya es el caso raro (la app contesta `OCUPADA` a los 10 s).

use std::io::{BufRead, BufReader, Read, Write};
use std::path::Path;
use std::sync::mpsc;
use std::time::{Duration, Instant};

use serde_json::Value;

pub use mycelium_vault::canal::ESPERA_CLIENTE;

/// Por qué no hubo respuesta de la app.
#[derive(Debug, PartialEq)]
pub enum Fallo {
    /// Nadie escucha en ese nombre: la app está cerrada o el control apagado.
    NadieEscucha,
    /// Alguien escucha pero no contestó a tiempo (o el pipe siguió ocupado).
    SinRespuesta,
    /// La conexión se cortó o la respuesta no era JSON.
    Roto(String),
}

/// Cuánto se reintenta abrir un pipe que existe pero tiene todas sus
/// instancias ocupadas (otro pedido en curso).
const ESPERA_CONEXION: Duration = Duration::from_secs(2);

trait Flujo: Read + Write + Send {}
impl<T: Read + Write + Send> Flujo for T {}

#[cfg(windows)]
fn abrir(canal: &Path) -> Result<Box<dyn Flujo>, Fallo> {
    // ERROR_FILE_NOT_FOUND: no existe el pipe. ERROR_PIPE_BUSY: existe, pero
    // todas sus instancias están conectadas; la app crea la siguiente al
    // aceptar, así que vale la pena reintentar un momento.
    const NO_EXISTE: i32 = 2;
    const OCUPADO: i32 = 231;
    let limite = Instant::now() + ESPERA_CONEXION;
    loop {
        match std::fs::OpenOptions::new().read(true).write(true).open(canal) {
            Ok(f) => return Ok(Box::new(f)),
            Err(e) if e.raw_os_error() == Some(NO_EXISTE) => return Err(Fallo::NadieEscucha),
            Err(e) if e.raw_os_error() == Some(OCUPADO) => {
                if Instant::now() >= limite {
                    return Err(Fallo::SinRespuesta);
                }
                std::thread::sleep(Duration::from_millis(40));
            }
            Err(e) => return Err(Fallo::Roto(format!("no se pudo abrir el canal: {e}"))),
        }
    }
}

#[cfg(unix)]
fn abrir(canal: &Path) -> Result<Box<dyn Flujo>, Fallo> {
    use std::io::ErrorKind;
    match std::os::unix::net::UnixStream::connect(canal) {
        Ok(s) => Ok(Box::new(s)),
        // Sin archivo, o un socket viejo que nadie escucha.
        Err(e) if matches!(e.kind(), ErrorKind::NotFound | ErrorKind::ConnectionRefused) => Err(Fallo::NadieEscucha),
        Err(e) => Err(Fallo::Roto(format!("no se pudo abrir el canal: {e}"))),
    }
}

/// Manda un pedido y devuelve la respuesta de la app (el objeto entero, con
/// `ok` y `resultado` o `error`).
pub fn pedir(canal: &Path, pedido: &Value, espera: Duration) -> Result<Value, Fallo> {
    let mut flujo = abrir(canal)?;
    let mut linea = pedido.to_string();
    linea.push('\n');
    flujo
        .write_all(linea.as_bytes())
        .and_then(|_| flujo.flush())
        .map_err(|e| Fallo::Roto(format!("no se pudo escribir en el canal: {e}")))?;

    let (tx, rx) = mpsc::channel();
    std::thread::spawn(move || {
        let mut lector = BufReader::new(flujo);
        let mut respuesta = String::new();
        let r = lector.read_line(&mut respuesta).map(|n| (n, respuesta));
        let _ = tx.send(r);
    });
    match rx.recv_timeout(espera) {
        Ok(Ok((0, _))) => Err(Fallo::Roto("la app cerró el canal sin contestar".into())),
        Ok(Ok((_, texto))) => {
            serde_json::from_str(texto.trim()).map_err(|e| Fallo::Roto(format!("respuesta que no es JSON: {e}")))
        }
        Ok(Err(e)) => Err(Fallo::Roto(format!("se cortó el canal: {e}"))),
        Err(_) => Err(Fallo::SinRespuesta),
    }
}

/// Un servidor de canal falso para los tests (también lo usa la prueba de
/// punta a punta de `tests/`, que lo incluye por ruta).
#[cfg(test)]
#[path = "canal_falso.rs"]
pub mod falso;

#[cfg(test)]
mod tests {
    use super::falso::{canal_de_prueba, levantar};
    use super::*;
    use serde_json::json;

    #[test]
    fn sin_nadie_escuchando_es_nadie_escucha() {
        let canal = canal_de_prueba("vacio");
        let r = pedir(&canal, &json!({"id": 1, "op": "estado"}), Duration::from_secs(1));
        assert_eq!(r, Err(Fallo::NadieEscucha));
    }

    #[test]
    fn ida_y_vuelta_contra_un_servidor_falso() {
        let srv = levantar(canal_de_prueba("eco"), |p| {
            Some(json!({"id": p["id"], "ok": true, "resultado": {"op": p["op"], "args": p["args"]}}))
        });
        for i in 0..3 {
            let r = pedir(&srv.canal, &json!({"id": i, "op": "abrir", "args": {"objetivo": "X"}}), Duration::from_secs(5))
                .unwrap();
            assert_eq!(r["id"], i);
            assert_eq!(r["resultado"]["op"], "abrir");
            assert_eq!(r["resultado"]["args"]["objetivo"], "X");
        }
    }

    #[test]
    fn una_app_que_no_contesta_vence_el_plazo() {
        let srv = levantar(canal_de_prueba("mudo"), |_| None);
        let inicio = Instant::now();
        let r = pedir(&srv.canal, &json!({"id": 1, "op": "estado"}), Duration::from_millis(300));
        assert_eq!(r, Err(Fallo::SinRespuesta));
        assert!(inicio.elapsed() < Duration::from_secs(3), "no se quedó esperando");
    }
}
