//! El registro de búsquedas (plan del MCP § 4.3): una línea JSON por
//! `vault_buscar`, con la lista **ordenada** de candidatos y sus cinco señales.
//!
//! Es lo que habilita calibrar los pesos *offline* —una regresión sobre
//! consultas ya ejecutadas, sin volver a correr la recuperación— y medir
//! recall@k contra las claves del arnés. **Local**: vive al lado del índice,
//! en el app-data, y no sale de la máquina. Sin telemetría.

use std::io::Write;
use std::path::Path;

use mycelium_vault::indice::buscar::{self, Busqueda, Consulta, PESOS_V1};
use serde_json::json;

/// Pasado este tamaño se rota a `.1` (se conserva una generación).
const TOPE_BYTES: u64 = 20 * 1024 * 1024;

pub fn registrar(ruta: &Path, vault: &str, c: &Consulta, b: &Busqueda, ms: u128) {
    let linea = json!({
        "ts": mycelium_ahora_ms(),
        "vault": vault,
        "consulta": c.texto,
        "expresion": b.expresion,
        "filtros": {
            "propiedades": c.filtros.propiedades,
            "tags": c.filtros.tags,
            "carpeta": c.filtros.carpeta,
            "tipo": c.filtros.tipo,
        },
        "cerca_de": b.cerca_de,
        "ambito": match c.ambito { buscar::Ambito::Secciones => "secciones", buscar::Ambito::Notas => "notas" },
        "limite": c.limite,
        "modo": b.modo,
        "total": b.total,
        "ms": ms,
        "pesos": PESOS_V1,
        "pesos_columnas": [buscar::PESO_TITULO, buscar::PESO_ENCABEZADOS, buscar::PESO_CUERPO],
        "exponente_cobertura": buscar::EXPONENTE_COBERTURA,
        "sin_coincidencias": b.sin_coincidencias,
        "completos": b.completos,
        "resultados": b.resultados.iter().enumerate().map(|(i, r)| json!({
            "pos": i + 1,
            "ref": r.referencia(),
            "bm25": r.bm25,
            "cobertura": r.cobertura,
            "cubiertos": r.cubiertos,
            "senales": r.senales,
            "puntaje": r.puntaje,
        })).collect::<Vec<_>>(),
    });
    // Best-effort: un registro que no se puede escribir no le cuesta la
    // respuesta al agente.
    let _ = escribir(ruta, &linea.to_string());
}

fn escribir(ruta: &Path, linea: &str) -> std::io::Result<()> {
    if let Some(padre) = ruta.parent() {
        std::fs::create_dir_all(padre)?;
    }
    if std::fs::metadata(ruta).map(|m| m.len() > TOPE_BYTES).unwrap_or(false) {
        let _ = std::fs::rename(ruta, ruta.with_extension("jsonl.1"));
    }
    let mut f = std::fs::OpenOptions::new().create(true).append(true).open(ruta)?;
    writeln!(f, "{linea}")
}

fn mycelium_ahora_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}
