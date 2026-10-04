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
//! "app escribe → watcher dispara → reindexa" termina en un reindex idempotente,
//! sin realimentación.
//!
//! Aun así, ese reindex idempotente no era gratis (`FUN-M-38`): cada guardado
//! pagaba el recorrido del vault, una recarga del árbol y dos escaneos del grafo.
//! Por eso el evento lleva ahora el `mtime` de cada ruta: el frontend anota lo
//! que él mismo escribió (`escribir_nota` devuelve ese `mtime`) y, si la ráfaga
//! solo trae escrituras propias con el `mtime` que esperaba, no hace nada.
//!
//! Primero el árbol, después el índice (`FUN-M-42`): el evento dice además QUÉ
//! hay en cada ruta ahora —nota, otro archivo, carpeta o nada—, y de una carpeta
//! que aparece manda también su contenido. Con eso el frontend actualiza el
//! explorador apenas llega el evento, sin esperar al indexado, que va después y
//! solo sobre esas rutas. Por eso el debounce de acá es corto (`DEBOUNCE_MS`):
//! el largo, el que agrupa ráfagas para el índice, lo pone el frontend.
//!
//! Carpetas en la nube (Dropbox/OneDrive/Drive): pueden generar ráfagas de
//! eventos y reindexados espurios. El debounce del indexado (~300 ms en el
//! frontend, con tope de 1 s) lo mitiga. No se ofrece todavía un interruptor para desactivar el
//! watcher (queda para fase 6/7); ver `docs/features/vault-en-carpeta.md`.

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::Duration;

// `notify` no es dependencia directa: se usa el re-export de `notify-debouncer-full`
// para garantizar que los tipos coinciden con los del debouncer. `Watcher` (trait)
// hace falta en scope para el método `.watch()`.
use notify_debouncer_full::notify::event::ModifyKind;
use notify_debouncer_full::notify::{EventKind, RecursiveMode, Watcher};
use notify_debouncer_full::{
    new_debouncer, DebounceEventResult, Debouncer, FileIdCache, FileIdMap,
};
use tauri::Emitter;

/// Debounce del watcher nativo (`FUN-M-42`). Era de 400 ms y lo pagaba el
/// explorador entero: a eso se sumaban los 300 ms del frontend y el indexado
/// completo antes de que un archivo nuevo apareciera. Ahora el árbol se
/// actualiza con el evento mismo, así que acá solo hace falta juntar lo que el
/// SO entrega de a pedazos (el par de un renombrado, la creación y la primera
/// escritura de un archivo). El que agrupa ráfagas para el índice es el del
/// frontend (`lib/vaultWatch.ts`).
const DEBOUNCE_MS: u64 = 60;

/// Debouncer activo (uno por vault). El tipo concreto que devuelve
/// `new_debouncer`: watcher recomendado del SO + caché de ids de archivo.
type VaultDebouncer = Debouncer<notify_debouncer_full::notify::RecommendedWatcher, FileIdMap>;

/// Watchers activos, **uno por ventana** (`FUN-L-16`).
///
/// Antes era un `Option` único para toda la app, y con varias ventanas abiertas
/// la segunda le robaba el watcher a la primera: esa dejaba de enterarse de los
/// cambios de su propia carpeta sin ningún aviso. La clave es la etiqueta de la
/// ventana, que es lo que Tauri garantiza único.
///
/// Dropear un debouncer detiene su observación, así que quitar la entrada del
/// mapa es todo lo que hace falta para parar.
#[derive(Default)]
pub struct WatcherState(pub Mutex<HashMap<String, VaultDebouncer>>);

// Qué pasa el filtro lo decide `es_relevante` (`DEF-127`). Antes se dejaban
// pasar solo las notas (`archivos::es_importable`) y los borrados: una imagen,
// un PDF o una carpeta agregados desde fuera nunca llegaban al frontend y no
// aparecían en el explorador hasta que otra cosa disparara un reindexado. Ahora
// pasa toda ruta que el vault mira de verdad —la que no ignora el `.mycignore`,
// el MISMO criterio de `archivos::recorrer_vault`—, menos el ruido conocido.

/// ¿Este cambio del watcher le importa al vault? Función pura (`DEF-127`).
///
/// - La raíz misma (`rel` vacía) no: su `Modify` acompaña a cualquier cambio de
///   primer nivel, que ya llega por su propia ruta.
/// - El `.mycignore` sí, siempre: cambia qué se ignora y obliga a reindexar.
/// - Los accesos (`Access`) no: no cambian nada en disco.
/// - Los temporales conocidos (`archivos::es_temporal`: `~$*`, `*.tmp`,
///   `*.crdownload`, `*.part`, `.~lock.*#`) no, ni al crearse ni al borrarse:
///   el recorrido tampoco los lista, así que no hay nada que refrescar.
/// - El `Modify` de contenido de una CARPETA no. Windows lo emite sobre la
///   carpeta cada vez que cambia algo dentro, y ese cambio ya llega por la ruta
///   del archivo. Si pasara, cada guardado de la propia app traería en la ráfaga
///   una ruta ajena (la carpeta) y el frontend ya no podría descartarla como
///   escritura propia (`FUN-M-38`). Crear, borrar y renombrar una carpeta sí
///   pasan.
/// - Lo ignorado por el `.mycignore` no (y `.mycelium/` lo está siempre: ahí
///   escribe la app su estado, y dejarlo pasar abriría un bucle).
fn es_relevante(
    kind: &EventKind,
    rel: &str,
    es_dir: bool,
    patrones: &[crate::mycignore::Patron],
) -> bool {
    if rel.is_empty() {
        return false;
    }
    if rel == crate::mycignore::ARCHIVO {
        return true;
    }
    if matches!(kind, EventKind::Access(_)) {
        return false;
    }
    let nombre = rel.rsplit('/').next().unwrap_or(rel);
    if !es_dir && crate::archivos::es_temporal(nombre) {
        return false;
    }
    if es_dir && matches!(kind, EventKind::Modify(m) if !matches!(m, ModifyKind::Name(_))) {
        return false;
    }
    !crate::mycignore::ignorada(rel, es_dir, patrones)
}

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

/// Una ruta afectada por una ráfaga del watcher, con el `mtime` que tiene en
/// disco al emitir el evento (0 si ya no existe o el SO no lo expone). Con él
/// el frontend distingue un guardado propio de un cambio externo (`FUN-M-38`).
///
/// `estado` y `tipo` (`FUN-M-42`) dicen qué hay AHORA en la ruta, que es todo lo
/// que el explorador necesita para actualizarse sin esperar al índice:
///
/// - `"nota"`: un archivo que se indexa; `tipo` es el de la nota (`markdown`,
///   `excalidraw`, `base`, `canvas`, `drawio`), el mismo de `recorrer_vault`.
/// - `"otro"`: cualquier otro archivo; `tipo` es su extensión en minúsculas.
/// - `"carpeta"`: un directorio; `tipo` vacío.
/// - `"ausente"`: ya no hay nada (borrado, o el origen de un renombrado). No se
///   sabe si era carpeta: el frontend quita la ruta y todo lo que cuelgue de ella.
///
/// No hay un «renombrado»: el origen llega `ausente` y el destino con lo que es.
#[derive(serde::Serialize, Clone, Debug, PartialEq)]
pub struct CambioVault {
    pub ruta: String,
    pub mtime: i64,
    pub estado: &'static str,
    pub tipo: String,
}

/// Agrega a `out` lo que hay en `path` (ruta relativa `rel`) y, si es una
/// carpeta, todo lo que contiene y el vault no ignora (`FUN-M-42`).
///
/// La expansión hace falta porque el SO no avisa del contenido de una carpeta
/// que entra **renombrada o movida** —desde otra carpeta del vault, o desde
/// fuera—: solo emite el evento de la carpeta. Sin ella, el explorador mostraría
/// la carpeta vacía hasta el próximo recorrido. Usa el MISMO recorrido que el
/// índice (`archivos::recorrer_todo`), así que el `.mycignore` y los temporales
/// se aplican igual. Best-effort: lo que no se pueda leer se omite.
///
/// `vistos` evita repetir rutas: una carpeta copiada trae además un evento por
/// cada archivo.
fn describir(
    base: &Path,
    path: &Path,
    rel: String,
    patrones: &[crate::mycignore::Patron],
    vistos: &mut HashSet<String>,
    out: &mut Vec<CambioVault>,
) {
    if !vistos.insert(rel.clone()) {
        return;
    }
    // El `mtime` de AHORA, no el del evento: es lo que hay en disco cuando el
    // frontend va a decidir, y lo que `escribir_nota` le devolvió si fue la app
    // quien escribió.
    let Ok(meta) = std::fs::metadata(path) else {
        out.push(CambioVault { ruta: rel, mtime: 0, estado: "ausente", tipo: String::new() });
        return;
    };
    let mtime = crate::archivos::mtime_ms(&meta);
    if !meta.is_dir() {
        let (estado, tipo) = if crate::archivos::es_importable(path) {
            ("nota", crate::archivos::tipo_de(path))
        } else {
            ("otro", crate::archivos::extension_de(path))
        };
        out.push(CambioVault { ruta: rel, mtime, estado, tipo });
        return;
    }
    out.push(CambioVault { ruta: rel, mtime, estado: "carpeta", tipo: String::new() });
    let mut contenido = crate::archivos::RecorridoVault::default();
    let _ = crate::archivos::recorrer_todo(path, base, patrones, &mut contenido);
    for dir in contenido.directorios {
        if vistos.insert(dir.clone()) {
            out.push(CambioVault { ruta: dir, mtime: 0, estado: "carpeta", tipo: String::new() });
        }
    }
    for a in contenido.archivos_meta {
        if vistos.insert(a.ruta_relativa.clone()) {
            out.push(CambioVault { ruta: a.ruta_relativa, mtime: a.mtime, estado: "nota", tipo: a.tipo });
        }
    }
    for a in contenido.otros {
        if vistos.insert(a.ruta_relativa.clone()) {
            out.push(CambioVault { ruta: a.ruta_relativa, mtime: a.mtime, estado: "otro", tipo: a.tipo });
        }
    }
}

/// Arranca (o reemplaza) el watcher sobre `vault_ruta`. Observa recursivamente y,
/// tras el debounce, emite `vault-cambios` con las rutas relativas afectadas y
/// su `mtime` actual. El frontend decide si hay algo ajeno que reindexar; si lo
/// hay, reindexa el vault entero de forma incremental. Reemplaza cualquier
/// watcher previo (cambio de vault).
#[tauri::command]
pub fn iniciar_watcher(
    ventana: tauri::Window,
    state: tauri::State<WatcherState>,
    vault_ruta: String,
) -> Result<(), String> {
    let base = PathBuf::from(&vault_ruta);
    if !base.is_dir() {
        return Err(format!("La carpeta del vault no existe: {vault_ruta}"));
    }

    // El evento va a ESTA ventana, no a todas (`FUN-L-16`): con `app.emit` cada
    // ventana recibía los cambios de la carpeta de las demás y reindexaba la suya
    // sin motivo.
    let destino = ventana.clone();
    let base_evt = base.clone();
    let mut debouncer = new_debouncer(
        Duration::from_millis(DEBOUNCE_MS),
        None,
        move |resultado: DebounceEventResult| {
            let eventos = match resultado {
                Ok(eventos) => eventos,
                // Errores del watcher (p. ej. overflow de la cola del SO): se
                // ignoran; el watcher es best-effort y la app sigue usable.
                Err(_errores) => return,
            };

            // Rutas relativas afectadas que le importan al vault: toda la que no
            // ignora el `.mycignore`, de cualquier tipo, carpetas incluidas
            // (`DEF-127`; ver `es_relevante`). El `.mycignore` se recarga por
            // ráfaga: el usuario puede editarlo en cualquier momento.
            let patrones = crate::mycignore::cargar(&base_evt);
            let mut cambios: Vec<CambioVault> = Vec::new();
            let mut vistos: HashSet<String> = HashSet::new();
            for evento in &eventos {
                for path in &evento.paths {
                    let Some(rel) = relativa_posix(&base_evt, path) else {
                        continue;
                    };
                    // Lo borrado ya no existe y `is_dir()` da `false`: una carpeta
                    // borrada se evalúa como archivo, lo que solo afecta a los
                    // patrones `nombre/` (que la ignorarían) y a los temporales.
                    if !es_relevante(&evento.kind, &rel, path.is_dir(), &patrones) {
                        continue;
                    }
                    describir(&base_evt, path, rel, &patrones, &mut vistos, &mut cambios);
                }
            }

            if !cambios.is_empty() {
                let _ = destino.emit("vault-cambios", cambios);
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

    // Reemplaza el watcher anterior DE ESTA VENTANA: al insertar, el previo se
    // dropea y deja de observar. Los de las demás ventanas no se tocan.
    state
        .0
        .lock()
        .map_err(|_| "Estado del watcher no disponible".to_string())?
        .insert(ventana.label().to_string(), debouncer);
    Ok(())
}

/// Detiene el watcher de esta ventana (al salir del vault). Dropear el debouncer
/// detiene la observación. Idempotente: si no había, no hace nada.
#[tauri::command]
pub fn detener_watcher(
    ventana: tauri::Window,
    state: tauri::State<WatcherState>,
) -> Result<(), String> {
    detener_de(&state, ventana.label());
    Ok(())
}

/// Detiene el watcher de una ventana por su etiqueta. Lo usa además el cierre de
/// ventana, donde ya no hay un `Window` del que partir.
pub fn detener_de(state: &WatcherState, label: &str) {
    if let Ok(mut mapa) = state.0.lock() {
        mapa.remove(label);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use notify_debouncer_full::notify::event::{
        AccessKind, CreateKind, DataChange, RemoveKind, RenameMode,
    };

    fn crear() -> EventKind {
        EventKind::Create(CreateKind::Any)
    }
    fn modificar() -> EventKind {
        EventKind::Modify(ModifyKind::Data(DataChange::Any))
    }
    fn renombrar() -> EventKind {
        EventKind::Modify(ModifyKind::Name(RenameMode::Any))
    }
    fn borrar() -> EventKind {
        EventKind::Remove(RemoveKind::Any)
    }
    /// El default de `mycignore` (sin archivo en el vault).
    fn por_defecto() -> Vec<crate::mycignore::Patron> {
        crate::mycignore::parsear(".*/\nnode_modules/\ntarget/\ndist/\nout/")
    }

    /// `DEF-127`: lo que no es nota también llega al frontend.
    #[test]
    fn deja_pasar_archivos_de_cualquier_tipo_y_carpetas() {
        let p = por_defecto();
        assert!(es_relevante(&crear(), "imagenes/foto.png", false, &p));
        assert!(es_relevante(&crear(), "doc.pdf", false, &p));
        assert!(es_relevante(&modificar(), "datos.csv", false, &p));
        assert!(es_relevante(&crear(), "sin-extension", false, &p));
        assert!(es_relevante(&crear(), "Carpeta nueva", true, &p));
        assert!(es_relevante(&renombrar(), "Otra carpeta", true, &p));
        assert!(es_relevante(&borrar(), "vieja", false, &p));
        // Las notas, como siempre.
        assert!(es_relevante(&modificar(), "notas/a.md", false, &p));
    }

    #[test]
    fn descarta_lo_ignorado_por_el_mycignore_y_mycelium_siempre() {
        let p = por_defecto();
        assert!(!es_relevante(&crear(), ".git/objects/ab", false, &p));
        assert!(!es_relevante(&crear(), "node_modules/x/y.js", false, &p));
        assert!(!es_relevante(&crear(), ".obsidian", true, &p));
        // `.mycelium/` aunque el `.mycignore` no lo nombre: ahí escribe la app.
        let vacio = crate::mycignore::parsear("");
        assert!(!es_relevante(&modificar(), ".mycelium/papelera.json", false, &vacio));
        // Un patrón del usuario vale para cualquier tipo de archivo.
        let propio = crate::mycignore::parsear("*.log");
        assert!(!es_relevante(&crear(), "salida.log", false, &propio));
        // El `.mycignore` mismo siempre pasa.
        assert!(es_relevante(&modificar(), ".mycignore", false, &p));
    }

    #[test]
    fn descarta_los_temporales_conocidos() {
        let p = por_defecto();
        for rel in [
            "docs/~$informe.docx",
            "x.tmp",
            "BAJADA.TMP",
            "video.mp4.crdownload",
            "pelicula.mkv.part",
            "carpeta/.~lock.planilla.ods#",
        ] {
            assert!(!es_relevante(&crear(), rel, false, &p), "{rel} es temporal");
            assert!(!es_relevante(&borrar(), rel, false, &p), "{rel} es temporal");
        }
        // Parecidos que NO son temporales.
        assert!(es_relevante(&crear(), "tmp/foto.png", false, &p));
        assert!(es_relevante(&crear(), "partes.md", false, &p));
        assert!(es_relevante(&crear(), "plantilla.tmpl", false, &p));
    }

    /// El `Modify` de una carpeta (Windows lo emite al cambiar su contenido) no
    /// debe colarse en la ráfaga de un guardado propio (`FUN-M-38`).
    #[test]
    fn descarta_el_modify_de_contenido_de_una_carpeta_y_la_raiz() {
        let p = por_defecto();
        assert!(!es_relevante(&modificar(), "notas", true, &p));
        assert!(!es_relevante(&EventKind::Modify(ModifyKind::Any), "notas/sub", true, &p));
        assert!(!es_relevante(&crear(), "", true, &p));
        assert!(!es_relevante(&EventKind::Access(AccessKind::Any), "a.md", false, &p));
    }

    /// El temporal de la escritura atómica de la propia app (`nota.md.tmp-<pid>`)
    /// no debe llegar: arruinaba el descarte de los guardados propios (`FUN-M-42`).
    #[test]
    fn descarta_el_temporal_de_la_escritura_atomica_propia() {
        let p = por_defecto();
        assert!(!es_relevante(&crear(), "notas/plan.md.tmp-12345", false, &p));
        assert!(!es_relevante(&borrar(), "dibujo.excalidraw.tmp-9", false, &p));
        // Parecidos que NO lo son.
        assert!(es_relevante(&crear(), "informe.tmp-final.md", false, &p));
        assert!(es_relevante(&crear(), "x.tmp-", false, &p));
    }

    fn vault_temporal(nombre: &str) -> PathBuf {
        let base = std::env::temp_dir().join(format!("mycelium-watch-{nombre}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&base);
        std::fs::create_dir_all(&base).unwrap();
        base
    }

    fn describir_rutas(base: &Path, rels: &[&str]) -> Vec<CambioVault> {
        let p = por_defecto();
        let mut vistos = HashSet::new();
        let mut out = Vec::new();
        for rel in rels {
            describir(base, &base.join(rel), rel.to_string(), &p, &mut vistos, &mut out);
        }
        out
    }

    /// `FUN-M-42`: el evento dice qué hay en cada ruta, y una carpeta que aparece
    /// trae su contenido (el SO no avisa del contenido de una carpeta movida).
    #[test]
    fn describe_cada_ruta_y_expande_las_carpetas_que_aparecen() {
        let base = vault_temporal("describir");
        std::fs::create_dir_all(base.join("Movida/sub")).unwrap();
        std::fs::create_dir_all(base.join("Movida/.git")).unwrap();
        std::fs::write(base.join("Movida/uno.md"), "#").unwrap();
        std::fs::write(base.join("Movida/sub/foto.PNG"), [0u8]).unwrap();
        std::fs::write(base.join("Movida/sub/red.drawio"), "<mxfile/>").unwrap();
        std::fs::write(base.join("Movida/.git/HEAD"), "x").unwrap();
        std::fs::write(base.join("Movida/~$abierto.docx"), "x").unwrap();
        std::fs::write(base.join("suelta.pdf"), "x").unwrap();

        // La carpeta llega una vez aunque el SO también avise de un hijo.
        let cambios = describir_rutas(&base, &["Movida", "Movida/uno.md", "suelta.pdf", "Borrada"]);
        let resumen: Vec<(String, &str, String)> = cambios
            .iter()
            .map(|c| (c.ruta.clone(), c.estado, c.tipo.clone()))
            .collect();
        let tiene = |ruta: &str, estado: &str, tipo: &str| {
            resumen.iter().any(|(r, e, t)| r == ruta && *e == estado && t == tipo)
        };
        assert!(tiene("Movida", "carpeta", ""), "{resumen:?}");
        assert!(tiene("Movida/sub", "carpeta", ""), "{resumen:?}");
        assert!(tiene("Movida/uno.md", "nota", "markdown"), "{resumen:?}");
        assert!(tiene("Movida/sub/red.drawio", "nota", "drawio"), "{resumen:?}");
        assert!(tiene("Movida/sub/foto.PNG", "otro", "png"), "{resumen:?}");
        assert!(tiene("suelta.pdf", "otro", "pdf"), "{resumen:?}");
        assert!(tiene("Borrada", "ausente", ""), "{resumen:?}");
        // Ni lo ignorado por el `.mycignore` ni los temporales, ni repetidos.
        assert!(!resumen.iter().any(|(r, _, _)| r.contains(".git") || r.contains("~$")), "{resumen:?}");
        assert_eq!(resumen.iter().filter(|(r, _, _)| r == "Movida/uno.md").count(), 1);
        assert_eq!(cambios.len(), 7, "{resumen:?}");
        // Los archivos llevan su `mtime` real (para `esEscrituraPropia`).
        assert!(cambios.iter().find(|c| c.ruta == "Movida/uno.md").unwrap().mtime > 0);
        let _ = std::fs::remove_dir_all(&base);
    }

    /// Medición, no prueba: cuánto tarda el watcher, con el debounce de acá, en
    /// avisar de un archivo creado (`FUN-M-42`). Se corre a mano:
    ///
    /// `cargo test --lib vault_watch::tests::medir_latencia -- --ignored --nocapture`
    #[test]
    #[ignore]
    fn medir_latencia() {
        use std::sync::mpsc;
        use std::time::Instant;
        let base = vault_temporal("latencia");
        for debounce in [400u64, DEBOUNCE_MS] {
            let (tx, rx) = mpsc::channel::<Instant>();
            let mut debouncer = new_debouncer(
                Duration::from_millis(debounce),
                None,
                move |r: DebounceEventResult| {
                    if r.map(|e| !e.is_empty()).unwrap_or(false) {
                        let _ = tx.send(Instant::now());
                    }
                },
            )
            .unwrap();
            debouncer.watcher().watch(&base, RecursiveMode::Recursive).unwrap();
            std::thread::sleep(Duration::from_millis(200));
            let mut muestras = Vec::new();
            for i in 0..10 {
                while rx.try_recv().is_ok() {}
                let inicio = Instant::now();
                std::fs::write(base.join(format!("n-{debounce}-{i}.png")), [0u8]).unwrap();
                let llegada = rx.recv_timeout(Duration::from_secs(5)).unwrap();
                muestras.push(llegada.duration_since(inicio).as_millis());
                std::thread::sleep(Duration::from_millis(debounce + 100));
            }
            muestras.sort();
            println!("debounce {debounce} ms → latencia mediana {} ms, máx {} ms", muestras[5], muestras[9]);
        }
        let _ = std::fs::remove_dir_all(&base);
    }
}
