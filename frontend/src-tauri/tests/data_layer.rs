// Smoke test headless del data layer del desktop (spike fase 0): aplica la MISMA
// migración que usa la app y ejecuta el ciclo núcleo — crear nota, guardar
// contenido, reindexar FTS, buscar por prefijo, leer de vuelta y consultar el
// árbol — contra el SQLite de sqlx (idéntico al de tauri-plugin-sql).
use sqlx::sqlite::SqlitePoolOptions;
use sqlx::Row;

const SCHEMA: &str = include_str!("../migrations/001_init.sql");
const NOW: &str = "2026-07-05T00:00:00Z";

#[tokio::test]
async fn ciclo_nucleo_datos() {
    // max_connections(1): una sola conexión → una sola DB in-memory compartida.
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect("sqlite::memory:")
        .await
        .expect("conectar sqlite");

    // Aplica el esquema completo (incluye la tabla virtual FTS5 y las FKs).
    sqlx::raw_sql(SCHEMA).execute(&pool).await.expect("aplicar esquema");

    // Seed usuario + vault (auth latente).
    sqlx::query(
        "INSERT INTO usuarios (id,email,nombre,email_verificado,tema,modo_oscuro,creado_en,actualizado_en) \
         VALUES (?,?,?,?,?,?,?,?)",
    )
    .bind("u1").bind("dev@micelio.local").bind("Dev").bind(1)
    .bind("bioluminiscencia").bind(1).bind(NOW).bind(NOW)
    .execute(&pool).await.expect("seed usuario");

    sqlx::query("INSERT INTO vaults (id,nombre,propietario_id,creado_en) VALUES (?,?,?,?)")
        .bind("v1").bind("Mi Vault").bind("u1").bind(NOW)
        .execute(&pool).await.expect("seed vault");

    // Crear nota en la raíz del vault.
    sqlx::query(
        "INSERT INTO notas (id,vault_id,carpeta_id,titulo,tipo,tamano_bytes,creado_en,actualizado_en) \
         VALUES (?,?,?,?,?,?,?,?)",
    )
    .bind("n1").bind("v1").bind(Option::<String>::None).bind("Perro")
    .bind("markdown").bind(0).bind(NOW).bind(NOW)
    .execute(&pool).await.expect("crear nota");

    // Guardar contenido + reindex FTS (delete+insert), como hace putContenido.
    let contenido = "El perro corre en el parque al amanecer";
    sqlx::query("INSERT INTO contenidos (nota_id,contenido,actualizado_en) VALUES (?,?,?)")
        .bind("n1").bind(contenido).bind(NOW)
        .execute(&pool).await.expect("guardar contenido");
    sqlx::query("DELETE FROM notas_fts WHERE nota_id = ?")
        .bind("n1").execute(&pool).await.expect("fts delete");
    sqlx::query("INSERT INTO notas_fts (nota_id,titulo,contenido) VALUES (?,?,?)")
        .bind("n1").bind("Perro").bind(contenido)
        .execute(&pool).await.expect("fts insert");

    // Leer contenido de vuelta.
    let leido: String = sqlx::query("SELECT contenido FROM contenidos WHERE nota_id = ?")
        .bind("n1").fetch_one(&pool).await.expect("leer contenido").get("contenido");
    assert_eq!(leido, contenido);

    // Búsqueda por coincidencia (prefijo): "perr"* debe encontrar la nota.
    let hits: i64 = sqlx::query("SELECT count(*) AS n FROM notas_fts WHERE notas_fts MATCH ?")
        .bind(r#""perr"*"#).fetch_one(&pool).await.expect("buscar").get("n");
    assert_eq!(hits, 1, "el prefijo 'perr' deberia encontrar la nota");

    // Búsqueda exacta de una palabra que no está como token completo: 0 resultados.
    let hits_exacto: i64 = sqlx::query("SELECT count(*) AS n FROM notas_fts WHERE notas_fts MATCH ?")
        .bind("gato").fetch_one(&pool).await.expect("buscar exacto").get("n");
    assert_eq!(hits_exacto, 0);

    // Árbol: la nota cuelga del vault.
    let en_vault: i64 = sqlx::query("SELECT count(*) AS n FROM notas WHERE vault_id = ?")
        .bind("v1").fetch_one(&pool).await.expect("tree").get("n");
    assert_eq!(en_vault, 1);
}
