//! Acceso nativo al sistema de archivos para exportar/importar el vault contra
//! una carpeta real del SO.
//!
//! La E/S se hace aquí (Rust) y NO con `tauri-plugin-fs` desde JS: el scope del
//! plugin fs en Tauri v2 no cubre bien rutas arbitrarias elegidas por el usuario
//! en tiempo de ejecución. Desde Rust el acceso es directo y la superficie queda
//! acotada a estos tres comandos. Del lado JS solo se usa el plugin `dialog`
//! para los selectores de carpeta.

use std::path::{Component, Path, PathBuf};

/// Archivo que el frontend quiere escribir dentro de la carpeta destino.
#[derive(serde::Deserialize)]
pub struct ArchivoExport {
    pub ruta_relativa: String,
    pub contenido: String,
}

/// Archivo leído de una carpeta del SO, con su ruta relativa al origen.
#[derive(serde::Serialize)]
pub struct ArchivoLeido {
    pub ruta_relativa: String,
    pub contenido: String,
}

/// Archivo del vault con los metadatos que el índice derivado necesita para la
/// validación incremental por `mtime` (fase 2 del "vault en carpeta").
///
/// **Sin `contenido` a propósito** (FUN-M-12): el indexador compara `mtime` y
/// recién entonces pide el texto de lo que cambió, con `leer_archivos`. Antes
/// esta estructura llevaba el contenido de TODOS los archivos y se descartaba
/// casi entero en cada apertura (14 MB por IPC en un vault sobre un repo).
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArchivoMeta {
    pub ruta_relativa: String,
    /// Fecha de modificación en milisegundos epoch (de `metadata().modified()`).
    pub mtime: i64,
    /// `"excalidraw"` para `.excalidraw`, `"base"` para `.base`, `"markdown"` para el resto.
    pub tipo: String,
}

/// Tipo de nota según la extensión (espeja `notas.tipo` del índice/esquema).
fn tipo_de(path: &Path) -> String {
    match path.extension().and_then(|e| e.to_str()) {
        Some(ext) if ext.eq_ignore_ascii_case("excalidraw") => "excalidraw".to_string(),
        // Bases (`FUN-L-03`): tablas que agregan notas. La extensión es la de
        // Obsidian, para que el vault siga siendo intercambiable.
        Some(ext) if ext.eq_ignore_ascii_case("base") => "base".to_string(),
        _ => "markdown".to_string(),
    }
}

/// `mtime` en milisegundos epoch (0 si el SO no lo expone).
fn mtime_ms(metadata: &std::fs::Metadata) -> i64 {
    metadata
        .modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// Extensiones que se importan como notas del vault.
fn es_importable(path: &Path) -> bool {
    match path.extension().and_then(|e| e.to_str()) {
        Some(ext) => {
            let ext = ext.to_ascii_lowercase();
            ext == "md" || ext == "excalidraw" || ext == "base"
        }
        None => false,
    }
}

/// Un directorio oculto (`.git`, `.obsidian`, …) no se recorre.
fn es_oculto(nombre: &str) -> bool {
    nombre.starts_with('.')
}

/// Resuelve `relativa` dentro de `base` rechazando cualquier intento de salirse
/// (`..`, rutas absolutas, prefijos de unidad en Windows). Es la defensa contra
/// path traversal: el frontend arma las rutas a partir de títulos del usuario.
/// `pub(crate)` para reutilizarla desde `vault_fs` (mutaciones a disco, fase 4).
pub(crate) fn ruta_segura(base: &Path, relativa: &str) -> Result<PathBuf, String> {
    let rel = Path::new(relativa);
    let mut destino = base.to_path_buf();

    for comp in rel.components() {
        match comp {
            Component::Normal(seg) => destino.push(seg),
            Component::CurDir => {}
            Component::ParentDir | Component::RootDir | Component::Prefix(_) => {
                return Err(format!("Ruta no permitida: {relativa}"));
            }
        }
    }

    if !destino.starts_with(base) {
        return Err(format!("Ruta fuera de la carpeta destino: {relativa}"));
    }
    Ok(destino)
}

/// Escribe los archivos del vault dentro de `destino`, creando los subdirectorios
/// necesarios. Devuelve cuántos archivos se escribieron. Los archivos existentes
/// con el mismo nombre se sobrescriben (la confirmación la pide la UI).
#[tauri::command]
pub fn exportar_a_carpeta(destino: String, archivos: Vec<ArchivoExport>) -> Result<usize, String> {
    let base = PathBuf::from(&destino);
    if !base.is_dir() {
        return Err(format!("La carpeta destino no existe: {destino}"));
    }

    let mut escritos = 0usize;
    for archivo in &archivos {
        let ruta = ruta_segura(&base, &archivo.ruta_relativa)?;
        if let Some(padre) = ruta.parent() {
            std::fs::create_dir_all(padre)
                .map_err(|e| format!("No se pudo crear {}: {e}", padre.display()))?;
        }
        std::fs::write(&ruta, archivo.contenido.as_bytes())
            .map_err(|e| format!("No se pudo escribir {}: {e}", ruta.display()))?;
        escritos += 1;
    }
    Ok(escritos)
}

/// Recorre `dir` recursivamente acumulando los archivos importables.
fn recorrer(dir: &Path, base: &Path, out: &mut Vec<ArchivoLeido>) -> Result<(), String> {
    let entradas =
        std::fs::read_dir(dir).map_err(|e| format!("No se pudo leer {}: {e}", dir.display()))?;

    for entrada in entradas {
        let entrada = entrada.map_err(|e| format!("No se pudo leer {}: {e}", dir.display()))?;
        let ruta = entrada.path();
        let nombre = entrada.file_name().to_string_lossy().to_string();

        if ruta.is_dir() {
            if es_oculto(&nombre) {
                continue; // .git, .obsidian, …
            }
            recorrer(&ruta, base, out)?;
        } else if es_importable(&ruta) {
            // Los binarios o archivos con codificación no UTF-8 se omiten en
            // silencio: la importación es best-effort.
            let Ok(contenido) = std::fs::read_to_string(&ruta) else {
                continue;
            };
            let relativa = ruta
                .strip_prefix(base)
                .map_err(|_| format!("Ruta inesperada: {}", ruta.display()))?
                .components()
                .map(|c| c.as_os_str().to_string_lossy().to_string())
                .collect::<Vec<_>>()
                .join("/");
            out.push(ArchivoLeido { ruta_relativa: relativa, contenido });
        }
    }
    Ok(())
}

/// Lee recursivamente `origen` y devuelve los `.md`/`.excalidraw`/`.base` con su ruta
/// relativa (separador `/`) y su contenido UTF-8. Ignora directorios ocultos.
#[tauri::command]
pub fn leer_carpeta(origen: String) -> Result<Vec<ArchivoLeido>, String> {
    let base = PathBuf::from(&origen);
    if !base.is_dir() {
        return Err(format!("La carpeta de origen no existe: {origen}"));
    }
    let mut out = Vec::new();
    recorrer(&base, &base, &mut out)?;
    Ok(out)
}

/// Ruta relativa POSIX de `ruta` respecto de `base`.
fn rel_posix(base: &Path, ruta: &Path) -> Result<String, String> {
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
fn recorrer_meta(
    dir: &Path,
    base: &Path,
    patrones: &[crate::mycignore::Patron],
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
            if crate::mycignore::ignorada(&relativa, true, patrones) {
                continue;
            }
            recorrer_meta(&ruta, base, patrones, out)?;
        } else if es_importable(&ruta) {
            let relativa = rel_posix(base, &ruta)?;
            if crate::mycignore::ignorada(&relativa, false, patrones) {
                continue;
            }
            let mtime = entrada.metadata().map(|m| mtime_ms(&m)).unwrap_or(0);
            out.push(ArchivoMeta { ruta_relativa: relativa, mtime, tipo: tipo_de(&ruta) });
        }
    }
    Ok(())
}

/// Lee recursivamente `origen` y devuelve los `.md`/`.excalidraw`/`.base` con su ruta
/// relativa (separador `/`), su `mtime` (ms epoch) y su `tipo` — **sin el
/// contenido**. Es la fuente del indexador derivado (fase 2 del vault en
/// carpeta): con esto le alcanza para decidir qué reindexar, y el texto lo pide
/// después con `leer_archivos`. Qué se ignora lo decide el `.mycignore` del
/// vault (ver el default de `mycignore::DEFAULT`).
#[tauri::command]
pub fn listar_archivos_meta(origen: String) -> Result<Vec<ArchivoMeta>, String> {
    let base = PathBuf::from(&origen);
    if !base.is_dir() {
        return Err(format!("La carpeta de origen no existe: {origen}"));
    }
    let patrones = crate::mycignore::cargar(&base);
    let mut out = Vec::new();
    recorrer_meta(&base, &base, &patrones, &mut out)?;
    Ok(out)
}

/// Devuelve el contenido UTF-8 de las `rutas` (relativas POSIX) pedidas dentro
/// de `origen`. Complemento de `listar_archivos_meta` (FUN-M-12): el indexador
/// pide SOLO lo que va a reescribir, en tandas, en vez de recibir el vault
/// entero por IPC en cada apertura.
///
/// Cada ruta se resuelve con `ruta_segura` (defensa contra path traversal: el
/// frontend arma las rutas a partir del listado, pero el comando es invocable
/// desde el webview). Lo que no exista, no se pueda leer o no sea UTF-8 se
/// **omite en silencio**: el resultado puede traer menos entradas que `rutas`
/// —p. ej. si el archivo se borró entre las dos fases— y el llamador debe
/// tolerarlo.
#[tauri::command]
pub fn leer_archivos(origen: String, rutas: Vec<String>) -> Result<Vec<ArchivoLeido>, String> {
    let base = PathBuf::from(&origen);
    if !base.is_dir() {
        return Err(format!("La carpeta de origen no existe: {origen}"));
    }
    let mut out = Vec::with_capacity(rutas.len());
    for relativa in rutas {
        let ruta = ruta_segura(&base, &relativa)?;
        let Ok(contenido) = std::fs::read_to_string(&ruta) else {
            continue; // borrado entre fases, binario o no UTF-8: best-effort
        };
        out.push(ArchivoLeido { ruta_relativa: relativa, contenido });
    }
    Ok(out)
}

/// Recorre `dir` recursivamente acumulando las rutas relativas (separador `/`) de
/// TODOS los subdirectorios reales no ignorados por el `.mycignore`. A diferencia
/// del listado de archivos, aquí importan también los directorios VACÍOS: son la
/// única forma de que una carpeta sin notas sobreviva a un reindex (el indexador,
/// si solo derivara carpetas de las rutas de archivos, las perdería).
fn recorrer_dirs(
    dir: &Path,
    base: &Path,
    patrones: &[crate::mycignore::Patron],
    out: &mut Vec<String>,
) -> Result<(), String> {
    let entradas =
        std::fs::read_dir(dir).map_err(|e| format!("No se pudo leer {}: {e}", dir.display()))?;

    for entrada in entradas {
        let entrada = entrada.map_err(|e| format!("No se pudo leer {}: {e}", dir.display()))?;
        // `file_type()` en vez de `is_dir()`: el tipo viene con la entrada del
        // directorio y evita un `stat` por archivo (FUN-M-12).
        if !entrada.file_type().map(|t| t.is_dir()).unwrap_or(false) {
            continue;
        }
        let ruta = entrada.path();
        let relativa = rel_posix(base, &ruta)?;
        if crate::mycignore::ignorada(&relativa, true, patrones) {
            continue;
        }
        out.push(relativa);
        recorrer_dirs(&ruta, base, patrones, out)?;
    }
    Ok(())
}

/// Lista las rutas relativas POSIX de TODOS los subdirectorios de `origen`
/// (incluidos los vacíos), según el `.mycignore` del vault. Es el complemento
/// de `listar_archivos_meta` para que el índice conserve las carpetas vacías.
#[tauri::command]
pub fn listar_directorios(origen: String) -> Result<Vec<String>, String> {
    let base = PathBuf::from(&origen);
    if !base.is_dir() {
        return Err(format!("La carpeta de origen no existe: {origen}"));
    }
    let patrones = crate::mycignore::cargar(&base);
    let mut out = Vec::new();
    recorrer_dirs(&base, &base, &patrones, &mut out)?;
    Ok(out)
}

/// `true` si la carpeta tiene al menos una entrada. La UI lo usa para pedir
/// confirmación antes de exportar sobre una carpeta con contenido.
#[tauri::command]
pub fn carpeta_no_vacia(ruta: String) -> Result<bool, String> {
    let base = PathBuf::from(&ruta);
    if !base.is_dir() {
        return Err(format!("La carpeta no existe: {ruta}"));
    }
    let mut entradas =
        std::fs::read_dir(&base).map_err(|e| format!("No se pudo leer {ruta}: {e}"))?;
    Ok(entradas.next().is_some())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rechaza_escapes_de_la_carpeta_destino() {
        let base = Path::new("/vault");
        assert!(ruta_segura(base, "../fuera.md").is_err());
        assert!(ruta_segura(base, "sub/../../fuera.md").is_err());
        assert!(ruta_segura(base, "/etc/passwd").is_err());
        assert!(ruta_segura(base, "notas/ok.md").is_ok());
    }

    /// Ida y vuelta real contra el disco: exportar un vault a una carpeta y
    /// volver a leerlo debe devolver exactamente lo mismo, con la estructura
    /// de subcarpetas intacta y saltándose lo oculto y lo no importable.
    #[test]
    fn exportar_y_releer_conserva_el_arbol() {
        let base = std::env::temp_dir().join(format!("mycelium-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&base);
        std::fs::create_dir_all(&base).unwrap();
        let destino = base.to_string_lossy().to_string();

        let archivos = vec![
            ArchivoExport {
                ruta_relativa: "raiz.md".into(),
                contenido: "# Raíz con acentos ñ".into(),
            },
            ArchivoExport {
                ruta_relativa: "proyectos/2026/plan.md".into(),
                contenido: "contenido anidado".into(),
            },
            ArchivoExport {
                ruta_relativa: "adjuntos/diagrama.excalidraw".into(),
                contenido: "{\"type\":\"excalidraw\"}".into(),
            },
        ];
        assert_eq!(exportar_a_carpeta(destino.clone(), archivos).unwrap(), 3);
        assert!(base.join("proyectos/2026/plan.md").exists());
        assert!(carpeta_no_vacia(destino.clone()).unwrap());

        // Ruido que la importación debe ignorar: oculto y extensión ajena.
        std::fs::create_dir_all(base.join(".git")).unwrap();
        std::fs::write(base.join(".git/config"), "x").unwrap();
        std::fs::write(base.join("imagen.png"), "x").unwrap();

        let mut leidos = leer_carpeta(destino).unwrap();
        leidos.sort_by(|a, b| a.ruta_relativa.cmp(&b.ruta_relativa));
        let rutas: Vec<&str> = leidos.iter().map(|a| a.ruta_relativa.as_str()).collect();
        assert_eq!(
            rutas,
            vec!["adjuntos/diagrama.excalidraw", "proyectos/2026/plan.md", "raiz.md"]
        );
        assert_eq!(leidos[2].contenido, "# Raíz con acentos ñ");
        assert_eq!(leidos[1].contenido, "contenido anidado");

        std::fs::remove_dir_all(&base).unwrap();
    }

    /// `listar_archivos_meta` devuelve el tipo correcto por extensión, un
    /// `mtime > 0` para cada archivo y salta directorios ocultos (incl. el
    /// propio `.mycelium`).
    #[test]
    fn listar_meta_devuelve_mtime_y_tipo() {
        let base = std::env::temp_dir().join(format!("mycelium-meta-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&base);
        std::fs::create_dir_all(base.join("sub")).unwrap();
        std::fs::create_dir_all(base.join(".mycelium")).unwrap();
        std::fs::write(base.join("nota.md"), "# hola").unwrap();
        std::fs::write(base.join("sub/diagrama.excalidraw"), "{}").unwrap();
        // Ruido que debe ignorarse: el índice y una extensión ajena.
        std::fs::write(base.join(".mycelium/index-abc.db"), "x").unwrap();
        std::fs::write(base.join("imagen.png"), "x").unwrap();

        let mut metas =
            listar_archivos_meta(base.to_string_lossy().to_string()).unwrap();
        metas.sort_by(|a, b| a.ruta_relativa.cmp(&b.ruta_relativa));

        assert_eq!(metas.len(), 2);
        assert_eq!(metas[0].ruta_relativa, "nota.md");
        assert_eq!(metas[0].tipo, "markdown");
        assert_eq!(metas[1].ruta_relativa, "sub/diagrama.excalidraw");
        assert_eq!(metas[1].tipo, "excalidraw");
        assert!(metas.iter().all(|m| m.mtime > 0), "mtime debe ser > 0");

        std::fs::remove_dir_all(&base).unwrap();
    }

    /// `leer_archivos` devuelve el contenido SOLO de las rutas pedidas, omite en
    /// silencio lo que no existe (borrado entre las dos fases del indexado) y
    /// **rechaza** cualquier ruta que intente salirse del vault (FUN-M-12).
    #[test]
    fn leer_archivos_devuelve_lo_pedido_y_rechaza_escapes() {
        let base = std::env::temp_dir().join(format!("mycelium-leer-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&base);
        std::fs::create_dir_all(base.join("sub")).unwrap();
        std::fs::write(base.join("nota.md"), "# hola ñ").unwrap();
        std::fs::write(base.join("sub/otra.md"), "contenido anidado").unwrap();
        std::fs::write(base.join("ignorada.md"), "no se pide").unwrap();
        let origen = base.to_string_lossy().to_string();

        // Solo lo pedido, en el orden pedido.
        let leidos = leer_archivos(
            origen.clone(),
            vec!["sub/otra.md".into(), "nota.md".into()],
        )
        .unwrap();
        let rutas: Vec<&str> = leidos.iter().map(|a| a.ruta_relativa.as_str()).collect();
        assert_eq!(rutas, vec!["sub/otra.md", "nota.md"]);
        assert_eq!(leidos[0].contenido, "contenido anidado");
        assert_eq!(leidos[1].contenido, "# hola ñ");

        // Un archivo que ya no está se omite: el llamador recibe menos entradas.
        let leidos = leer_archivos(
            origen.clone(),
            vec!["nota.md".into(), "fantasma.md".into()],
        )
        .unwrap();
        assert_eq!(leidos.len(), 1);
        assert_eq!(leidos[0].ruta_relativa, "nota.md");

        // Path traversal: error, no lectura fuera del vault.
        assert!(leer_archivos(origen.clone(), vec!["../fuera.md".into()]).is_err());
        assert!(leer_archivos(origen.clone(), vec!["sub/../../fuera.md".into()]).is_err());
        assert!(leer_archivos(origen.clone(), vec!["/etc/passwd".into()]).is_err());

        // Lista vacía: no falla y no devuelve nada.
        assert!(leer_archivos(origen, vec![]).unwrap().is_empty());

        std::fs::remove_dir_all(&base).unwrap();
    }

    /// `listar_directorios` enumera TODOS los subdirectorios (incluidos los
    /// vacíos) con ruta relativa POSIX, e ignora ocultos y `.mycelium`.
    #[test]
    fn listar_directorios_incluye_vacios_e_ignora_ocultos() {
        let base = std::env::temp_dir().join(format!("mycelium-dirs-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&base);
        std::fs::create_dir_all(base.join("Proyectos/2026")).unwrap();
        std::fs::create_dir_all(base.join("Vacía")).unwrap(); // sin archivos
        std::fs::create_dir_all(base.join(".mycelium/.trash")).unwrap();
        std::fs::create_dir_all(base.join(".git")).unwrap();
        std::fs::write(base.join("Proyectos/2026/plan.md"), "x").unwrap();

        let mut dirs = listar_directorios(base.to_string_lossy().to_string()).unwrap();
        dirs.sort();
        assert_eq!(dirs, vec!["Proyectos", "Proyectos/2026", "Vacía"]);

        std::fs::remove_dir_all(&base).unwrap();
    }
}
