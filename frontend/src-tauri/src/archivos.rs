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

/// Extensiones que se importan como notas del vault.
fn es_importable(path: &Path) -> bool {
    match path.extension().and_then(|e| e.to_str()) {
        Some(ext) => {
            let ext = ext.to_ascii_lowercase();
            ext == "md" || ext == "excalidraw"
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
fn ruta_segura(base: &Path, relativa: &str) -> Result<PathBuf, String> {
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

/// Lee recursivamente `origen` y devuelve los `.md`/`.excalidraw` con su ruta
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
}
