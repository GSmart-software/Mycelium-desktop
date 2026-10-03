//! El bucle del servidor y su estado.
//!
//! El servidor no guarda nada ni indexa nada (`mcp-control` § 2): resuelve su
//! vault una vez al arrancar y atiende un mensaje por línea. Si el vault no se
//! pudo resolver, el servidor **igual arranca** y contesta `initialize` y
//! `tools/list`: Claude Code no avisa cuando un servidor no levanta, y un
//! servidor caído deja a la IA sin saber por qué. Cada herramienta devuelve
//! entonces `VAULT_DESCONOCIDO` con los vaults registrados.

use std::io::{BufRead, Write};
use std::path::PathBuf;
use std::time::Duration;

use serde_json::{json, Value};

use crate::herramientas;
use crate::protocolo::{self, error, respuesta};
use crate::vault::{self, VaultResuelto};

pub struct Estado {
    pub vault: Result<VaultResuelto, String>,
    /// El canal con la ventana del vault (`mycelium-<hash>`, ver
    /// `mycelium_vault::canal::nombre_canal`). Vacío
    /// si el vault no se resolvió: nadie lo va a usar.
    pub canal: PathBuf,
    /// Plazo de lectura del canal; `None` = el del protocolo
    /// ([`crate::canal::ESPERA_CLIENTE`]). Los tests lo acortan.
    pub espera: Option<Duration>,
    /// Cuánto se espera a que el usuario conteste una confirmación y cada
    /// cuánto se consulta; `None` = los del protocolo
    /// (`ESPERA_CONFIRMACION`, `INTERVALO_CONFIRMACION`). Los tests los acortan.
    pub confirmacion: Option<(Duration, Duration)>,
}

impl Estado {
    /// El estado para un vault (o su error), con el canal ya calculado.
    pub fn nuevo(vault: Result<VaultResuelto, String>) -> Self {
        let canal = match (&vault, mycelium_vault::rutas::dir_app()) {
            (Ok(v), Some(dir)) => mycelium_vault::canal::nombre_canal(&v.registrado.ruta, &dir),
            _ => PathBuf::new(),
        };
        Estado { vault, canal, espera: None, confirmacion: None }
    }
}

pub fn correr(arg_vault: Option<String>) {
    let vault = vault::resolver(arg_vault);
    match &vault {
        Ok(v) => eprintln!(
            "mycelium-mcp {}: vault «{}» ({}, desde {})",
            crate::VERSION,
            v.registrado.nombre,
            v.registrado.ruta,
            v.origen
        ),
        Err(msg) => eprintln!("mycelium-mcp: {msg}"),
    }

    let mut estado = Estado::nuevo(vault);
    let stdin = std::io::stdin();
    let mut stdout = std::io::stdout();
    for linea in stdin.lock().lines() {
        let Ok(linea) = linea else { break };
        if linea.trim().is_empty() {
            continue;
        }
        let salidas = procesar(&mut estado, &linea);
        for s in salidas {
            // Un mensaje por línea: `to_string` no mete saltos de línea.
            if writeln!(stdout, "{s}").and_then(|_| stdout.flush()).is_err() {
                return;
            }
        }
    }
}

/// Procesa una línea (un mensaje o un lote) y devuelve las respuestas.
pub fn procesar(estado: &mut Estado, linea: &str) -> Vec<Value> {
    let msg: Value = match serde_json::from_str(linea) {
        Ok(v) => v,
        Err(e) => return vec![error(&Value::Null, protocolo::PARSE_ERROR, &format!("JSON inválido: {e}"))],
    };
    match msg {
        Value::Array(lote) => lote.iter().filter_map(|m| despachar(estado, m)).collect(),
        m => despachar(estado, &m).into_iter().collect(),
    }
}

fn despachar(estado: &mut Estado, msg: &Value) -> Option<Value> {
    let id = msg.get("id").cloned();
    let Some(metodo) = msg.get("method").and_then(Value::as_str) else {
        // Una respuesta del cliente (no pedimos nada) o basura: se ignora si no
        // tiene id; si lo tiene, es una petición inválida.
        return id.map(|id| error(&id, protocolo::INVALID_REQUEST, "falta `method`"));
    };
    // Sin `id` es una notificación: no se responde.
    let id = id?;
    let params = msg.get("params").cloned().unwrap_or(Value::Null);

    Some(match metodo {
        "initialize" => {
            let pedida = params.get("protocolVersion").and_then(Value::as_str);
            respuesta(
                &id,
                json!({
                    "protocolVersion": protocolo::negociar(pedida),
                    "capabilities": { "tools": { "listChanged": false } },
                    "serverInfo": { "name": "mycelium", "title": "Mycelium · control de la app", "version": crate::VERSION },
                    "instructions": instrucciones(estado),
                }),
            )
        }
        "ping" => respuesta(&id, json!({})),
        "tools/list" => respuesta(&id, json!({ "tools": herramientas::definiciones() })),
        "tools/call" => {
            let Some(nombre) = params.get("name").and_then(Value::as_str) else {
                return Some(error(&id, protocolo::INVALID_PARAMS, "falta `name`"));
            };
            let args = params.get("arguments").cloned().unwrap_or_else(|| json!({}));
            match herramientas::llamar(estado, nombre, &args) {
                Some(r) => respuesta(&id, r),
                None => error(&id, protocolo::INVALID_PARAMS, &format!("herramienta desconocida: {nombre}")),
            }
        }
        otro => error(&id, protocolo::METHOD_NOT_FOUND, &format!("método no soportado: {otro}")),
    })
}

/// Las instrucciones de `initialize`: sobre qué vault opera, o por qué no.
pub fn instrucciones(estado: &Estado) -> String {
    match &estado.vault {
        Ok(v) => format!(
            "Control de Mycelium sobre el vault «{}» ({}). El contenido de las notas se lee y se \
             escribe en los archivos, como siempre; estas herramientas operan la app.",
            v.registrado.nombre, v.registrado.ruta
        ),
        Err(msg) => format!("Control de Mycelium sin vault: {msg}"),
    }
}

#[cfg(test)]
mod tests;
