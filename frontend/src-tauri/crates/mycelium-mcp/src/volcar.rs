//! `mycelium-mcp volcar <carpeta>`: lo que los parsers de Rust ven en cada
//! archivo, en JSON. Lo consume `frontend/scripts/equivalencia-indice.mjs`,
//! que calcula lo mismo con el código TypeScript de la app y compara (plan del
//! MCP § 3: mientras convivan dos implementaciones, tiene que haber una prueba
//! de que dicen lo mismo).
//!
//! Para comparar manzanas con manzanas, cada enlace va con la **clave de la
//! app** (`destinoDeWikilink(inner).toLowerCase()`), y aparte los que este
//! extractor descarta por estar en código: esas diferencias son intencionales
//! y la prueba las tiene que poder listar, no esconder.

use std::path::Path;

use mycelium_vault::{frontmatter, markdown, recorrido, tipos, wikilinks};
use serde_json::{json, Value};

pub fn volcar(carpeta: &Path) -> Result<String, String> {
    let archivos = recorrido::notas_del_vault(carpeta)?;
    let mut out: Vec<Value> = Vec::new();
    for a in archivos {
        let bytes = std::fs::read(carpeta.join(&a.ruta_relativa)).map_err(|e| format!("{}: {e}", a.ruta_relativa))?;
        let texto = String::from_utf8_lossy(&bytes);
        if a.tipo != "markdown" {
            out.push(json!({ "ruta": a.ruta_relativa, "tipo": a.tipo }));
            continue;
        }
        let titulo = tipos::titulo_de_ruta(&a.ruta_relativa);
        let fm = frontmatter::separar_frontmatter(&texto);
        let clave_app = |bruto: &str| wikilinks::destino_de_wikilink(bruto).to_lowercase();
        let enlaces: Vec<Value> = markdown::extraer_enlaces(&texto)
            .iter()
            .map(|e| json!({ "clave": clave_app(&e.bruto), "norm": e.destino_norm, "linea": e.linea }))
            .collect();
        let en_codigo: Vec<Value> = markdown::enlaces_en_codigo(&texto)
            .iter()
            .map(|e| json!({ "clave": clave_app(&e.bruto), "linea": e.linea }))
            .collect();
        let estado_fm = match &fm {
            frontmatter::Frontmatter::No => "no",
            frontmatter::Frontmatter::Soportado { .. } => "soportado",
            frontmatter::Frontmatter::NoSoportado { .. } => "no_soportado",
        };
        let props: Vec<Value> = frontmatter::filas_indexables(&fm)
            .into_iter()
            .map(|(c, v, t, o)| json!([c, v, t, o]))
            .collect();
        let secs = markdown::secciones(&titulo, &texto, &fm);
        out.push(json!({
            "ruta": a.ruta_relativa,
            "tipo": a.tipo,
            "frontmatter": estado_fm,
            "propiedades": props,
            "enlaces": enlaces,
            "enlaces_en_codigo": en_codigo,
            "tags": markdown::etiquetas(&texto, &fm).into_iter().map(|(t, _)| t).collect::<Vec<_>>(),
            "tags_en_codigo": markdown::etiquetas_en_codigo(&texto, &fm),
            "secciones": secs.len(),
            "secciones_parciales": secs.iter().filter(|s| s.parcial).count(),
            "seccion_max_bytes": secs.iter().map(|s| s.bytes).max().unwrap_or(0),
        }));
    }
    serde_json::to_string(&json!({ "archivos": out })).map_err(|e| e.to_string())
}
