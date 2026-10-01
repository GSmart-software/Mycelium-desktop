//! Qué archivos del vault son notas, y de qué tipo.
//!
//! Vivía en `archivos.rs` de la app; se movió acá para que el walker del MCP
//! decida lo mismo que el de la app. Un tipo nuevo se agrega en este archivo y
//! en ningún otro del lado de Rust.

use std::path::Path;

/// Tipo de nota según la extensión (espeja `notas.tipo` del índice/esquema).
pub fn tipo_de(path: &Path) -> String {
    match path.extension().and_then(|e| e.to_str()) {
        Some(ext) if ext.eq_ignore_ascii_case("excalidraw") => "excalidraw".to_string(),
        // Bases (`FUN-L-03`) y canvas (`FUN-L-18`): las extensiones son las de
        // Obsidian, para que el vault siga siendo intercambiable.
        Some(ext) if ext.eq_ignore_ascii_case("base") => "base".to_string(),
        Some(ext) if ext.eq_ignore_ascii_case("canvas") => "canvas".to_string(),
        // Diagramas de draw.io (`FUN-L-20`): XML de mxGraph. La extensión es la
        // nativa de la herramienta, para que el archivo se abra en cualquier
        // draw.io de afuera.
        Some(ext) if ext.eq_ignore_ascii_case("drawio") => "drawio".to_string(),
        _ => "markdown".to_string(),
    }
}

/// Extensiones que se importan como notas del vault.
pub fn es_importable(path: &Path) -> bool {
    match path.extension().and_then(|e| e.to_str()) {
        Some(ext) => {
            let ext = ext.to_ascii_lowercase();
            ext == "md"
                || ext == "excalidraw"
                || ext == "base"
                || ext == "canvas"
                || ext == "drawio"
        }
        None => false,
    }
}

/// Título de una nota = nombre del archivo sin la extensión final. Espeja
/// `tituloDeRuta` de `lib/db/indexer.ts`.
pub fn titulo_de_ruta(ruta: &str) -> String {
    let nombre = ruta.rsplit('/').next().unwrap_or(ruta);
    match nombre.rfind('.') {
        // `/\.[^.]+$/`: hace falta al menos un carácter después del punto.
        Some(i) if i + 1 < nombre.len() => nombre[..i].to_string(),
        _ => nombre.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn titulo_sin_la_extension_final() {
        assert_eq!(titulo_de_ruta("docs/BACKLOG.md"), "BACKLOG");
        assert_eq!(titulo_de_ruta("MCP de Mycelium - plan.md"), "MCP de Mycelium - plan");
        assert_eq!(titulo_de_ruta("a/v1.2.0 notas.md"), "v1.2.0 notas");
        assert_eq!(titulo_de_ruta("sin-extension"), "sin-extension");
    }
}
