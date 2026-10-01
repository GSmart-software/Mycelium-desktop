//! Las herramientas del MCP de control (`mcp-control` § 1 y § 3).
//!
//! En la Parte 0 no hay ninguna: el servidor habla el protocolo y resuelve su
//! vault, nada más. La Parte 1 agrega `mycelium_estado` y `mycelium_abrir`;
//! cada herramienta nueva se declara en [`definiciones`] y se atiende en
//! [`llamar`].
//!
//! Las búsquedas de la fase de memoria (`vault_buscar`, `vault_leer`) se
//! evaluaron y no entraron (`docs/arquitectura/MCP de Mycelium - tesina,
//! protocolo.md` § 9); su
//! código quedó en la historia de `feat/mcp-desktop`.

use serde_json::Value;

use crate::protocolo::texto;
use crate::servidor::Estado;

/// Los nombres de las herramientas que este servidor atiende.
const NOMBRES: [&str; 0] = [];

/// Lo que se responde a `tools/list`.
pub fn definiciones() -> Vec<Value> {
    Vec::new()
}

/// Atiende un `tools/call`. `None` si la herramienta no existe (error de
/// JSON-RPC); los errores de una herramienta que sí existe van como texto
/// marcado `isError`, para que el agente los lea.
pub fn llamar(estado: &Estado, nombre: &str, _args: &Value) -> Option<Value> {
    if !NOMBRES.contains(&nombre) {
        return None;
    }
    // Sin vault no hay ventana a la que hablarle: toda herramienta lo dice
    // igual, con los vaults registrados.
    let _vault = match &estado.vault {
        Ok(v) => v,
        Err(msg) => return Some(texto(msg.clone(), true)),
    };
    None
}
