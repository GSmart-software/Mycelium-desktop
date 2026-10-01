//! Qué vault sirve este proceso (`mcp-control` § 2).
//!
//! 1. La ruta candidata sale de `MYCELIUM_VAULT`, si no de `--vault`, si no del
//!    directorio actual — la primera que exista decide, sin caer a la siguiente:
//!    si alguien pasó un vault explícito y no está registrado, servir otro en
//!    silencio sería peor que decirlo.
//! 2. Se resuelve **contra `vaults.json`** con `misma_ruta` (subiendo por los
//!    ancestros, para poder lanzar el MCP desde una subcarpeta).
//! 3. Desde ahí se usa **la cadena registrada tal cual**: es la que hashea la
//!    app para nombrar lo de ese vault (el canal de control, desde la Parte 1),
//!    así que la misma carpeta escrita de otra forma llega al mismo nombre.

use std::path::PathBuf;

use mycelium_vault::registro::{self, Registro, VaultRef};
use mycelium_vault::rutas;

/// El vault resuelto.
#[derive(Debug, Clone)]
pub struct VaultResuelto {
    /// La entrada de `vaults.json` (la cadena registrada, tal cual).
    pub registrado: VaultRef,
    /// La carpeta del vault.
    pub raiz: PathBuf,
    /// De dónde salió la ruta candidata.
    pub origen: &'static str,
}

/// Resuelve el vault desde el entorno, o devuelve el mensaje de
/// `VAULT_DESCONOCIDO`.
pub fn resolver(arg_vault: Option<String>) -> Result<VaultResuelto, String> {
    let dir_app = rutas::dir_app().ok_or_else(|| {
        "VAULT_DESCONOCIDO: no se pudo ubicar la carpeta de configuración de Mycelium \
         (APPDATA/HOME sin definir)."
            .to_string()
    })?;
    let reg = registro::leer_registro(&dir_app.join(registro::ARCHIVO));

    let (candidata, origen) = if let Some(v) = std::env::var_os("MYCELIUM_VAULT").filter(|v| !v.is_empty()) {
        (PathBuf::from(v), "MYCELIUM_VAULT")
    } else if let Some(v) = arg_vault {
        (PathBuf::from(v), "--vault")
    } else {
        (std::env::current_dir().map_err(|e| format!("VAULT_DESCONOCIDO: sin directorio actual: {e}"))?, "cwd")
    };
    resolver_en(&reg, candidata, origen)
}

/// La resolución propiamente dicha, sin tocar el entorno (testeable).
pub fn resolver_en(reg: &Registro, candidata: PathBuf, origen: &'static str) -> Result<VaultResuelto, String> {
    let Some(entrada) = reg.vault_que_contiene(&candidata) else {
        let registrados: Vec<String> = reg.vaults.iter().map(|v| format!("  - {} ({})", v.nombre, v.ruta)).collect();
        return Err(format!(
            "VAULT_DESCONOCIDO: la carpeta {} (de {origen}) no pertenece a ningún vault registrado en \
             Mycelium. El MCP sirve vaults de Mycelium, no carpetas sueltas: abrila una vez en la app \
             para registrarla, o apuntá MYCELIUM_VAULT / --vault a uno de estos:\n{}",
            candidata.display(),
            if registrados.is_empty() { "  (no hay ninguno registrado)".to_string() } else { registrados.join("\n") }
        ));
    };
    let raiz = PathBuf::from(&entrada.ruta);
    if !raiz.is_dir() {
        return Err(format!(
            "VAULT_DESCONOCIDO: el vault «{}» está registrado en {} pero esa carpeta no existe.",
            entrada.nombre, entrada.ruta
        ));
    }
    Ok(VaultResuelto { registrado: entrada.clone(), raiz, origen })
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Un vault real en el temporal y un registro que lo contiene.
    fn con_vault(nombre: &str) -> (Registro, PathBuf) {
        let raiz = std::env::temp_dir().join(format!("mycelium-mcp-vault-{nombre}-{}", std::process::id()));
        std::fs::create_dir_all(raiz.join("docs")).unwrap();
        let reg = Registro {
            vaults: vec![VaultRef { ruta: raiz.to_string_lossy().to_string(), nombre: "Prueba".into(), ultimo_acceso: None }],
            abrir_ultimo: false,
        };
        (reg, raiz)
    }

    #[test]
    fn resuelve_desde_una_subcarpeta_a_la_cadena_registrada() {
        let (reg, raiz) = con_vault("sub");
        let v = resolver_en(&reg, raiz.join("docs"), "cwd").unwrap();
        assert_eq!(v.registrado.ruta, reg.vaults[0].ruta);
        assert_eq!(v.raiz, raiz);
        assert_eq!(v.origen, "cwd");
        let _ = std::fs::remove_dir_all(raiz);
    }

    #[test]
    fn una_carpeta_suelta_es_vault_desconocido_con_los_registrados() {
        let (reg, raiz) = con_vault("suelta");
        let err = resolver_en(&reg, std::env::temp_dir().join("otra-cosa"), "MYCELIUM_VAULT").unwrap_err();
        assert!(err.starts_with("VAULT_DESCONOCIDO"), "{err}");
        assert!(err.contains("de MYCELIUM_VAULT"), "{err}");
        assert!(err.contains(&format!("  - Prueba ({})", reg.vaults[0].ruta)), "{err}");
        let _ = std::fs::remove_dir_all(raiz);
    }

    #[test]
    fn sin_vaults_registrados_lo_dice() {
        let err = resolver_en(&Registro::default(), PathBuf::from("C:/Notas"), "cwd").unwrap_err();
        assert!(err.contains("(no hay ninguno registrado)"), "{err}");
    }

    #[test]
    fn un_vault_registrado_que_ya_no_existe_lo_dice() {
        let (reg, raiz) = con_vault("borrado");
        let _ = std::fs::remove_dir_all(&raiz);
        let err = resolver_en(&reg, raiz.clone(), "--vault").unwrap_err();
        assert!(err.starts_with("VAULT_DESCONOCIDO") && err.contains("esa carpeta no existe"), "{err}");
    }
}
