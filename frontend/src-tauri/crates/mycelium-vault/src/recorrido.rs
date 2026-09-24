//! El walker del vault: qué archivos hay, con su `mtime`, respetando el
//! `.mycignore`.
//!
//! Vivía en `archivos.rs` de la app (`listar_archivos_meta`, FUN-M-12). Se movió
//! acá tal cual para que el MCP recorra el vault con **el mismo** código: un
//! segundo walker aplicaría el `.mycignore` distinto en cuanto alguien tocara uno
//! solo.

use std::path::Path;

use crate::mycignore::{self, Patron};

/// Archivo del vault con los metadatos que el índice derivado necesita para la
/// validación incremental por `mtime` (fase 2 del "vault en carpeta").
///
/// **Sin `contenido` a propósito** (FUN-M-12): el indexador compara `mtime` y
/// recién entonces pide el texto de lo que cambió, con `leer_archivos`. Antes
/// esta estructura llevaba el contenido de TODOS los archivos y se descartaba
/// casi entero en cada apertura (14 MB por IPC en un vault sobre un repo).
#[derive(serde::Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ArchivoMeta {
    pub ruta_relativa: String,
    /// Fecha de modificación en milisegundos epoch (de `metadata().modified()`).
    pub mtime: i64,
    /// `"excalidraw"` para `.excalidraw`, `"base"` para `.base`, `"canvas"` para
    /// `.canvas`, `"drawio"` para `.drawio`, `"markdown"` para el resto.
    pub tipo: String,
}

/// `mtime` en milisegundos epoch (0 si el SO no lo expone).
pub fn mtime_ms(metadata: &std::fs::Metadata) -> i64 {
    metadata
        .modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// Ruta relativa POSIX de `ruta` respecto de `base`.
pub fn rel_posix(base: &Path, ruta: &Path) -> Result<String, String> {
    Ok(ruta
        .strip_prefix(base)
        .map_err(|_| format!("Ruta inesperada: {}", ruta.display()))?
        .components()
        .map(|c| c.as_os_str().to_string_lossy().to_string())
        .collect::<Vec<_>>()
        .join("/"))
}

/// Recorre `dir` recursivamente acumulando los archivos importables con sus
/// metadatos (`mtime`, `tipo`). Gemelo de `recorrer`, pero para el índice.
/// El filtrado lo deciden los patrones del `.mycignore` del vault (FUN-M-11);
/// `.mycelium` queda excluido siempre.
///
/// **No lee el contenido** (FUN-M-12): eso lo hace `leer_archivos`, y solo para
/// las rutas que el indexador decidió reindexar comparando `mtime`.
///
/// Micro-optimizaciones del walker (FUN-M-12): se usa `entrada.file_type()` en
/// vez de `ruta.is_dir()` —el tipo ya viene en la entrada del directorio, así que
/// se ahorra un `stat` por archivo, notorio en Windows— y `rel_posix` se calcula
/// UNA vez por entrada en lugar de dos. Contrapartida asumida: `file_type()` no
/// sigue enlaces simbólicos, así que un symlink a una carpeta ya no se recorre
/// (antes sí). Es lo deseable: evita ciclos y duplicados en el índice.
pub fn recorrer_meta(
    dir: &Path,
    base: &Path,
    patrones: &[Patron],
    incluir: &dyn Fn(&Path) -> bool,
    etiqueta: &dyn Fn(&Path) -> String,
    out: &mut Vec<ArchivoMeta>,
) -> Result<(), String> {
    let entradas =
        std::fs::read_dir(dir).map_err(|e| format!("No se pudo leer {}: {e}", dir.display()))?;

    for entrada in entradas {
        let entrada = entrada.map_err(|e| format!("No se pudo leer {}: {e}", dir.display()))?;
        let ruta = entrada.path();
        let es_dir = entrada.file_type().map(|t| t.is_dir()).unwrap_or(false);

        if es_dir {
            let relativa = rel_posix(base, &ruta)?;
            if mycignore::ignorada(&relativa, true, patrones) {
                continue;
            }
            recorrer_meta(&ruta, base, patrones, incluir, etiqueta, out)?;
        } else if incluir(&ruta) {
            let relativa = rel_posix(base, &ruta)?;
            if mycignore::ignorada(&relativa, false, patrones) {
                continue;
            }
            let mtime = entrada.metadata().map(|m| mtime_ms(&m)).unwrap_or(0);
            out.push(ArchivoMeta { ruta_relativa: relativa, mtime, tipo: etiqueta(&ruta) });
        }
    }
    Ok(())
}

/// Las notas del vault (lo que `tipos::es_importable` acepta), respetando su
/// `.mycignore`. Es exactamente lo que devuelve `listar_archivos_meta` en la app.
pub fn notas_del_vault(base: &Path) -> Result<Vec<ArchivoMeta>, String> {
    let patrones = mycignore::cargar(base);
    let mut out = Vec::new();
    recorrer_meta(
        base,
        base,
        &patrones,
        &crate::tipos::es_importable,
        &crate::tipos::tipo_de,
        &mut out,
    )?;
    Ok(out)
}
