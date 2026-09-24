//! MCP por stdio: JSON-RPC 2.0, un mensaje por línea (sin saltos de línea
//! dentro del mensaje), respuestas por stdout y diagnóstico por stderr.
//!
//! > [!info] Por qué a mano y no con el SDK oficial de Rust (`rmcp`)
//! > La superficie que usa este servidor es chica y estable: `initialize`,
//! > `notifications/initialized`, `ping`, `tools/list` y `tools/call`. Eso son
//! > unas 150 líneas sin dependencias nuevas. El SDK trae un runtime asíncrono
//! > (tokio), macros y `schemars` para un servidor que atiende **una** llamada a
//! > la vez sobre SQLite síncrono; sube el tiempo de compilación en una máquina
//! > que ya compila Tauri con `CARGO_BUILD_JOBS=2`, suma peso a un binario que
//! > va a viajar en el instalador, y su API todavía cambia entre versiones
//! > menores. Si el servidor crece hacia lo que el SDK resuelve de verdad
//! > (notificaciones del servidor, recursos con suscripción, cancelación,
//! > transporte HTTP), ese es el momento de migrar: las herramientas viven en
//! > `herramientas.rs` y no dependen de este archivo.

use serde_json::{json, Value};

/// Versiones del protocolo que este servidor sabe hablar, de la más nueva a la
/// más vieja. Solo usa lo que las cuatro tienen en común.
pub const VERSIONES: [&str; 4] = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];

/// La versión que se responde: la que pidió el cliente si la conocemos; si no,
/// la más nueva que sabemos (y el cliente decide si sigue).
pub fn negociar(pedida: Option<&str>) -> &'static str {
    pedida.and_then(|p| VERSIONES.iter().find(|v| **v == p).copied()).unwrap_or(VERSIONES[0])
}

pub const PARSE_ERROR: i64 = -32700;
pub const INVALID_REQUEST: i64 = -32600;
pub const METHOD_NOT_FOUND: i64 = -32601;
pub const INVALID_PARAMS: i64 = -32602;

pub fn respuesta(id: &Value, resultado: Value) -> Value {
    json!({ "jsonrpc": "2.0", "id": id, "result": resultado })
}

pub fn error(id: &Value, codigo: i64, mensaje: &str) -> Value {
    json!({ "jsonrpc": "2.0", "id": id, "error": { "code": codigo, "message": mensaje } })
}

/// Resultado de `tools/call`: texto plano, marcado como error si hace falta.
/// Los errores de la **herramienta** (vault desconocido, índice ocupado) van
/// así y no como error de JSON-RPC: el agente tiene que poder leerlos.
pub fn texto(t: String, es_error: bool) -> Value {
    json!({ "content": [{ "type": "text", "text": t }], "isError": es_error })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn negocia_la_version() {
        assert_eq!(negociar(Some("2025-03-26")), "2025-03-26");
        assert_eq!(negociar(Some("2099-01-01")), VERSIONES[0]);
        assert_eq!(negociar(None), VERSIONES[0]);
    }
}
