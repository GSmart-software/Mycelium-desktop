//! Watcher del "vault en carpeta" (fase 5 del vault en carpeta, solo-desktop).
//!
//! Observa la carpeta del vault abierto con un watcher nativo (crate `notify` vía
//! `notify-debouncer-full`) para reflejar en la UI los cambios hechos DESDE FUERA
//! de la app: editar un `.md` con otro editor, un `git pull`, una sincronización
//! (Syncthing/Dropbox), etc. Ante cambios emite el evento Tauri `vault-cambios`;
//! el frontend reindexa (incremental) y refresca el árbol/editor.
//!
//! No hay bucle de realimentación con la escritura de la app (fase 4). Cuando la
//! app escribe una nota a disco, el watcher dispara igual, pero el frontend solo
//! llama a `indexarVault`, que SOLO LEE archivos y actualiza el índice SQLite
//! —nunca escribe archivos— y además es incremental por `mtime`. Así el ciclo
//! "app escribe → watcher dispara → reindexa" termina en un reindex idempotente
//! (a lo sumo una relectura del archivo recién escrito), sin realimentación. Por
//! eso NO hace falta rastrear los propios escritos de la app.
//!
//! Carpetas en la nube (Dropbox/OneDrive/Drive): pueden generar ráfagas de
//! eventos y reindexados espurios. El debounce (~400 ms aquí, más ~300 ms en el
//! frontend) lo mitiga. No se ofrece todavía un interruptor para desactivar el
//! watcher (queda para fase 6/7); ver `docs/features/vault-en-carpeta.md`.

use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::Duration;

// `notify` no es dependencia directa: se usa el re-export de `notify-debouncer-full`
// para garantizar que los tipos coinciden con los del debouncer. `Watcher` (trait)
// hace falta en scope para el método `.watch()`.
use notify_debouncer_full::notify::{EventKind, RecursiveMode, Watcher};
use notify_debouncer_full::{
    new_debouncer, DebounceEventResult, Debouncer, FileIdCache, FileIdMap,
};
use tauri::{AppHandle, Emitter};

/// Debouncer activo (uno por vault). El tipo concreto que devuelve
/// `new_debouncer`: watcher recomendado del SO + caché de ids de archivo.
type VaultDebouncer = Debouncer<notify_debouncer_full::notify::RecommendedWatcher, FileIdMap>;

/// Estado gestionado por Tauri con el watcher activo (`None` cuando no hay vault
/// de carpeta abierto). Se reemplaza al cambiar de vault y se descarta al salir:
/// dropear el debouncer detiene la observación.
#[derive(Default)]
pub struct WatcherState(pub Mutex<Option<VaultDebouncer>>);

// Qué cuenta como nota del vault lo decide `archivos::es_importable`, la MISMA
// lista que usa el indexador. Antes había acá una copia con `.md` y `.excalidraw`
// que se quedó atrás al aparecer las bases (`FUN-L-03`) y los canvas
// (`FUN-L-18`): editarlos desde fuera no disparaba reindexado. Dos listas de
// extensiones separadas por medio archivo se desincronizan siempre.

/// Ruta relativa POSIX de `path` respecto a `base`, o `None` si no cuelga de la
/// base. El filtrado de ignorados lo hace el llamador con el `.mycignore`.
fn relativa_posix(base: &Path, path: &Path) -> Option<String> {
    let rel = path.strip_prefix(base).ok()?;
    Some(
        rel.components()
            .map(|c| c.as_os_str().to_string_lossy().to_string())
            .collect::<Vec<_>>()
            .join("/"),
    )
}

/// Arranca (o reemplaza) el watcher sobre `vault_ruta`. Observa recursivamente y,
/// tras el debounce, emite `vault-cambios` con las rutas relativas afectadas
/// (payload informativo: el frontend reindexa el vault entero de forma
/// incremental igualmente). Reemplaza cualquier watcher previo (cambio de vault).
#[tauri::command]
pub fn iniciar_watcher(
    app: AppHandle,
    state: tauri::State<WatcherState>,
    vault_ruta: String,
) -> Result<(), String> {
    let base = PathBuf::from(&vault_ruta);
    if !base.is_dir() {
        return Err(format!("La carpeta del vault no existe: {vault_ruta}"));
    }

    let app_handle = app.clone();
    let base_evt = base.clone();
    let mut debouncer = new_debouncer(
        Duration::from_millis(400),
        None,
        move |resultado: DebounceEventResult| {
            let eventos = match resultado {
                Ok(eventos) => eventos,
                // Errores del watcher (p. ej. overflow de la cola del SO): se
                // ignoran; el watcher es best-effort y la app sigue usable.
                Err(_errores) => return,
            };

            // Rutas relativas afectadas que son notas del vault. Los borrados se
            // dejan pasar aunque no tengan extensión de nota (pueden ser de una
            // carpeta entera, cuya desaparición también hay que reflejar). Qué se
            // ignora lo decide el `.mycignore` del vault (recargado por ráfaga:
            // el usuario puede editarlo en cualquier momento); un cambio del
            // PROPIO `.mycignore` también dispara reindex.
            let patrones = crate::mycignore::cargar(&base_evt);
            let mut rutas: Vec<String> = Vec::new();
            for evento in &eventos {
                let es_borrado = matches!(evento.kind, EventKind::Remove(_));
                for path in &evento.paths {
                    let Some(rel) = relativa_posix(&base_evt, path) else {
                        continue;
                    };
                    let es_mycignore = rel == crate::mycignore::ARCHIVO;
                    if !es_mycignore {
                        if !es_borrado && !crate::archivos::es_importable(path) {
                            continue;
                        }
                        if crate::mycignore::ignorada(&rel, path.is_dir(), &patrones) {
                            continue;
                        }
                    }
                    if !rutas.contains(&rel) {
                        rutas.push(rel);
                    }
                }
            }

            if !rutas.is_empty() {
                let _ = app_handle.emit("vault-cambios", rutas);
            }
        },
    )
    .map_err(|e| format!("No se pudo crear el watcher: {e}"))?;

    debouncer
        .watcher()
        .watch(&base, RecursiveMode::Recursive)
        .map_err(|e| format!("No se pudo observar {vault_ruta}: {e}"))?;
    // Caché de ids de archivo del debouncer: mejora el seguimiento de renombrados
    // cuando el SO no emite pares de eventos.
    //
    // El root se registra como NO recursivo a propósito (`DEF-052`). Con
    // `Recursive`, el crate recorre el árbol ENTERO con `WalkDir` y llama a
    // `get_file_id()` en cada entrada —una llamada al sistema por archivo y por
    // carpeta— **sin mirar el `.mycignore`**: entraba en `node_modules/`,
    // `target/` y `.git/`. Era, con diferencia, lo más lento de abrir un vault:
    // el indexador miraba 63 entradas y esto 1830.
    //
    // Se conserva el root (aunque sea a un nivel) porque `rescan()` —que el
    // debouncer llama cuando el SO pierde eventos— solo recorre lo registrado;
    // sin ningún root, tras un desbordamiento la caché quedaría muerta.
    debouncer
        .cache()
        .add_root(base.clone(), RecursiveMode::NonRecursive);
    // Y se puebla con lo que el vault mira de verdad: si `.mycignore` lo excluye,
    // no debe costar nada en ningún sitio.
    for ruta in crate::archivos::rutas_observables(&base) {
        debouncer.cache().add_path(&ruta);
    }

    // Reemplaza el watcher anterior: al asignar el nuevo, el previo se dropea y
    // deja de observar.
    *state
        .0
        .lock()
        .map_err(|_| "Estado del watcher no disponible".to_string())? = Some(debouncer);
    Ok(())
}

/// Detiene el watcher activo (al salir del vault). Dropear el debouncer detiene la
/// observación. Idempotente: si no había watcher, no hace nada.
#[tauri::command]
pub fn detener_watcher(state: tauri::State<WatcherState>) -> Result<(), String> {
    *state
        .0
        .lock()
        .map_err(|_| "Estado del watcher no disponible".to_string())? = None;
    Ok(())
}
