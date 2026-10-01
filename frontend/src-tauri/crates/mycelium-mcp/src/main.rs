//! `mycelium-mcp`: el servidor MCP de **memoria** de Mycelium (`FUN-L-09`,
//! fase 1).
//!
//! Dos herramientas de solo lectura sobre un índice propio —`vault_buscar` y
//! `vault_leer`—, por stdio. Es un binario **delgado**: todo lo que decide qué
//! es un vault, una nota, un enlace o una sección vive en `mycelium-vault`.
//!
//! ```text
//! mycelium-mcp [--vault <ruta>]      servidor MCP por stdio
//! mycelium-mcp volcar <carpeta>      JSON con lo que el parser ve (prueba de equivalencia)
//! mycelium-mcp --version
//! ```
//!
//! El vault se resuelve, en este orden, desde `MYCELIUM_VAULT`, `--vault` o el
//! directorio actual, **siempre contra una entrada de `vaults.json`** (plan del
//! MCP § 7.3): el MCP sirve vaults de Mycelium, no carpetas sueltas.

mod bitacora;
mod herramientas;
mod protocolo;
mod servidor;
mod vault;
mod volcar;

use std::io::Write;

pub const VERSION: &str = env!("CARGO_PKG_VERSION");

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    match args.first().map(String::as_str) {
        Some("--version") | Some("-V") => {
            println!("mycelium-mcp {VERSION}");
        }
        Some("--help") | Some("-h") => {
            println!(
                "mycelium-mcp {VERSION}: servidor MCP de memoria de Mycelium (stdio)\n\n\
                 Uso:\n  mycelium-mcp [--vault <ruta>]\n  mycelium-mcp volcar <carpeta>\n\n\
                 El vault sale de MYCELIUM_VAULT, --vault o el directorio actual, y tiene que\n\
                 estar registrado en Mycelium (vaults.json)."
            );
        }
        Some("volcar") => {
            let Some(carpeta) = args.get(1) else {
                eprintln!("uso: mycelium-mcp volcar <carpeta>");
                std::process::exit(2);
            };
            match volcar::volcar(std::path::Path::new(carpeta)) {
                Ok(json) => {
                    let mut out = std::io::stdout().lock();
                    let _ = out.write_all(json.as_bytes());
                    let _ = out.write_all(b"\n");
                }
                Err(err) => {
                    eprintln!("{err}");
                    std::process::exit(1);
                }
            }
        }
        _ => {
            let arg_vault = args.iter().position(|a| a == "--vault").and_then(|i| args.get(i + 1).cloned());
            servidor::correr(arg_vault);
        }
    }
}
