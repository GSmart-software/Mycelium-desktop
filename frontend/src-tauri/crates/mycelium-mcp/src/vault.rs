//! Qué vault sirve este proceso (plan del MCP § 7.3).
//!
//! 1. La ruta candidata sale de `MYCELIUM_VAULT`, si no de `--vault`, si no del
//!    directorio actual — la primera que exista decide, sin caer a la siguiente:
//!    si alguien pasó un vault explícito y no está registrado, servir otro en
//!    silencio sería peor que decirlo.
//! 2. Se resuelve **contra `vaults.json`** con `misma_ruta` (subiendo por los
//!    ancestros, para poder lanzar el MCP desde una subcarpeta).
//! 3. Desde ahí se usa **la cadena registrada tal cual** para nombrar el índice:
//!    la misma carpeta escrita de otra forma deriva el mismo nombre.

use std::path::{Path, PathBuf};

use mycelium_vault::registro::{self, VaultRef};
use mycelium_vault::rutas;

/// El vault resuelto y los archivos que le tocan.
#[derive(Debug, Clone)]
pub struct VaultResuelto {
    /// La entrada de `vaults.json` (la cadena registrada, tal cual).
    pub registrado: VaultRef,
    /// La carpeta del vault.
    pub raiz: PathBuf,
    /// Dónde va el índice propio (`mcp-<hash>.db` en el app-data).
    pub db: PathBuf,
    /// De dónde salió la ruta candidata.
    pub origen: &'static str,
}

/// Resuelve el vault, o devuelve el mensaje de `VAULT_DESCONOCIDO`.
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
    Ok(VaultResuelto {
        db: dir_app.join(rutas::nombre_indice_mcp(&entrada.ruta)),
        registrado: entrada.clone(),
        raiz,
        origen,
    })
}

/// Dónde reintentar si el app-data no se puede escribir (§ 2 de la nota).
pub fn db_de_respaldo(v: &VaultResuelto) -> PathBuf {
    std::env::temp_dir().join("mycelium").join(rutas::nombre_indice_mcp(&v.registrado.ruta))
}

/// El registro de búsquedas va al lado del índice que se esté usando.
pub fn bitacora_para(db: &Path) -> PathBuf {
    let nombre = db.file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_else(|| "mcp".into());
    db.with_file_name(format!("{nombre}-busquedas.jsonl"))
}
