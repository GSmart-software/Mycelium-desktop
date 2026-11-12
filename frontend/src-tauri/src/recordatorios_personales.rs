//! Los **recordatorios personales** (`FUN-M-60`): los del calendario que no son
//! de un vault sino del usuario, y se ven y avisan desde todos los vaults.
//!
//! Viven junto a la Bandeja personal, en la carpeta de datos de la app
//! (`app_data_dir`): `%APPDATA%\com.mycelium.desktop\Recordatorios personales.json`
//! en Windows. Mismo formato que `.mycelium/recordatorios.json` de un vault; lo
//! interpreta el frontend (`lib/recordatorios.ts`), Rust solo guarda texto.
//!
//! > [!important] Comandos acotados a ESE archivo
//! > Como los de la Bandeja personal, **ninguno recibe una ruta**: la arma Rust
//! > con `app_data_dir` y un nombre fijo.
//!
//! **Dos ventanas a la vez no se pisan**: el mismo candado de proceso y la
//! misma huella que la Bandeja personal (`bandeja_personal.rs`). Quien guarda
//! manda la huella de lo que leyó; si el archivo cambió desde entonces, no se
//! escribe y vuelve `conflicto: true`, y el frontend reaplica su cambio sobre
//! lo nuevo. Cada escritura avisa a todas las ventanas con
//! `recordatorios-personales-cambiados`.
//!
//! **Avisan una sola vez** aunque haya varias ventanas de vault abiertas: cada
//! ventana pregunta, por cada aviso personal que le toca, si es suyo
//! (`recordatorios_personales_reclamar`). El primero que pregunta queda como
//! dueño —salvo que haya otra ventana de vault con el foco: entonces es de esa—
//! y lo sigue siendo mientras esa ventana tenga un vault abierto.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use tauri::{Emitter, Manager};

use crate::bandeja_personal::tomar_candado;
use crate::vault_fs::{escribir_atomico, huella_de};

/// El nombre del archivo, dentro de `app_data_dir`.
const ARCHIVO: &str = "Recordatorios personales.json";
/// Evento a todas las ventanas cuando el archivo cambió desde la app.
const EVENTO: &str = "recordatorios-personales-cambiados";

/// Qué ventana avisa cada aviso personal: `clave|momento` → etiqueta.
static DUENOS: Mutex<Option<HashMap<String, String>>> = Mutex::new(None);

/// Lo que devuelve leer.
#[derive(Debug, serde::Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Leido {
    /// El contenido; vacío si el archivo no existe.
    pub contenido: String,
    /// Si el archivo existe.
    pub existe: bool,
    /// La ruta absoluta, para mostrarla (la ayuda dice dónde vive).
    pub ruta: String,
}

/// Lo que devuelve guardar.
#[derive(Debug, serde::Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Guardado {
    /// El archivo cambió desde la base de quien guarda: **no se escribió nada**.
    pub conflicto: bool,
}

fn ruta(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|e| format!("No se encontró la carpeta de datos de la app: {e}"))?
        .join(ARCHIVO))
}

/// Lee el archivo. Sin él, contenido vacío y `existe: false` (no se crea antes
/// del primer recordatorio personal). Ilegible es un error y no un vacío: el
/// próximo guardado lo reescribiría y se perdería todo.
pub(crate) fn leer_en(ruta: &Path) -> Result<Leido, String> {
    let mostrar = ruta.display().to_string();
    match std::fs::read_to_string(ruta) {
        Ok(contenido) => Ok(Leido { contenido, existe: true, ruta: mostrar }),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            Ok(Leido { contenido: String::new(), existe: false, ruta: mostrar })
        }
        Err(e) => Err(format!("No se pudieron leer los recordatorios personales ({mostrar}): {e}")),
    }
}

/// Guarda el contenido entero, comparando **dentro del candado** contra la
/// huella de lo que se leyó (`huella_esperada`, SHA-256 hex del texto; la del
/// vacío si no existía). Si el disco tiene otra cosa —ni la base ni lo que se
/// va a escribir—, no escribe y devuelve conflicto. El mismo criterio que
/// `bandeja_personal::guardar_en`.
pub(crate) fn guardar_en(ruta: &Path, contenido: &str, huella_esperada: &str) -> Result<Guardado, String> {
    let huella = huella_de(contenido.as_bytes());
    let _turno = tomar_candado();
    let disco = match std::fs::read(ruta) {
        Ok(bytes) => huella_de(&bytes),
        // Sin archivo, la base es el vacío: quien leyó «no existe» leyó "".
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => huella_de(b""),
        Err(e) => {
            return Err(format!("No se pudieron leer los recordatorios personales ({}): {e}", ruta.display()))
        }
    };
    if disco != huella_esperada && disco != huella {
        return Ok(Guardado { conflicto: true });
    }
    if let Some(dir) = ruta.parent() {
        std::fs::create_dir_all(dir).map_err(|e| format!("No se pudo crear {}: {e}", dir.display()))?;
    }
    escribir_atomico(ruta, contenido)?;
    Ok(Guardado { conflicto: false })
}

/// Lee los recordatorios personales.
#[tauri::command]
pub fn recordatorios_personales_leer(app: tauri::AppHandle) -> Result<Leido, String> {
    leer_en(&ruta(&app)?)
}

/// Guarda los recordatorios personales con la huella de la base (ver
/// `guardar_en`). Avisa a todas las ventanas si escribió.
#[tauri::command]
pub fn recordatorios_personales_guardar(
    app: tauri::AppHandle,
    contenido: String,
    huella_esperada: String,
) -> Result<Guardado, String> {
    let r = guardar_en(&ruta(&app)?, &contenido, &huella_esperada)?;
    if !r.conflicto {
        let _ = app.emit(EVENTO, ());
    }
    Ok(r)
}

/// Quién avisa un aviso personal. Se queda el dueño que ya tiene si sigue
/// vivo (una ventana con vault abierto); si no, la ventana con vault que tenga
/// el foco, y si ninguna lo tiene, la que pregunta.
pub(crate) fn elegir_dueno(actual: Option<&str>, vivas: &[String], enfocada: Option<&str>, llamante: &str) -> String {
    if let Some(a) = actual {
        if vivas.iter().any(|v| v == a) {
            return a.to_string();
        }
    }
    match enfocada {
        Some(e) if vivas.iter().any(|v| v == e) => e.to_string(),
        _ => llamante.to_string(),
    }
}

/// Reparte los avisos personales entre las ventanas: recibe las claves de los
/// que a esta ventana le tocaría mostrar (`clave|momento`) y devuelve las que
/// **son suyas**. Las demás las muestra otra ventana.
#[tauri::command]
pub fn recordatorios_personales_reclamar(
    ventana: tauri::Window,
    claves: Vec<String>,
) -> Vec<String> {
    let app = ventana.app_handle();
    let propia = ventana.label().to_string();
    // Las ventanas que tienen un vault abierto: solo ellas avisan.
    let vivas: Vec<String> = app
        .state::<crate::ventanas::VentanasState>()
        .0
        .lock()
        .map(|m| m.keys().cloned().collect())
        .unwrap_or_default();
    let enfocada = app
        .webview_windows()
        .into_iter()
        .find(|(l, w)| vivas.contains(l) && w.is_focused().unwrap_or(false))
        .map(|(l, _)| l);
    let mut guardia = DUENOS.lock().unwrap_or_else(|e| e.into_inner());
    let duenos = guardia.get_or_insert_with(HashMap::new);
    // Lo de ventanas que ya no tienen vault no le sirve a nadie.
    duenos.retain(|_, d| vivas.contains(d));
    let mut mias = Vec::new();
    for clave in claves {
        let dueno = elegir_dueno(duenos.get(&clave).map(String::as_str), &vivas, enfocada.as_deref(), &propia);
        if dueno == propia {
            mias.push(clave.clone());
        }
        duenos.insert(clave, dueno);
    }
    mias
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;

    fn temporal(nombre: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("mycelium-recpers-{nombre}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn leer_sin_archivo_es_vacio_y_no_lo_crea() {
        let base = temporal("leer");
        let ruta = base.join("datos").join(ARCHIVO);
        let r = leer_en(&ruta).unwrap();
        assert_eq!((r.contenido.as_str(), r.existe), ("", false));
        assert!(!ruta.exists());
    }

    #[test]
    fn leer_ilegible_es_error_y_no_vacio() {
        let base = temporal("ilegible");
        let ruta = base.join(ARCHIVO);
        std::fs::create_dir_all(&ruta).unwrap();
        assert!(leer_en(&ruta).is_err());
    }

    #[test]
    fn guardar_con_huella_escribe_solo_si_el_disco_tiene_la_base() {
        let base = temporal("huella");
        let ruta = base.join("sin-carpeta").join(ARCHIVO);
        // Sin archivo, la base es el vacío: se crea (con su carpeta).
        assert!(!guardar_en(&ruta, "{\"a\":1}", &huella_de(b"")).unwrap().conflicto);
        assert_eq!(std::fs::read_to_string(&ruta).unwrap(), "{\"a\":1}");

        // Con la base vieja (el vacío): el disco ya es otro → conflicto, no escribe.
        assert!(guardar_en(&ruta, "{\"b\":2}", &huella_de(b"")).unwrap().conflicto);
        assert_eq!(std::fs::read_to_string(&ruta).unwrap(), "{\"a\":1}");

        // El disco ya tiene lo que se quiere escribir: no es conflicto.
        assert!(!guardar_en(&ruta, "{\"a\":1}", &huella_de(b"otra cosa")).unwrap().conflicto);

        // Con la base al día: escribe.
        assert!(!guardar_en(&ruta, "{\"c\":3}", &huella_de(b"{\"a\":1}")).unwrap().conflicto);
        assert_eq!(std::fs::read_to_string(&ruta).unwrap(), "{\"c\":3}");

        // Sin temporales sueltos.
        let archivos: Vec<_> =
            std::fs::read_dir(ruta.parent().unwrap()).unwrap().flatten().map(|e| e.file_name()).collect();
        assert_eq!(archivos, vec![std::ffi::OsString::from(ARCHIVO)]);
    }

    /// Dos ventanas agregando recordatorios a la vez: leer, agregar y guardar con
    /// la huella de lo leído, reintentando si hubo conflicto. Ninguno se pierde.
    #[test]
    fn dos_ventanas_escribiendo_a_la_vez_no_se_pisan() {
        let base = temporal("concurrente");
        let ruta = Arc::new(base.join(ARCHIVO));
        let hilos: Vec<_> = (0..8)
            .map(|i| {
                let ruta = Arc::clone(&ruta);
                std::thread::spawn(move || {
                    for j in 0..10 {
                        loop {
                            let previo = leer_en(&ruta).unwrap().contenido;
                            let nuevo = format!("{previo}{i}-{j}\n");
                            if !guardar_en(&ruta, &nuevo, &huella_de(previo.as_bytes())).unwrap().conflicto {
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
                assert!(final_.lines().any(|l| l == format!("{i}-{j}")), "falta {i}-{j}");
            }
        }
    }

    #[test]
    fn un_aviso_personal_lo_avisa_una_sola_ventana() {
        let vivas = vec!["main".to_string(), "vault-2".to_string()];
        // Nadie con foco: el primero que pregunta.
        assert_eq!(elegir_dueno(None, &vivas, None, "vault-2"), "vault-2");
        // Ya tiene dueño vivo: lo conserva, pregunte quien pregunte y tenga quien tenga el foco.
        assert_eq!(elegir_dueno(Some("vault-2"), &vivas, Some("main"), "main"), "vault-2");
        // Sin dueño, con una ventana de vault enfocada: esa, aunque pregunte otra.
        assert_eq!(elegir_dueno(None, &vivas, Some("main"), "vault-2"), "main");
        // El dueño cerró su vault: lo toma la enfocada, o quien pregunta.
        assert_eq!(elegir_dueno(Some("vault-9"), &vivas, None, "main"), "main");
        // Una enfocada que no es ventana de vault (la captura flotante) no cuenta.
        assert_eq!(elegir_dueno(None, &vivas, Some("captura"), "vault-2"), "vault-2");
    }
}
