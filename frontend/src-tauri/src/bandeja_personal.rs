//! La **Bandeja personal** (`FUN-L-33`, Parte B): un archivo Markdown fuera de
//! todo vault, el mismo desde todos los vaults y todas las ventanas.
//!
//! Vive en la carpeta de datos de la app (`app_data_dir`):
//! `%APPDATA%\com.mycelium.desktop\Bandeja personal.md` en Windows,
//! `~/Library/Application Support/com.mycelium.desktop/` en macOS y
//! `~/.local/share/com.mycelium.desktop/` en Linux. No es parte de ningún vault:
//! no se indexa, no entra en la búsqueda, los enlaces, el grafo ni la IA.
//!
//! > [!important] Comandos acotados a ESE archivo
//! > Desde la 2.6.0 los comandos nativos trabajan solo sobre el vault de la
//! > ventana y no aceptan rutas desde la interfaz. Estos tampoco: **ninguno
//! > recibe una ruta**. La ruta la arma Rust con `app_data_dir` y un nombre fijo.
//!
//! **Dos ventanas a la vez no se pisan.** Todas las ventanas viven en el mismo
//! proceso (instancia única), así que un candado de proceso (`CANDADO`) basta:
//! guardar **compara y escribe dentro del candado**. Quien guarda manda la
//! huella de lo que leyó; si el archivo cambió desde entonces (otra ventana
//! anotó, el usuario lo editó en otra pestaña), no se escribe nada y vuelve
//! `conflicto: true`. Anotar al final es leer → agregar la entrada (en el
//! frontend, `agregarEntrada` de `lib/bandeja.ts`, la única fuente del formato)
//! → guardar con la huella de lo leído, y reintentar si hubo conflicto: así
//! ninguna entrada pisa a otra. La escritura es atómica (temporal + `rename`,
//! `escribir_atomico`): un corte nunca deja el archivo a medias.
//!
//! Cada escritura avisa a **todas** las ventanas con el evento
//! `bandeja-personal-cambiada`: recargan su contador y la pestaña abierta (que,
//! si tiene cambios propios, entra en la barra de conflicto como con un cambio
//! externo, `DEF-138`).

use std::path::{Path, PathBuf};
use std::sync::Mutex;

use tauri::{Emitter, Manager};

use crate::vault_fs::{escribir_atomico, huella_de};

/// El nombre del archivo, dentro de `app_data_dir`.
const ARCHIVO: &str = "Bandeja personal.md";
/// Evento a todas las ventanas cuando el archivo cambió desde la app.
const EVENTO: &str = "bandeja-personal-cambiada";

/// Una escritura (o comparación + escritura) a la vez, en todo el proceso.
static CANDADO: Mutex<()> = Mutex::new(());

/// Lo que devuelve leer.
#[derive(Debug, serde::Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Leida {
    /// El contenido; vacío si el archivo no existe.
    pub contenido: String,
    /// Si el archivo existe (después de crearlo, si se pidió).
    pub existe: bool,
    /// La ruta absoluta, para mostrarla (la ayuda y el título dicen dónde vive).
    pub ruta: String,
}

/// Lo que devuelve guardar.
#[derive(Debug, serde::Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Guardada {
    /// El archivo cambió desde la base de quien guarda: **no se escribió nada**.
    pub conflicto: bool,
    /// Huella de lo escrito (SHA-256 hex, la de `huellaDeTexto`); `None` en conflicto.
    pub huella: Option<String>,
}

fn ruta(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|e| format!("No se encontró la carpeta de datos de la app: {e}"))?
        .join(ARCHIVO))
}

/// El candado lo comparten los demás archivos personales de la app (los
/// recordatorios personales, `recordatorios_personales.rs`, `FUN-M-60`): son
/// escrituras cortas y raras, y un solo candado no puede trabarse con otro.
pub(crate) fn tomar_candado() -> std::sync::MutexGuard<'static, ()> {
    CANDADO.lock().unwrap_or_else(|e| e.into_inner())
}

/// Crea el archivo vacío (y su carpeta) si falta. No lo toca si existe.
fn crear_si_falta(ruta: &Path) -> Result<(), String> {
    if ruta.exists() {
        return Ok(());
    }
    if let Some(dir) = ruta.parent() {
        std::fs::create_dir_all(dir).map_err(|e| format!("No se pudo crear {}: {e}", dir.display()))?;
    }
    escribir_atomico(ruta, "")
}

/// Lee el archivo. Sin él, contenido vacío y `existe: false` —salvo que se pida
/// `crear`: entonces se crea vacío—. Ilegible (permisos, no es UTF-8) es un
/// error y no un vacío: el próximo guardado lo reescribiría y se perdería todo.
pub(crate) fn leer_en(ruta: &Path, crear: bool) -> Result<Leida, String> {
    if crear {
        let _turno = tomar_candado();
        crear_si_falta(ruta)?;
    }
    let mostrar = ruta.display().to_string();
    match std::fs::read_to_string(ruta) {
        Ok(contenido) => Ok(Leida { contenido, existe: true, ruta: mostrar }),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            Ok(Leida { contenido: String::new(), existe: false, ruta: mostrar })
        }
        Err(e) => Err(format!("No se pudo leer la Bandeja personal ({mostrar}): {e}")),
    }
}

/// Guarda el contenido entero. Con `huella_esperada` (la de lo que se leyó),
/// compara y escribe **dentro del candado**: si el disco tiene otra cosa —ni la
/// base ni lo que se va a escribir—, no escribe y devuelve conflicto. Un
/// archivo que no existe se recrea. Sin huella escribe siempre (la decisión
/// explícita «Quedarme con lo mío»). Es el mismo criterio que `guardar_nota`.
pub(crate) fn guardar_en(
    ruta: &Path,
    contenido: &str,
    huella_esperada: Option<&str>,
) -> Result<Guardada, String> {
    let huella = huella_de(contenido.as_bytes());
    let _turno = tomar_candado();
    if let Some(esperada) = huella_esperada {
        match std::fs::read(ruta) {
            Ok(bytes) => {
                let disco = huella_de(&bytes);
                if disco != esperada && disco != huella {
                    return Ok(Guardada { conflicto: true, huella: None });
                }
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => return Err(format!("No se pudo leer la Bandeja personal ({}): {e}", ruta.display())),
        }
    }
    if let Some(dir) = ruta.parent() {
        std::fs::create_dir_all(dir).map_err(|e| format!("No se pudo crear {}: {e}", dir.display()))?;
    }
    escribir_atomico(ruta, contenido)?;
    Ok(Guardada { conflicto: false, huella: Some(huella) })
}

/// Lee la Bandeja personal. `crear`: si falta, se crea vacía (al abrirla como
/// nota). El contador no la crea: no se crea antes de la primera captura.
#[tauri::command]
pub fn bandeja_personal_leer(app: tauri::AppHandle, crear: Option<bool>) -> Result<Leida, String> {
    let ruta = ruta(&app)?;
    let existia = ruta.exists();
    let leida = leer_en(&ruta, crear.unwrap_or(false))?;
    if !existia && leida.existe {
        let _ = app.emit(EVENTO, ());
    }
    Ok(leida)
}

/// Guarda la Bandeja personal entera, con la huella de la base (ver
/// `guardar_en`). Lo usan el editor (la pestaña de la Bandeja personal) y la
/// captura rápida (agregar al final con reintento). Avisa a todas las ventanas
/// si escribió.
#[tauri::command]
pub fn bandeja_personal_guardar(
    app: tauri::AppHandle,
    contenido: String,
    huella_esperada: Option<String>,
) -> Result<Guardada, String> {
    let r = guardar_en(&ruta(&app)?, &contenido, huella_esperada.as_deref())?;
    if !r.conflicto {
        let _ = app.emit(EVENTO, ());
    }
    Ok(r)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;

    fn temporal(nombre: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("mycelium-bandeja-{nombre}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn leer_sin_archivo_no_lo_crea_salvo_que_se_pida() {
        let base = temporal("leer");
        let ruta = base.join("datos").join(ARCHIVO);
        let r = leer_en(&ruta, false).unwrap();
        assert_eq!((r.contenido.as_str(), r.existe), ("", false));
        assert!(!ruta.exists());
        let r = leer_en(&ruta, true).unwrap();
        assert_eq!((r.contenido.as_str(), r.existe), ("", true));
        assert!(ruta.exists());
        // Crear no pisa lo que hay.
        std::fs::write(&ruta, "- algo\n").unwrap();
        assert_eq!(leer_en(&ruta, true).unwrap().contenido, "- algo\n");
    }

    #[test]
    fn leer_ilegible_es_error_y_no_vacio() {
        let base = temporal("ilegible");
        let ruta = base.join(ARCHIVO);
        std::fs::create_dir_all(&ruta).unwrap();
        assert!(leer_en(&ruta, false).is_err());
    }

    #[test]
    fn guardar_con_huella_escribe_solo_si_el_disco_tiene_la_base() {
        let base = temporal("huella");
        let ruta = base.join(ARCHIVO);
        std::fs::write(&ruta, "base").unwrap();
        let h_base = huella_de(b"base");

        let r = guardar_en(&ruta, "mío", Some(&h_base)).unwrap();
        assert!(!r.conflicto);
        assert_eq!(r.huella.as_deref(), Some(huella_de("mío".as_bytes()).as_str()));
        assert_eq!(std::fs::read_to_string(&ruta).unwrap(), "mío");

        // Con la base vieja: el disco ya es otro → conflicto, no escribe.
        let r = guardar_en(&ruta, "otro", Some(&h_base)).unwrap();
        assert!(r.conflicto);
        assert!(r.huella.is_none());
        assert_eq!(std::fs::read_to_string(&ruta).unwrap(), "mío");

        // El disco ya tiene lo que se quiere escribir: «ya está», no es conflicto.
        assert!(!guardar_en(&ruta, "mío", Some(&h_base)).unwrap().conflicto);

        // Sin huella (decisión explícita): escribe siempre.
        assert!(!guardar_en(&ruta, "forzado", None).unwrap().conflicto);
        assert_eq!(std::fs::read_to_string(&ruta).unwrap(), "forzado");

        // Sin temporales sueltos.
        let archivos: Vec<_> = std::fs::read_dir(&base).unwrap().flatten().map(|e| e.file_name()).collect();
        assert_eq!(archivos, vec![std::ffi::OsString::from(ARCHIVO)]);
    }

    #[test]
    fn guardar_recrea_el_archivo_borrado_por_fuera() {
        let base = temporal("recrea");
        let ruta = base.join("sin-carpeta").join(ARCHIVO);
        let r = guardar_en(&ruta, "- 09:40 hola\n", Some(&huella_de(b"lo que habia"))).unwrap();
        assert!(!r.conflicto);
        assert_eq!(std::fs::read_to_string(&ruta).unwrap(), "- 09:40 hola\n");
    }

    /// Lo que hace la captura de dos ventanas a la vez: leer, agregar al final y
    /// guardar con la huella de lo leído, reintentando si hubo conflicto. Con el
    /// candado, ninguna entrada se pierde.
    #[test]
    fn dos_ventanas_anotando_a_la_vez_no_se_pisan() {
        let base = temporal("concurrente");
        let ruta = Arc::new(base.join(ARCHIVO));
        std::fs::write(&*ruta, "").unwrap();
        let hilos: Vec<_> = (0..8)
            .map(|i| {
                let ruta = Arc::clone(&ruta);
                std::thread::spawn(move || {
                    for j in 0..10 {
                        loop {
                            let previo = leer_en(&ruta, false).unwrap().contenido;
                            let nuevo = format!("{previo}- {i}-{j}\n");
                            let h = huella_de(previo.as_bytes());
                            if !guardar_en(&ruta, &nuevo, Some(&h)).unwrap().conflicto {
                                break;
                            }
                        }
                    }
                })
            })
            .collect();
        for h in hilos {
            h.join().unwrap();
        }
        let final_ = std::fs::read_to_string(&*ruta).unwrap();
        assert_eq!(final_.lines().count(), 80);
        for i in 0..8 {
            for j in 0..10 {
                assert!(final_.contains(&format!("- {i}-{j}\n")), "falta {i}-{j}");
            }
        }
    }
}
