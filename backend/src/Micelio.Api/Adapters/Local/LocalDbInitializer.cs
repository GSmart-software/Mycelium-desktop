using Micelio.Api.Ports;

namespace Micelio.Api.Adapters.Local;

/// <summary>
/// Crea el esquema SQLite local en el arranque (HU-39) desde
/// <c>backend/migrations/local/local_schema.sql</c> y siembra un usuario
/// pre-verificado con su vault personal para poder hacer login sin el flujo
/// de email (Resend no corre en local). Idempotente.
/// </summary>
public sealed class LocalDbInitializer(
    ID1Client d1,
    IConfiguration config,
    IHostEnvironment env,
    ILogger<LocalDbInitializer> logger) : IHostedService
{
    public const string SeedEmail = "dev@micelio.local";
    public const string SeedPassword = "micelio123";

    public async Task StartAsync(CancellationToken cancellationToken)
    {
        var schemaPath = config["Storage:Local:SchemaPath"]
            ?? Path.Combine(env.ContentRootPath, "..", "..", "migrations", "local", "local_schema.sql");
        schemaPath = Path.GetFullPath(schemaPath);

        if (!File.Exists(schemaPath))
        {
            throw new FileNotFoundException(
                $"No se encontró el esquema local en '{schemaPath}'. Configurar Storage:Local:SchemaPath.");
        }

        var schemaSql = await File.ReadAllTextAsync(schemaPath, cancellationToken);
        await d1.QueryAsync(schemaSql, ct: cancellationToken);
        logger.LogInformation("Modo local: esquema aplicado desde {SchemaPath}", schemaPath);

        await MigrateAsync(cancellationToken);
        await SeedAsync(cancellationToken);
    }

    public Task StopAsync(CancellationToken cancellationToken) => Task.CompletedTask;

    /// <summary>
    /// Migraciones idempotentes para bases ya existentes (SQLite no soporta
    /// ADD COLUMN IF NOT EXISTS). Si la columna ya existe, el ALTER falla y se
    /// ignora.
    /// </summary>
    private async Task MigrateAsync(CancellationToken ct)
    {
        try
        {
            await d1.QueryAsync(
                "ALTER TABLE notas ADD COLUMN tipo TEXT NOT NULL DEFAULT 'markdown'", ct: ct);
            logger.LogInformation("Modo local: columna notas.tipo agregada (migración).");
        }
        catch
        {
            // La columna ya existe: nada que hacer.
        }
    }

    private async Task SeedAsync(CancellationToken ct)
    {
        var existing = await d1.QueryAsync(
            "SELECT id FROM usuarios WHERE email = ?", [SeedEmail], ct);
        if (existing.Results.Count > 0)
        {
            return;
        }

        var userId = Guid.NewGuid().ToString();
        var vaultId = Guid.NewGuid().ToString();
        var now = DateTime.UtcNow.ToString("O");
        var passwordHash = BCrypt.Net.BCrypt.HashPassword(SeedPassword);

        await d1.BatchAsync(
        [
            new D1Statement(
                """
                INSERT INTO usuarios (id, email, nombre, password_hash, email_verificado, creado_en, actualizado_en)
                VALUES (?, ?, ?, ?, 1, ?, ?)
                """,
                [userId, SeedEmail, "Dev", passwordHash, now, now]),
            new D1Statement(
                "INSERT INTO vaults (id, nombre, propietario_id, creado_en) VALUES (?, ?, ?, ?)",
                [vaultId, "Mi vault", userId, now]),
            new D1Statement(
                """
                INSERT INTO membresias (id, usuario_id, recurso_tipo, recurso_id, rol, creado_en)
                VALUES (?, ?, 'vault', ?, 'propietario', ?)
                """,
                [Guid.NewGuid().ToString(), userId, vaultId, now]),
        ], ct);

        logger.LogInformation(
            "Modo local: usuario seed creado — {Email} / {Password}", SeedEmail, SeedPassword);
    }
}
