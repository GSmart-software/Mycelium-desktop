//! `.mycignore` por vault (estilo `.gitignore`, FUN-M-11).
//!
//! Cada vault puede tener un archivo `.mycignore` en su raíz que decide qué
//! archivos/carpetas IGNORA Mycelium al indexar y al observar cambios. Sin el
//! archivo, el comportamiento por defecto ignora los directorios ocultos (`.*/`)
//! y las carpetas de build/dependencias más habituales (ver `DEFAULT`).
//!
//! Sintaxis (subconjunto de gitignore, sin negaciones):
//! - Líneas vacías y `# comentarios` se omiten.
//! - `nombre/` — ignora DIRECTORIOS con ese nombre en cualquier nivel.
//! - `nombre` — ignora archivos o carpetas con ese nombre en cualquier nivel.
//! - `ruta/con/barras` — anclada a la raíz del vault (p. ej. `docs/tmp/`).
//! - `*` y `?` — comodines dentro de un segmento (`*.tmp.md`, `.*/`).
//! - `.mycelium/` (índice interno + papelera) se ignora SIEMPRE, esté o no.

use std::path::Path;

/// Nombre del archivo de configuración en la raíz del vault.
pub const ARCHIVO: &str = ".mycignore";

/// Comportamiento cuando el vault no tiene `.mycignore`: directorios ocultos +
/// las carpetas de dependencias/build que hacen que abrir un repo como vault
/// indexe decenas de miles de archivos que no son notas (FUN-M-12).
///
/// `build/` y `vendor/` quedan fuera a propósito: es más probable que sean
/// carpetas legítimas de notas que ruido de compilación.
///
/// OJO: un `.mycignore` presente **reemplaza este default por completo** (la
/// sintaxis no tiene negaciones). Quien tenga notas en una carpeta llamada
/// `dist` escribe su propio archivo sin esa línea.
const DEFAULT: &str = ".*/\nnode_modules/\ntarget/\ndist/\nout/";

/// Un patrón parseado del `.mycignore`.
pub struct Patron {
    /// Termina en `/`: solo coincide con directorios (y todo su contenido).
    solo_dir: bool,
    /// Contiene `/` interno: se compara desde la raíz del vault.
    anclado: bool,
    segmentos: Vec<String>,
}

/// Carga los patrones del vault (o el default si no hay `.mycignore`).
pub fn cargar(base: &Path) -> Vec<Patron> {
    let texto = std::fs::read_to_string(base.join(ARCHIVO)).unwrap_or_else(|_| DEFAULT.into());
    parsear(&texto)
}

/// Parsea el texto de un `.mycignore`.
pub fn parsear(texto: &str) -> Vec<Patron> {
    texto
        .lines()
        .filter_map(|linea| {
            let linea = linea.trim();
            if linea.is_empty() || linea.starts_with('#') {
                return None;
            }
            let solo_dir = linea.ends_with('/');
            let cuerpo = linea.trim_end_matches('/').trim_start_matches('/');
            if cuerpo.is_empty() {
                return None;
            }
            let anclado = cuerpo.contains('/');
            let segmentos: Vec<String> = cuerpo.split('/').map(str::to_string).collect();
            Some(Patron { solo_dir, anclado, segmentos })
        })
        .collect()
}

/// Glob de un segmento: `*` = cualquier tramo (sin `/`), `?` = un carácter.
fn glob_seg(patron: &str, seg: &str) -> bool {
    fn glob(p: &[char], s: &[char]) -> bool {
        match p.first() {
            None => s.is_empty(),
            Some('*') => (0..=s.len()).any(|i| glob(&p[1..], &s[i..])),
            Some('?') => !s.is_empty() && glob(&p[1..], &s[1..]),
            Some(c) => s.first() == Some(c) && glob(&p[1..], &s[1..]),
        }
    }
    glob(&patron.chars().collect::<Vec<_>>(), &seg.chars().collect::<Vec<_>>())
}

/// ¿Un patrón coincide con la ruta (segmentos) dada?
fn coincide(p: &Patron, segs: &[&str], es_dir: bool) -> bool {
    if p.anclado {
        let k = p.segmentos.len();
        if segs.len() < k {
            return false;
        }
        if !p.segmentos.iter().zip(segs).all(|(pa, se)| glob_seg(pa, se)) {
            return false;
        }
        if segs.len() > k {
            return true; // está DENTRO de la ruta ignorada
        }
        return !p.solo_dir || es_dir;
    }
    // Sin anclar: el patrón (un segmento) puede coincidir con cualquier componente.
    let pa = &p.segmentos[0];
    for (i, se) in segs.iter().enumerate() {
        if glob_seg(pa, se) {
            let es_ultimo = i == segs.len() - 1;
            if !es_ultimo {
                return true; // está dentro de un dir que coincide
            }
            return !p.solo_dir || es_dir;
        }
    }
    false
}

/// ¿La ruta relativa POSIX está ignorada? `.mycelium` lo está SIEMPRE.
pub fn ignorada(rel: &str, es_dir: bool, patrones: &[Patron]) -> bool {
    let segs: Vec<&str> = rel.split('/').filter(|s| !s.is_empty()).collect();
    if segs.is_empty() {
        return false;
    }
    if segs[0] == ".mycelium" {
        return true;
    }
    patrones.iter().any(|p| coincide(p, &segs, es_dir))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_ignora_dirs_ocultos_pero_no_archivos_ocultos() {
        let p = parsear(".*/");
        assert!(ignorada(".git", true, &p));
        assert!(ignorada(".claude/commands/x.md", false, &p));
        assert!(!ignorada(".mycignore", false, &p)); // archivo oculto, no dir
        assert!(!ignorada("notas/a.md", false, &p));
    }

    /// El default (sin `.mycignore` en el vault) tiene que cubrir las carpetas
    /// de dependencias/build: es lo que hace que abrir un repo como vault no
    /// indexe los README de `node_modules` (FUN-M-12).
    #[test]
    fn default_ignora_carpetas_de_dependencias_y_build() {
        let p = parsear(DEFAULT);
        assert!(ignorada("node_modules", true, &p));
        assert!(ignorada("node_modules/react/README.md", false, &p));
        assert!(ignorada("frontend/node_modules/x/LEEME.md", false, &p));
        assert!(ignorada("frontend/src-tauri/target/debug/x.md", false, &p));
        assert!(ignorada("dist", true, &p));
        assert!(ignorada("out/index.md", false, &p));
        // Sigue ignorando los ocultos, y NO toca las notas de verdad.
        assert!(ignorada(".git/config", false, &p));
        assert!(!ignorada("docs/BACKLOG.md", false, &p));
        // `build/` y `vendor/` quedan fuera del default a propósito.
        assert!(!ignorada("build/nota.md", false, &p));
        assert!(!ignorada("vendor/nota.md", false, &p));
        // Un archivo (no directorio) llamado `dist` no cae: los patrones son `dir/`.
        assert!(!ignorada("dist", false, &p));
    }

    #[test]
    fn mycelium_siempre_ignorado() {
        let p = parsear(""); // sin patrones
        assert!(ignorada(".mycelium", true, &p));
        assert!(ignorada(".mycelium/.trash/x.md", false, &p));
    }

    #[test]
    fn patrones_anclados_y_por_nombre() {
        let p = parsear("# comentario\nborradores/\ndocs/tmp/\n*.tmp.md\n");
        assert!(ignorada("borradores", true, &p));
        assert!(ignorada("sub/borradores/x.md", false, &p));
        assert!(ignorada("docs/tmp/x.md", false, &p));
        assert!(!ignorada("otra/docs/tmp", true, &p)); // anclado a la raíz
        assert!(ignorada("a/b/c.tmp.md", false, &p));
        assert!(!ignorada("a/b/c.md", false, &p));
    }

    #[test]
    fn sin_default_los_ocultos_se_indexan() {
        let p = parsear(".git/\n.obsidian/\n");
        assert!(ignorada(".git/config", false, &p));
        assert!(!ignorada(".claude/commands/x.md", false, &p)); // ya no ignorado
    }
}
