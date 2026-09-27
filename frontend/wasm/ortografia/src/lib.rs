//! Motor del corrector ortográfico (`FUN-L-12`), para `wasm32-unknown-unknown`.
//!
//! Una API C mínima sobre `spellbook`, sin wasm-bindgen: el lado JS
//! (`lib/ortografia/motor.ts`) escribe los textos en la memoria del módulo con
//! `reservar` y pasa puntero y largo. Así el `.wasm` queda chico (≈ 80 KB con
//! brotli) y no arrastra glue generado que haya que mantener sincronizado.
//!
//! Hay **varios diccionarios cargados a la vez** —español, inglés, italiano—, y
//! cada uno se identifica por el número que devuelve `cargar`. Qué hacer con
//! varios (una palabra está bien si lo está en alguno) lo decide el worker, no
//! el motor.
//!
//! Todas las cadenas son UTF-8. Si el JS mandara bytes inválidos se reemplazan
//! (`from_utf8_lossy`) en vez de confiar en ellos: un `unsafe` de menos que no
//! cuesta nada medible.

use spellbook::Dictionary;
use std::borrow::Cow;
use std::cell::RefCell;

thread_local! {
    /// Los diccionarios cargados; el índice es el identificador. Un hueco
    /// (`None`) es uno ya liberado: los números no se reutilizan.
    static DICCIONARIOS: RefCell<Vec<Option<Dictionary>>> = const { RefCell::new(Vec::new()) };
    /// Última salida de texto (`sugerir`): el JS la lee con `salida_largo`.
    static SALIDA: RefCell<Vec<u8>> = const { RefCell::new(Vec::new()) };
}

/// Reserva `largo` bytes en la memoria del módulo para que el JS escriba ahí.
#[no_mangle]
pub extern "C" fn reservar(largo: usize) -> *mut u8 {
    let mut v = Vec::<u8>::with_capacity(largo.max(1));
    let p = v.as_mut_ptr();
    std::mem::forget(v);
    p
}

/// Libera lo reservado con `reservar` (mismo largo).
///
/// # Safety
/// `p` tiene que venir de `reservar(largo)` y no haberse liberado antes.
#[no_mangle]
pub unsafe extern "C" fn liberar(p: *mut u8, largo: usize) {
    drop(Vec::from_raw_parts(p, 0, largo.max(1)));
}

unsafe fn texto<'a>(p: *const u8, n: usize) -> Cow<'a, str> {
    String::from_utf8_lossy(std::slice::from_raw_parts(p, n))
}

fn con_diccionario<T>(id: i32, f: impl FnOnce(&mut Dictionary) -> T) -> Option<T> {
    DICCIONARIOS.with(|d| {
        let mut d = d.borrow_mut();
        let dic = d.get_mut(usize::try_from(id).ok()?)?.as_mut()?;
        Some(f(dic))
    })
}

/// Carga un diccionario a partir del `.aff` y el `.dic`. Devuelve su número
/// (≥ 0), o -1 si no se pudo leer.
///
/// # Safety
/// Los punteros tienen que apuntar a `an` y `dn` bytes válidos.
#[no_mangle]
pub unsafe extern "C" fn cargar(ap: *const u8, an: usize, dp: *const u8, dn: usize) -> i32 {
    match Dictionary::new(&texto(ap, an), &texto(dp, dn)) {
        Ok(dic) => DICCIONARIOS.with(|d| {
            let mut d = d.borrow_mut();
            d.push(Some(dic));
            (d.len() - 1) as i32
        }),
        Err(_) => -1,
    }
}

/// Libera un diccionario. Un número desconocido no hace nada.
#[no_mangle]
pub extern "C" fn descargar(id: i32) {
    let Ok(i) = usize::try_from(id) else { return };
    DICCIONARIOS.with(|d| {
        if let Some(hueco) = d.borrow_mut().get_mut(i) {
            *hueco = None;
        }
    });
}

/// 1 si la palabra está bien escrita en ese diccionario, 0 si no, -1 si el
/// diccionario no existe.
///
/// # Safety
/// `p` tiene que apuntar a `n` bytes válidos.
#[no_mangle]
pub unsafe extern "C" fn revisar(id: i32, p: *const u8, n: usize) -> i32 {
    let palabra = texto(p, n);
    con_diccionario(id, |d| d.check(&palabra) as i32).unwrap_or(-1)
}

/// Sugerencias para la palabra, separadas por `\n`. Devuelve el puntero; el
/// largo se lee con `salida_largo`. Vale hasta la próxima llamada.
///
/// # Safety
/// `p` tiene que apuntar a `n` bytes válidos.
#[no_mangle]
pub unsafe extern "C" fn sugerir(id: i32, p: *const u8, n: usize) -> *const u8 {
    let palabra = texto(p, n);
    let mut v = Vec::new();
    con_diccionario(id, |d| d.suggest(&palabra, &mut v));
    SALIDA.with(|s| {
        let mut s = s.borrow_mut();
        *s = v.join("\n").into_bytes();
        s.as_ptr()
    })
}

/// Largo de la última salida de `sugerir`.
#[no_mangle]
pub extern "C" fn salida_largo() -> usize {
    SALIDA.with(|s| s.borrow().len())
}

/// Agrega una palabra al diccionario (el diccionario personal del vault). Sin
/// banderas: la palabra tal cual. Además de darla por buena, hace que
/// `sugerir` la proponga. Devuelve 1 si se agregó.
///
/// Una `/` separaría la palabra de sus banderas en el formato `.dic`, así que
/// una palabra con barra se rechaza en vez de interpretarse a medias.
///
/// # Safety
/// `p` tiene que apuntar a `n` bytes válidos.
#[no_mangle]
pub unsafe extern "C" fn agregar(id: i32, p: *const u8, n: usize) -> i32 {
    let palabra = texto(p, n);
    if palabra.is_empty() || palabra.contains('/') {
        return 0;
    }
    con_diccionario(id, |d| d.add(&palabra).is_ok() as i32).unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    const AFF: &str = "SET UTF-8\nSFX S Y 1\nSFX S 0 s .\n";
    const DIC: &str = "2\ncasa/S\nperro/S\n";

    fn con(s: &str, f: impl FnOnce(*const u8, usize) -> i32) -> i32 {
        f(s.as_ptr(), s.len())
    }

    #[test]
    fn carga_revisa_y_agrega() {
        let id = unsafe { cargar(AFF.as_ptr(), AFF.len(), DIC.as_ptr(), DIC.len()) };
        assert!(id >= 0);
        assert_eq!(con("casas", |p, n| unsafe { revisar(id, p, n) }), 1);
        assert_eq!(con("caza", |p, n| unsafe { revisar(id, p, n) }), 0);
        assert_eq!(con("mycelium", |p, n| unsafe { agregar(id, p, n) }), 1);
        assert_eq!(con("mycelium", |p, n| unsafe { revisar(id, p, n) }), 1);
        assert_eq!(con("a/b", |p, n| unsafe { agregar(id, p, n) }), 0);
        descargar(id);
        assert_eq!(con("casa", |p, n| unsafe { revisar(id, p, n) }), -1);
    }
}
