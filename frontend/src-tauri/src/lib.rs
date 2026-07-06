use tauri::menu::{MenuBuilder, MenuItemBuilder, SubmenuBuilder};
use tauri::Emitter;
use tauri_plugin_sql::{Migration, MigrationKind};

/// URL de la base local. `tauri-plugin-sql` la resuelve dentro del app-data dir
/// del SO. El frontend usa la MISMA URL con `Database.load()` para obtener la DB
/// ya migrada.
const DB_URL: &str = "sqlite:mycelium.db";

/// Menú nativo de la app. Los ítems propios emiten el evento `menu` con su id;
/// el frontend (`DesktopMenu`) los despacha a las acciones de los stores. Los
/// ítems predefinidos (deshacer/copiar/pegar…) los maneja el webview.
fn construir_menu(app: &tauri::App) -> tauri::Result<()> {
    let nueva_nota = MenuItemBuilder::new("Nueva nota")
        .id("nueva-nota")
        .accelerator("CmdOrCtrl+N")
        .build(app)?;
    let nueva_carpeta = MenuItemBuilder::new("Nueva carpeta")
        .id("nueva-carpeta")
        .accelerator("CmdOrCtrl+Shift+N")
        .build(app)?;
    let exportar_pdf = MenuItemBuilder::new("Exportar a PDF…")
        .id("exportar-pdf")
        .build(app)?;

    let archivo = SubmenuBuilder::new(app, "Archivo")
        .item(&nueva_nota)
        .item(&nueva_carpeta)
        .separator()
        .item(&exportar_pdf)
        .separator()
        .quit()
        .build()?;

    let editar = SubmenuBuilder::new(app, "Editar")
        .undo()
        .redo()
        .separator()
        .cut()
        .copy()
        .paste()
        .select_all()
        .build()?;

    let ver = SubmenuBuilder::new(app, "Ver")
        .text("toggle-explorador", "Explorador")
        .text("toggle-busqueda", "Búsqueda")
        .text("toggle-papelera", "Papelera")
        .separator()
        .text("toggle-izquierdo", "Alternar panel izquierdo")
        .text("toggle-derecho", "Alternar panel derecho")
        .build()?;

    let menu = MenuBuilder::new(app)
        .items(&[&archivo, &editar, &ver])
        .build()?;
    app.set_menu(menu)?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let migrations = vec![Migration {
        version: 1,
        description: "esquema inicial",
        sql: include_str!("../migrations/001_init.sql"),
        kind: MigrationKind::Up,
    }];

    tauri::Builder::default()
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations(DB_URL, migrations)
                .build(),
        )
        .setup(|app| {
            construir_menu(app)?;
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .on_menu_event(|app, event| {
            // Reenvía el id del ítem al frontend (evento `menu`).
            let _ = app.emit("menu", event.id().as_ref());
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
