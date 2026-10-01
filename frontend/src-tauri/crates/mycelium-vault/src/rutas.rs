//! Qué es «el mismo vault» (plan del MCP § 7.3).
//!
//! Hay dos preguntas distintas y cada una tiene su función:
//!
//! | Pregunta | Función | Qué hace con la cadena |
//! |---|---|---|
//! | ¿Son la misma carpeta? | [`misma_ruta`] | **Normaliza**: barras, barra final, mayúsculas |
//! | ¿Cómo se llama su índice? | [`hash_ruta`] | **Nada**: hashea la cadena tal cual |
//!
//! Para derivar nombres (el índice de la app, el del MCP) se usa **la cadena
//! registrada en `vaults.json`**, sin normalizar: cambiar lo que se hashea
//! dejaría huérfanos todos los índices existentes. Por eso quien tiene una ruta
//! escrita de otra forma primero la resuelve contra el registro con
//! [`misma_ruta`] y recién después hashea la entrada que encontró.

use std::path::PathBuf;

use sha2::{Digest, Sha256};

/// Identificador de la app en Tauri (`tauri.conf.json`): nombra su carpeta de
/// configuración, que es donde viven `vaults.json` y los índices.
pub const IDENTIFICADOR_APP: &str = "com.mycelium.desktop";

/// Forma de una ruta **para comparar**, nunca para guardar ni para hashear:
/// barras unificadas, sin barra final y en minúsculas.
///
/// > [!warning] Las minúsculas son correctas en Windows y macOS, no en Linux
/// > El plan (§ 7.3) decide ignorarlas solo donde el sistema de archivos no las
/// > distingue. Este crate conserva por ahora el comportamiento que tenía la app
/// > (`ventanas.rs`), que las ignora siempre: la corrección para Linux es un
/// > cambio de comportamiento y va aparte.
pub fn normalizar_para_comparar(ruta: &str) -> String {
    ruta.replace('\\', "/").trim_end_matches('/').to_lowercase()
}

/// Comparación de rutas tolerante a mayúsculas y a las barras de Windows: la
/// misma carpeta escrita de dos formas sigue siendo la misma carpeta.
///
/// Vivía en `ventanas.rs` (`FUN-L-16`), donde decide si un vault ya está abierto
/// en otra ventana. Se movió acá para que el MCP resuelva su vault con **la
/// misma** respuesta.
pub fn misma_ruta(a: &str, b: &str) -> bool {
    normalizar_para_comparar(a) == normalizar_para_comparar(b)
}

/// Hash corto y estable de la ruta de un vault: los primeros 8 bytes del
/// SHA-256 de la cadena (UTF-8), en hexadecimal (16 caracteres).
///
/// **Tiene que dar exactamente lo mismo que `hashRuta` de
/// `frontend/lib/db/client.ts`**, que nombra el índice de la app. Hay un test
/// con valores calculados por esa función.
pub fn hash_ruta(ruta: &str) -> String {
    let digest = Sha256::digest(ruta.as_bytes());
    digest[..8].iter().map(|b| format!("{b:02x}")).collect()
}

/// Nombre del índice de la app para ese vault (`index-<hash>.db`). Solo
/// informativo: el MCP **nunca** abre ese archivo.
pub fn nombre_indice_app(ruta_registrada: &str) -> String {
    format!("index-{}.db", hash_ruta(ruta_registrada))
}

/// Nombre del índice propio del MCP para ese vault (`mcp-<hash>.db`).
pub fn nombre_indice_mcp(ruta_registrada: &str) -> String {
    format!("mcp-{}.db", hash_ruta(ruta_registrada))
}

/// La carpeta de configuración de la app, la misma que resuelve Tauri con
/// `app_config_dir()` (ahí están `vaults.json` y los `index-<hash>.db`, porque
/// `tauri-plugin-sql` resuelve las bases contra ese directorio).
///
/// `MYCELIUM_DIR_APP` la reemplaza: sirve para los tests y para apuntar a otra
/// instalación sin tocar la real.
pub fn dir_app() -> Option<PathBuf> {
    if let Some(dir) = std::env::var_os("MYCELIUM_DIR_APP") {
        return Some(PathBuf::from(dir));
    }
    dir_config_del_sistema().map(|d| d.join(IDENTIFICADOR_APP))
}

/// El `config_dir` del sistema, con las mismas reglas que el crate `dirs` que
/// usa Tauri.
fn dir_config_del_sistema() -> Option<PathBuf> {
    let var = |k: &str| std::env::var_os(k).filter(|v| !v.is_empty()).map(PathBuf::from);
    if cfg!(windows) {
        var("APPDATA")
    } else if cfg!(target_os = "macos") {
        var("HOME").map(|h| h.join("Library/Application Support"))
    } else {
        var("XDG_CONFIG_HOME").or_else(|| var("HOME").map(|h| h.join(".config")))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn misma_ruta_tolera_barras_y_mayusculas() {
        assert!(misma_ruta("C:\\Notas\\Vault", "c:/notas/vault"));
        assert!(misma_ruta("/home/x/vault/", "/home/x/vault"));
        assert!(!misma_ruta("C:/notas/a", "C:/notas/b"));
    }

    /// Los valores de la derecha los calculó **la función `hashRuta` de la app**
    /// (extraída de `lib/db/client.ts` y ejecutada en Node) el 2026-09-24, y
    /// coinciden con los `index-<hash>.db` que la app ya había creado en el
    /// app-data de la máquina de desarrollo para esos cinco vaults. Incluye una
    /// ruta con tilde para fijar que se hashean los bytes UTF-8.
    #[test]
    fn hash_ruta_es_el_de_la_app() {
        let casos = [
            ("C:\\Trabajo\\Trabajo y Estudio", "8a3bd2f8da7b086c"),
            ("C:\\Users\\gabip\\Videos\\Contenido Visto", "db699e99e2a28540"),
            ("C:\\Trabajo\\GSmart\\Mycelium", "a6180dffa8ec68ba"),
            (
                "C:\\Users\\gabip\\OneDrive\\Desktop\\Universidad, Cursos y Educación\\Universidad\\Tesina",
                "6d721bd90b44a3c1",
            ),
            ("C:\\Trabajo\\GSmart\\Arrecife\\Proyecto Arrecife", "1affd3f4cd4e10a0"),
        ];
        for (ruta, esperado) in casos {
            assert_eq!(hash_ruta(ruta), esperado, "hash de {ruta}");
        }
    }

    /// La razón de que el nombre se derive de la cadena REGISTRADA: la misma
    /// carpeta escrita distinto da otro hash (valores también de `hashRuta`).
    #[test]
    fn otra_escritura_da_otro_hash() {
        assert_eq!(hash_ruta("c:/trabajo/gsmart/mycelium"), "5c46c1a55c9d504f");
        assert_eq!(hash_ruta("C:\\Trabajo\\GSmart\\Mycelium\\"), "d822099036f4851d");
        assert!(misma_ruta("c:/trabajo/gsmart/mycelium", "C:\\Trabajo\\GSmart\\Mycelium\\"));
    }

    #[test]
    fn nombres_de_indice() {
        assert_eq!(nombre_indice_app("C:\\Trabajo\\GSmart\\Mycelium"), "index-a6180dffa8ec68ba.db");
        assert_eq!(nombre_indice_mcp("C:\\Trabajo\\GSmart\\Mycelium"), "mcp-a6180dffa8ec68ba.db");
    }
}
