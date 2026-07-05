use tauri_plugin_sql::{Migration, MigrationKind};

/// URL de la base local. `tauri-plugin-sql` la resuelve dentro del app-data dir
/// del SO. El frontend usa la MISMA URL con `Database.load()` para obtener la DB
/// ya migrada.
const DB_URL: &str = "sqlite:mycelium.db";

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
