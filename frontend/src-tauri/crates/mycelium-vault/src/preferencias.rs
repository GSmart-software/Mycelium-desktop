//! Lo que el servidor MCP necesita saber de `.mycelium/preferencias.json`: si
//! el **control** está encendido en ese vault (`FUN-L-09`, spec § 2.2).
//!
//! El archivo lo escribe la app (`stores/prefsVaultStore.ts`) y es opaco para
//! Rust; acá solo se lee una clave. Sirve para que, sin nadie escuchando en el
//! canal, el servidor distinga «la app está cerrada» (`APP_CERRADA`) de «el
//! control está apagado» (`MCP_DESACTIVADO`).

use std::path::Path;

/// La clave de la preferencia, la misma que `PrefsVault.controlIa`.
pub const CLAVE_CONTROL: &str = "controlIa";

/// ¿El control está encendido en el vault de `raiz`? Archivo ausente, ilegible
/// o sin la clave → `false`: el control es opt-in (apagado por defecto).
pub fn control_encendido(raiz: &Path) -> bool {
    std::fs::read_to_string(raiz.join(".mycelium").join("preferencias.json"))
        .ok()
        .and_then(|t| serde_json::from_str::<serde_json::Value>(&t).ok())
        .and_then(|v| v.get(CLAVE_CONTROL).and_then(serde_json::Value::as_bool))
        .unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn vault(nombre: &str, prefs: Option<&str>) -> std::path::PathBuf {
        let raiz = std::env::temp_dir().join(format!("mycelium-vault-prefs-{nombre}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&raiz);
        std::fs::create_dir_all(raiz.join(".mycelium")).unwrap();
        if let Some(p) = prefs {
            std::fs::write(raiz.join(".mycelium/preferencias.json"), p).unwrap();
        }
        raiz
    }

    #[test]
    fn apagado_por_defecto() {
        let r = vault("sin", None);
        assert!(!control_encendido(&r));
        let r2 = vault("otra-clave", Some(r#"{"numerosDeLinea":true}"#));
        assert!(!control_encendido(&r2));
        let r3 = vault("corrupto", Some("{no es json"));
        assert!(!control_encendido(&r3));
        for r in [r, r2, r3] {
            let _ = std::fs::remove_dir_all(r);
        }
    }

    #[test]
    fn encendido_si_la_clave_es_true() {
        let r = vault("on", Some(r#"{"controlIa":true}"#));
        assert!(control_encendido(&r));
        let r2 = vault("texto", Some(r#"{"controlIa":"true"}"#));
        assert!(!control_encendido(&r2), "solo un booleano de verdad");
        for r in [r, r2] {
            let _ = std::fs::remove_dir_all(r);
        }
    }
}
