use std::sync::Mutex;

use tauri::Manager;
use tauri_plugin_sql::{Migration, MigrationKind};

mod actualizador;
mod archivos;
mod mycignore;
mod terminal;
mod vault_config;
mod vault_fs;
mod vault_watch;
mod ventanas;

/// URL de la base local. `tauri-plugin-sql` la resuelve dentro del app-data dir
/// del SO. El frontend usa la MISMA URL con `Database.load()` para obtener la DB
/// ya migrada.
const DB_URL: &str = "sqlite:mycelium.db";

// Sin menú nativo: todas las acciones (nueva nota/carpeta, buscar, alternar
// paneles, exportar) ya existen en la propia UI, así que no se añade barra de
// menú del SO (evita duplicar la interfaz).

/// Archivo abierto desde el SO (doble clic / "Abrir con"), leído en Rust y
/// entregado al frontend para importarlo al vault.
#[derive(Clone, serde::Serialize)]
struct OpenedFile {
    name: String,
    content: String,
    tipo: String,
}

/// Rutas de archivo pendientes del lanzamiento inicial (las drena el frontend
/// vía `take_opened_files` cuando ya tiene el vault cargado).
struct Pending(Mutex<Vec<String>>);

fn es_nota(path: &str) -> bool {
    let p = path.to_ascii_lowercase();
    p.ends_with(".md") || p.ends_with(".excalidraw")
}

/// Lee un archivo de nota del disco y lo convierte en `OpenedFile`.
fn leer_archivo(path: &str) -> Option<OpenedFile> {
    let content = std::fs::read_to_string(path).ok()?;
    let stem = std::path::Path::new(path).file_stem()?.to_string_lossy().to_string();
    let tipo = if path.to_ascii_lowercase().ends_with(".excalidraw") {
        "excalidraw"
    } else {
        "markdown"
    };
    Some(OpenedFile { name: stem, content, tipo: tipo.to_string() })
}

/// Rutas de nota presentes en los argumentos de línea de comandos (arg0 aparte).
fn args_de_nota(argv: &[String]) -> Vec<String> {
    argv.iter().skip(1).filter(|a| es_nota(a)).cloned().collect()
}

/// El frontend drena aquí los archivos del lanzamiento inicial (ya leídos).
#[tauri::command]
fn take_opened_files(state: tauri::State<Pending>) -> Vec<OpenedFile> {
    let paths: Vec<String> = state.0.lock().unwrap().drain(..).collect();
    paths.iter().filter_map(|p| leer_archivo(p)).collect()
}

/// A qué ventana entregarle un archivo abierto desde el SO: la que tiene el foco,
/// y si ninguna lo tiene, la principal o cualquiera que quede.
///
/// Importa **una** y no todas: el receptor del evento (`FileOpenBridge`) importa
/// el archivo al vault de su ventana, así que emitirlo a todas metería una copia
/// en cada vault abierto (`FUN-L-16`).
#[cfg(desktop)]
fn ventana_para_abrir<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
) -> Option<tauri::WebviewWindow<R>> {
    let ventanas = app.webview_windows();
    ventanas
        .values()
        .find(|w| w.is_focused().unwrap_or(false))
        .or_else(|| ventanas.get("main"))
        .or_else(|| ventanas.values().next())
        .cloned()
}

/// Abre/cierra las herramientas de desarrollador del webview. Disponible también
/// en las builds de producción gracias a la feature `devtools` del crate `tauri`
/// (sin ella, estas APIs solo existen con `debug_assertions`). El frontend lo
/// invoca con F12 / Ctrl+Shift+I: sirve para escribir CSS propio y depurar.
#[tauri::command]
fn alternar_devtools(webview: tauri::WebviewWindow) {
    if webview.is_devtools_open() {
        webview.close_devtools();
    } else {
        webview.open_devtools();
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let migrations = vec![Migration {
        version: 1,
        description: "esquema inicial",
        sql: include_str!("../migrations/001_init.sql"),
        kind: MigrationKind::Up,
    }];

    let pendientes: Vec<String> = args_de_nota(&std::env::args().collect::<Vec<_>>());

    let mut builder = tauri::Builder::default();

    // Instancia única: un segundo lanzamiento (p. ej. doble clic en otro archivo)
    // reenvía su argv a la instancia viva y le enfoca la ventana, en vez de abrir
    // otro Mycelium. Es lo que hace que las asociaciones de archivo abran la nota
    // donde ya estás, y desde `FUN-L-16` además sostiene la garantía de «un vault
    // en una sola ventana»: `VentanasState` vive en el proceso, así que con dos
    // procesos habría dos indexadores escribiendo el mismo índice.
    //
    // **En desarrollo no se registra**, y a propósito: el mutex del plugin se
    // nombra solo con el `identifier`, así que el binario de desarrollo y el
    // instalado se excluirían entre sí y no se podría tener Mycelium abierto
    // mientras se lo desarrolla. Perder la instancia única ahí no cuesta nada:
    // las asociaciones de archivo apuntan al ejecutable instalado, no a este.
    #[cfg(desktop)]
    if !tauri::is_dev() {
        use tauri::Emitter;
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            let destino = ventana_para_abrir(app);
            let archivos: Vec<OpenedFile> =
                args_de_nota(&argv).iter().filter_map(|p| leer_archivo(p)).collect();
            if let Some(win) = destino {
                if !archivos.is_empty() {
                    let _ = win.emit("open-files", archivos);
                }
                let _ = win.unminimize();
                let _ = win.set_focus();
            }
        }));
    }

    builder
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations(DB_URL, migrations)
                .build(),
        )
        .plugin(tauri_plugin_dialog::init())
        // Autoactualización (FUN-L-14). El plugin se registra SIEMPRE: la
        // decisión de si se puede actualizar o no la toma `actualizador.rs`
        // leyendo la config compilada, así que sin claves la app arranca igual
        // y solo queda el updater desactivado con su motivo a la vista.
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(Pending(Mutex::new(pendientes)))
        .manage(vault_watch::WatcherState::default())
        .manage(terminal::TerminalesState::default())
        .manage(actualizador::DescargaState::default())
        .manage(ventanas::VentanasState::default())
        // Al cerrarse una ventana hay que soltar lo suyo (`FUN-L-16`): su
        // watcher, sus terminales y el vault que tenía abierto. Sin esto el vault
        // quedaría marcado como abierto para siempre —no se podría reabrir en
        // ninguna ventana— y sus shells seguirían vivas sin nadie que las lea.
        .on_window_event(|ventana, evento| {
            if matches!(evento, tauri::WindowEvent::Destroyed) {
                ventanas::al_cerrar(ventana.app_handle(), ventana.label());
            }
        })
        .invoke_handler(tauri::generate_handler![
            take_opened_files,
            alternar_devtools,
            terminal::terminal_shells,
            terminal::terminal_abrir,
            terminal::terminal_escribir,
            terminal::terminal_redimensionar,
            terminal::terminal_cerrar,
            archivos::exportar_a_carpeta,
            archivos::leer_carpeta,
            archivos::listar_archivos_meta,
            archivos::leer_archivos,
            archivos::listar_directorios,
            archivos::carpeta_no_vacia,
            ventanas::registrar_vault,
            ventanas::soltar_vault,
            ventanas::abrir_vault_en_ventana,
            vault_config::listar_vaults,
            vault_config::vincular_vault,
            vault_config::desvincular_vault,
            vault_config::get_abrir_ultimo,
            vault_config::set_abrir_ultimo,
            vault_config::marcar_acceso,
            vault_fs::escribir_nota,
            vault_fs::mover_ruta,
            vault_fs::crear_directorio,
            vault_fs::copiar_archivo,
            vault_fs::borrar_a_papelera,
            vault_fs::restaurar_de_papelera,
            vault_fs::borrar_definitivo,
            vault_fs::leer_archivo_texto,
            vault_fs::revelar_en_sistema,
            vault_watch::iniciar_watcher,
            vault_watch::detener_watcher,
            actualizador::updater_estado,
            actualizador::updater_set_auto,
            actualizador::updater_set_avanzado,
            actualizador::updater_set_endpoint,
            actualizador::updater_omitir_version,
            actualizador::updater_fijar_version,
            actualizador::updater_marcar_comprobacion,
            actualizador::updater_buscar,
            actualizador::updater_versiones,
            actualizador::updater_descargar,
            actualizador::updater_instalar,
            actualizador::updater_descartar
        ])
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
