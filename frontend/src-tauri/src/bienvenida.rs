//! Nota de bienvenida de un vault nuevo (`FUN-S-05`).
//!
//! Mycelium no tiene un «crear vault» aparte: un vault nuevo es una carpeta
//! vacía que el usuario vincula (la crea en el mismo selector del sistema). Si
//! la carpeta elegida **no tenía nada** y no estaba en el registro, se siembra
//! una sola nota —una guía corta con ejemplos reales del formato— para que el
//! vault no arranque en blanco. Abrir o vincular una carpeta que ya tiene
//! contenido no escribe nada.
//!
//! El texto vive en `bienvenida.md`, al lado de este archivo, y entra al binario
//! con `include_str!`: se edita como Markdown, no como una cadena de Rust.

use std::io::Write;
use std::path::Path;

/// Nombre del archivo, en la raíz del vault. Es también el id de la nota en el
/// índice (la ruta relativa), con el que el frontend la abre al entrar.
pub const NOMBRE: &str = "Bienvenida a Mycelium.md";

/// Contenido de la nota.
const CONTENIDO: &str = include_str!("bienvenida.md");

/// Lo que el sistema deja en cualquier carpeta y no cuenta como contenido.
fn es_ruido(nombre: &str) -> bool {
    nombre.starts_with('.')
        || nombre.eq_ignore_ascii_case("desktop.ini")
        || nombre.eq_ignore_ascii_case("Thumbs.db")
}

/// `true` si la carpeta no tiene nada que el usuario haya puesto: ni notas, ni
/// archivos, ni subcarpetas. Lo oculto (`.git`, `.obsidian`, `.DS_Store`) y lo
/// que deja Windows (`desktop.ini`) no cuenta. Si no se puede leer, `false`: ante
/// la duda, no se escribe.
pub fn carpeta_vacia(dir: &Path) -> bool {
    let Ok(entradas) = std::fs::read_dir(dir) else { return false };
    for entrada in entradas {
        let Ok(entrada) = entrada else { return false };
        if !es_ruido(&entrada.file_name().to_string_lossy()) {
            return false;
        }
    }
    true
}

/// Siembra la nota en `dir` **si la carpeta está vacía**. Devuelve su id
/// (`Bienvenida a Mycelium.md`) solo si la escribió.
///
/// Con `create_new`: si el archivo apareció entre la comprobación y la escritura,
/// no se pisa. Un fallo al escribir no impide vincular el vault —la nota es un
/// regalo, no un requisito—, así que se informa y se devuelve `None`.
pub fn sembrar_si_vacia(dir: &Path) -> Option<String> {
    if !carpeta_vacia(dir) {
        return None;
    }
    let destino = dir.join(NOMBRE);
    let escrito = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&destino)
        .and_then(|mut f| f.write_all(CONTENIDO.as_bytes()));
    match escrito {
        Ok(()) => Some(NOMBRE.to_string()),
        Err(e) => {
            eprintln!("[bienvenida] no se pudo escribir {}: {e}", destino.display());
            None
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temporal(nombre: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("mic-bienvenida-{nombre}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn una_carpeta_vacia_recibe_la_nota() {
        let dir = temporal("vacia");
        assert_eq!(sembrar_si_vacia(&dir).as_deref(), Some(NOMBRE));
        let texto = std::fs::read_to_string(dir.join(NOMBRE)).unwrap();
        assert_eq!(texto, CONTENIDO);
        // La segunda vez la carpeta ya no está vacía: no se toca nada.
        assert_eq!(sembrar_si_vacia(&dir), None);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn lo_oculto_y_lo_del_sistema_no_cuentan_como_contenido() {
        let dir = temporal("oculto");
        std::fs::create_dir_all(dir.join(".git")).unwrap();
        std::fs::write(dir.join("desktop.ini"), "x").unwrap();
        assert!(carpeta_vacia(&dir));
        assert!(sembrar_si_vacia(&dir).is_some());
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn una_carpeta_con_contenido_no_se_toca() {
        let dir = temporal("llena");
        std::fs::write(dir.join("Mis notas.md"), "hola").unwrap();
        assert_eq!(sembrar_si_vacia(&dir), None);
        assert!(!dir.join(NOMBRE).exists());

        // Una subcarpeta vacía también es contenido: alguien la puso ahí.
        let dir2 = temporal("subcarpeta");
        std::fs::create_dir_all(dir2.join("Proyectos")).unwrap();
        assert_eq!(sembrar_si_vacia(&dir2), None);

        // Y si ya hay una nota con ese nombre, no se pisa.
        let dir3 = temporal("existente");
        std::fs::write(dir3.join(NOMBRE), "mía").unwrap();
        assert_eq!(sembrar_si_vacia(&dir3), None);
        assert_eq!(std::fs::read_to_string(dir3.join(NOMBRE)).unwrap(), "mía");

        for d in [dir, dir2, dir3] {
            let _ = std::fs::remove_dir_all(d);
        }
    }

    #[test]
    fn la_nota_no_usa_voseo_ni_promete_el_modo_desarrollador() {
        // Lo público va en español neutro (regla del usuario, 2026-10).
        for voseo in ["podés", "tenés", "escribí", "querés", "buscá", "elegí ", "abrí "] {
            assert!(!CONTENIDO.contains(voseo), "voseo en la bienvenida: {voseo}");
        }
        assert!(!CONTENIDO.to_lowercase().contains("desarrollador"));
    }
}
