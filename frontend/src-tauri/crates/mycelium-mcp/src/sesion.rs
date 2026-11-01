//! La **sesión** de este servidor ante la app (`FUN-L-31`, coordinación entre
//! sesiones; spec en `docs/features/ia-vaults-intensivos.md` § 6).
//!
//! Claude Code lanza **un proceso `mycelium-mcp` por sesión** (es hijo del
//! `claude.exe` de esa sesión y vive lo que ella), así que el proceso ya es la
//! sesión: su id se genera acá al arrancar y no cambia mientras vive. No se
//! depende de ninguna variable de entorno de Claude Code: ninguna está
//! documentada para los servidores MCP. Del `initialize` se toma `clientInfo`
//! (nombre y versión del cliente), solo para mostrarlo.
//!
//! Dos cosas viajan a la app:
//!
//! 1. **En cada pedido**, el campo `sesion` (ver [`datos`]): así la app sabe
//!    quién pidió cada operación (registro de actividad, reservas, estado).
//! 2. **Una conexión de presencia** ([`arrancar_presencia`]): un hilo abre una
//!    conexión propia con el canal, se anuncia (`sesion_abrir`) y la deja
//!    abierta sin hacer nada. Cuando el proceso muere —se cerró la sesión, o se
//!    mató—, el sistema cierra esa conexión y la app la da por terminada, con
//!    sus reservas. Los pedidos siguen yendo de a uno por conexión, como antes:
//!    la presencia no comparte nada con ellos. Si la app está cerrada o el
//!    control apagado, se reintenta cada [`REINTENTO_PRESENCIA`].

use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde_json::{json, Value};

use crate::canal;

/// Cada cuánto se reintenta anunciarse si nadie escucha (app cerrada, control
/// apagado) o la conexión se cortó. Abrir un pipe que no existe falla al
/// instante: el costo es nulo.
pub const REINTENTO_PRESENCIA: Duration = Duration::from_secs(3);

/// Si la app contestó que no conoce la presencia (una versión vieja), se
/// insiste mucho más espaciado.
const REINTENTO_RECHAZADA: Duration = Duration::from_secs(60);

struct Sesion {
    id: String,
    pid: u32,
    /// Milisegundos desde 1970 (UTC).
    inicio: u64,
}

fn ahora_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

fn sesion() -> &'static Sesion {
    static S: OnceLock<Sesion> = OnceLock::new();
    S.get_or_init(|| {
        let pid = std::process::id();
        let inicio = ahora_ms();
        let nanos = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.subsec_nanos()).unwrap_or(0);
        Sesion { id: id_para(pid, nanos), pid, inicio }
    })
}

/// `<pid en hex>-<4 hex del instante>`: corto para leerlo en el panel y en
/// las respuestas, y sin choques en la práctica (el pid es único entre los
/// procesos vivos; la cola distingue un pid reusado más tarde).
pub fn id_para(pid: u32, nanos: u32) -> String {
    format!("{pid:x}-{:04x}", (nanos >> 8) & 0xffff)
}

/// El id de esta sesión.
pub fn id() -> &'static str {
    &sesion().id
}

fn cliente() -> &'static Mutex<Option<Value>> {
    static C: OnceLock<Mutex<Option<Value>>> = OnceLock::new();
    C.get_or_init(|| Mutex::new(None))
}

/// Guarda el `clientInfo` del `initialize` (`{name, version}`), si vino.
pub fn fijar_cliente(params: &Value) {
    let Some(info) = params.get("clientInfo").filter(|v| v.is_object()) else { return };
    let nombre = info.get("title").or_else(|| info.get("name")).and_then(Value::as_str).unwrap_or("").trim();
    if nombre.is_empty() {
        return;
    }
    let version = info.get("version").and_then(Value::as_str).unwrap_or("").trim();
    if let Ok(mut c) = cliente().lock() {
        *c = Some(json!({ "nombre": nombre.chars().take(80).collect::<String>(), "version": version.chars().take(40).collect::<String>() }));
    }
}

/// Lo que va en el campo `sesion` de cada pedido.
pub fn datos() -> Value {
    let s = sesion();
    let cliente = cliente().lock().ok().and_then(|c| c.clone()).unwrap_or(Value::Null);
    json!({ "id": s.id, "pid": s.pid, "inicio": s.inicio, "cliente": cliente })
}

/// Dónde anunciarse: el canal y la cadena registrada del vault. Lo fija
/// `servidor::correr`; los tests unitarios, que llaman a `procesar` sin
/// `correr`, no lo fijan y no abren ninguna presencia.
static DESTINO: OnceLock<(PathBuf, String)> = OnceLock::new();

pub fn preparar_presencia(canal: PathBuf, vault: String) {
    if canal.as_os_str().is_empty() {
        return;
    }
    let _ = DESTINO.set((canal, vault));
}

/// Arranca, una sola vez, el hilo de presencia (lo llama `initialize`, cuando
/// ya se sabe el cliente). Sin destino preparado, no hace nada.
pub fn arrancar_presencia() {
    static ARRANCADA: OnceLock<()> = OnceLock::new();
    let Some((canal_ruta, vault)) = DESTINO.get().cloned() else { return };
    if ARRANCADA.set(()).is_err() {
        return;
    }
    std::thread::spawn(move || loop {
        let pedido = json!({ "id": 0, "op": "sesion_abrir", "args": {}, "vault": vault, "sesion": datos() });
        let espera = match canal::sostener(&canal_ruta, &pedido) {
            // Aceptada y luego cortada (la app se cerró o apagó el control):
            // cuando vuelva, nos anunciamos otra vez.
            Ok(true) => REINTENTO_PRESENCIA,
            Ok(false) => REINTENTO_RECHAZADA,
            Err(_) => REINTENTO_PRESENCIA,
        };
        std::thread::sleep(espera);
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn el_id_es_corto_y_estable() {
        assert_eq!(id_para(0x4f28, 0x00a1_b300), "4f28-a1b3");
        assert_eq!(id(), id(), "no cambia mientras vive el proceso");
        assert!(id().starts_with(&format!("{:x}-", std::process::id())));
    }

    #[test]
    fn los_datos_llevan_el_cliente_si_vino() {
        fijar_cliente(&json!({"clientInfo": {"name": "claude-code", "version": "2.1.0"}}));
        let d = datos();
        assert_eq!(d["id"], id());
        assert_eq!(d["cliente"]["nombre"], "claude-code");
        assert_eq!(d["cliente"]["version"], "2.1.0");
        // Un `initialize` sin clientInfo no borra lo que había.
        fijar_cliente(&json!({}));
        assert_eq!(datos()["cliente"]["nombre"], "claude-code");
    }
}
