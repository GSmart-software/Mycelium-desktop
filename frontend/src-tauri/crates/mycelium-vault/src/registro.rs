//! El registro de vaults vinculados: `vaults.json`, en la carpeta de
//! configuración de la app.
//!
//! **La identidad de un vault es su entrada en este archivo** (plan del MCP
//! § 7.3). La app lo escribe (`vault_config.rs`); el servidor MCP solo lo lee,
//! para saber a qué vault pertenece la carpeta desde la que lo lanzaron. El
//! formato vive acá para que los dos lo lean con el mismo tipo.

use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::rutas::misma_ruta;

/// Nombre del archivo del registro dentro de la carpeta de configuración.
pub const ARCHIVO: &str = "vaults.json";

/// Un vault vinculado. `ultimoAcceso` en milisegundos epoch (o `null`).
#[derive(Serialize, Deserialize, Clone, PartialEq, Debug)]
#[serde(rename_all = "camelCase")]
pub struct VaultRef {
    pub ruta: String,
    pub nombre: String,
    #[serde(default)]
    pub ultimo_acceso: Option<i64>,
}

/// Contenido del registro en disco.
#[derive(Serialize, Deserialize, Default, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Registro {
    #[serde(default)]
    pub vaults: Vec<VaultRef>,
    /// Si es `true`, al arrancar se reabre automáticamente el ÚLTIMO vault usado
    /// (el de `ultimoAcceso` más reciente), sea cual sea. Ajuste global, no por
    /// vault. (El antiguo campo `autoAbrir` se ignora si aparece en configs viejas.)
    #[serde(default)]
    pub abrir_ultimo: bool,
}

/// Lee el registro (archivo ausente o corrupto → registro vacío). Pura, testeable.
pub fn leer_registro(config: &Path) -> Registro {
    std::fs::read_to_string(config)
        .ok()
        .and_then(|t| serde_json::from_str(&t).ok())
        .unwrap_or_default()
}

impl Registro {
    /// La entrada registrada para exactamente esa carpeta, comparando con la
    /// normalización de [`misma_ruta`].
    pub fn entrada(&self, ruta: &str) -> Option<&VaultRef> {
        self.vaults.iter().find(|v| misma_ruta(&v.ruta, ruta))
    }

    /// La entrada del vault que **contiene** a `ruta`: ella misma o la carpeta
    /// registrada más cercana subiendo por sus ancestros. Es lo que permite
    /// lanzar el MCP desde una subcarpeta del vault.
    pub fn vault_que_contiene(&self, ruta: &Path) -> Option<&VaultRef> {
        ruta.ancestors().find_map(|a| self.entrada(&a.to_string_lossy()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn registro() -> Registro {
        serde_json::from_str(
            r#"{"vaults":[
                {"ruta":"C:\\Trabajo\\GSmart\\Mycelium","nombre":"Mycelium","ultimoAcceso":1},
                {"ruta":"C:\\Notas","nombre":"Notas"}
            ],"abrirUltimo":false}"#,
        )
        .unwrap()
    }

    #[test]
    fn resuelve_otra_escritura_a_la_cadena_registrada() {
        let reg = registro();
        let v = reg.entrada("c:/trabajo/gsmart/mycelium/").unwrap();
        assert_eq!(v.ruta, "C:\\Trabajo\\GSmart\\Mycelium");
        assert!(reg.entrada("C:/Trabajo/GSmart").is_none());
    }

    #[test]
    fn sube_desde_una_subcarpeta() {
        let reg = registro();
        // Barras normales: son separador en todos los sistemas, así el test no
        // depende de correr en Windows.
        let dentro = Path::new("C:/Trabajo/GSmart/Mycelium/docs/arquitectura");
        assert_eq!(reg.vault_que_contiene(dentro).unwrap().nombre, "Mycelium");
        assert!(reg.vault_que_contiene(Path::new("C:/Otra/cosa")).is_none());
    }

    #[test]
    fn archivo_ausente_es_registro_vacio() {
        let reg = leer_registro(Path::new("no/existe/vaults.json"));
        assert!(reg.vaults.is_empty());
    }
}
