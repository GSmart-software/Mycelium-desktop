//! El canal entre el servidor MCP de control y la ventana de un vault
//! (`FUN-L-09`, `docs/features/mcp-control.md` § 2.1).
//!
//! Lo comparten las dos puntas —la escucha en la app (`src-tauri/src/control.rs`)
//! y el cliente del servidor (`mycelium-mcp`)— para que el nombre, el formato y
//! los códigos de error no se puedan desalinear.
//!
//! - **Nombre**: `\\.\pipe\mycelium-<hash>` en Windows; en el resto, un socket
//!   `mycelium-<hash>.sock` en la carpeta de configuración de la app. `<hash>`
//!   es [`hash_ruta`] de **la cadena registrada** en `vaults.json`: la misma
//!   que nombra `index-<hash>.db`.
//! - **Formato**: JSON por línea. Pedido `{"id", "op", "args", "vault"}`;
//!   respuesta `{"id", "ok": true, "resultado"}` o
//!   `{"id", "ok": false, "error": {"codigo", "mensaje", "datos"}}`.

use std::path::{Path, PathBuf};
use std::time::Duration;

use serde_json::{json, Value};

use crate::rutas::hash_ruta;

/// Cuánto espera la app a que su frontend conteste un pedido antes de
/// devolver `OCUPADA` (spec § 3.1: «un error nunca deja al servidor esperando»).
pub const ESPERA_VENTANA: Duration = Duration::from_secs(10);

/// Cuánto espera el servidor MCP la respuesta de la app. Algo más que
/// [`ESPERA_VENTANA`]: el `OCUPADA` lo tiene que dar la app, que sabe por qué;
/// este plazo es la red de seguridad por si la app misma no contesta.
pub const ESPERA_CLIENTE: Duration = Duration::from_secs(13);

/// Cuánto espera el servidor a que **el usuario** conteste una confirmación
/// (`FUN-L-09`, Parte 3). Una persona tarda más que los 10 s de un pedido, así
/// que la operación no espera dentro del pedido: la app contesta enseguida
/// `{"esperando_confirmacion": {"id"}}` y el servidor consulta con el pedido
/// `confirmacion` cada [`INTERVALO_CONFIRMACION`]. Vencido este plazo, pide
/// `confirmacion_retirar`: la pregunta sale de la pantalla y cuenta como «no».
pub const ESPERA_CONFIRMACION: Duration = Duration::from_secs(120);

/// Cada cuánto consulta el servidor una confirmación pendiente.
pub const INTERVALO_CONFIRMACION: Duration = Duration::from_millis(500);

/// Los códigos de error del contrato (spec § 3.1). Son texto a propósito: el
/// agente los lee y ramifica por ellos.
pub mod codigo {
    pub const APP_CERRADA: &str = "APP_CERRADA";
    pub const MCP_DESACTIVADO: &str = "MCP_DESACTIVADO";
    pub const VAULT_DESCONOCIDO: &str = "VAULT_DESCONOCIDO";
    pub const NO_ENCONTRADO: &str = "NO_ENCONTRADO";
    pub const AMBIGUO: &str = "AMBIGUO";
    pub const CAMBIOS_SIN_GUARDAR: &str = "CAMBIOS_SIN_GUARDAR";
    pub const OCUPADA: &str = "OCUPADA";
    pub const RECHAZADO: &str = "RECHAZADO";
    pub const INVALIDO: &str = "INVALIDO";
}

/// Dónde escucha la ventana del vault registrado como `ruta_registrada`.
///
/// `dir_app` solo se usa fuera de Windows (el socket vive ahí); en Windows el
/// espacio de nombres de los pipes es del sistema.
pub fn nombre_canal(ruta_registrada: &str, dir_app: &Path) -> PathBuf {
    let hash = hash_ruta(ruta_registrada);
    if cfg!(windows) {
        let _ = dir_app;
        PathBuf::from(format!(r"\\.\pipe\mycelium-{hash}"))
    } else {
        dir_app.join(format!("mycelium-{hash}.sock"))
    }
}

/// Un pedido, listo para escribir en el canal (sin el salto de línea).
pub fn pedido(id: &Value, op: &str, args: Value, vault: &str) -> Value {
    json!({ "id": id, "op": op, "args": args, "vault": vault })
}

/// Una respuesta buena.
pub fn ok(id: &Value, resultado: Value) -> Value {
    json!({ "id": id, "ok": true, "resultado": resultado })
}

/// Una respuesta con error tipificado.
pub fn error(id: &Value, codigo: &str, mensaje: &str, datos: Value) -> Value {
    json!({ "id": id, "ok": false, "error": { "codigo": codigo, "mensaje": mensaje, "datos": datos } })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn el_nombre_sale_del_hash_de_la_cadena_registrada() {
        let n = nombre_canal("C:\\Trabajo\\GSmart\\Mycelium", Path::new("/cfg"));
        let texto = n.to_string_lossy();
        assert!(texto.ends_with("mycelium-a6180dffa8ec68ba") || texto.ends_with("mycelium-a6180dffa8ec68ba.sock"), "{texto}");
        if cfg!(windows) {
            assert_eq!(texto, r"\\.\pipe\mycelium-a6180dffa8ec68ba");
        }
    }

    #[test]
    fn las_respuestas_tienen_la_forma_del_contrato() {
        let id = json!(7);
        assert_eq!(ok(&id, json!({"a": 1})), json!({"id": 7, "ok": true, "resultado": {"a": 1}}));
        let e = error(&id, codigo::OCUPADA, "abriendo", json!({"reintentar_en_ms": 1000}));
        assert_eq!(e["ok"], false);
        assert_eq!(e["error"]["codigo"], "OCUPADA");
        assert_eq!(e["error"]["datos"]["reintentar_en_ms"], 1000);
        assert_eq!(pedido(&id, "estado", json!({}), "C:\\V")["op"], "estado");
    }
}
