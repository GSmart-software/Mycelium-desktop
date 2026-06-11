using Micelio.Api.Adapters.Local;
using Micelio.Api.Ports;

var builder = WebApplication.CreateBuilder(args);

const string FrontendCors = "frontend";

builder.Services.AddCors(options =>
{
    options.AddPolicy(FrontendCors, policy => policy
        .WithOrigins(builder.Configuration["Cors:FrontendOrigin"] ?? "http://localhost:3000")
        .AllowAnyHeader()
        .AllowAnyMethod()
        .AllowCredentials());
});

// Proveedor de almacenamiento conmutable (HU-39): `local` corre todo contra
// SQLite + disco; `cloudflare` (default) usa D1/R2. Riesgo cero para producción.
var storageProvider = builder.Configuration["Storage:Provider"] ?? "cloudflare";
if (storageProvider == "local")
{
    builder.Services.AddSingleton<ID1Client, LocalSqliteD1Client>();
    builder.Services.AddHostedService<LocalDbInitializer>();
}
else
{
    builder.Services.AddSingleton<ID1Client, Micelio.Api.Adapters.Cloudflare.D1Client>();
}

var app = builder.Build();

app.UseCors(FrontendCors);

app.MapGet("/health", () => Results.Ok(new
{
    status = "ok",
    storageProvider,
}));

if (app.Environment.IsDevelopment())
{
    // Diagnóstico del modo local: tablas existentes + usuario seed.
    app.MapGet("/dev/db-info", async (ID1Client d1, CancellationToken ct) =>
    {
        var tables = await d1.QueryAsync(
            "SELECT name FROM sqlite_master WHERE type IN ('table', 'view') AND name NOT LIKE 'sqlite_%' ORDER BY name",
            ct: ct);
        var seed = await d1.QueryAsync(
            "SELECT email, nombre, email_verificado FROM usuarios WHERE email = ?",
            [LocalDbInitializer.SeedEmail], ct);
        return Results.Ok(new { tables = tables.Results, seedUser = seed.Results });
    });
}

app.Run();
