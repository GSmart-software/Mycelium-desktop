//! `mycelium-mcp`: el servidor MCP de **control** de Mycelium (`FUN-L-09`,
//! ver `docs/features/mcp-control.md`).
//!
//! Deja a la IA del vault operar la app en lo que no puede hacer escribiendo
//! archivos: mostrar algo, renombrar sin romper enlaces, el calendario, el
//! diccionario. Habla MCP por stdio y, desde la Parte 1, le habla a la ventana
//! de su vault por un *named pipe*. No guarda estado ni indexa nada.
//!
//! ```text
//! mycelium-mcp [--vault <ruta>]      servidor MCP por stdio
//! mycelium-mcp --version
//! ```
//!
//! El vault se resuelve, en este orden, desde `MYCELIUM_VAULT`, `--vault` o el
//! directorio actual, **siempre contra una entrada de `vaults.json`**: el MCP
//! sirve vaults de Mycelium, no carpetas sueltas.

mod canal;
mod herramientas;
mod protocolo;
mod servidor;
mod vault;

pub const VERSION: &str = env!("CARGO_PKG_VERSION");

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    match args.first().map(String::as_str) {
        Some("--version") | Some("-V") => {
            println!("mycelium-mcp {VERSION}");
        }
        Some("--help") | Some("-h") => {
            println!(
                "mycelium-mcp {VERSION}: servidor MCP de control de Mycelium (stdio)\n\n\
                 Uso:\n  mycelium-mcp [--vault <ruta>]\n\n\
                 El vault sale de MYCELIUM_VAULT, --vault o el directorio actual, y tiene que\n\
                 estar registrado en Mycelium (vaults.json)."
            );
        }
        _ => {
            let arg_vault = args.iter().position(|a| a == "--vault").and_then(|i| args.get(i + 1).cloned());
            servidor::correr(arg_vault);
        }
    }
}
