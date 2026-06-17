using System.Text;
using Micelio.Api.Adapters.Local;
using Micelio.Api.Features.Auth;
using Micelio.Api.Ports;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.HttpOverrides;
using Microsoft.IdentityModel.Tokens;

var builder = WebApplication.CreateBuilder(args);

// Render (y otros PaaS) inyectan el puerto a escuchar vía la variable PORT.
// En local no existe, así que Kestrel usa su configuración habitual.
var port = Environment.GetEnvironmentVariable("PORT");
if (!string.IsNullOrEmpty(port))
{
    builder.WebHost.UseUrls($"http://0.0.0.0:{port}");
}

const string FrontendCors = "frontend";

builder.Services.AddCors(options =>
{
    options.AddPolicy(FrontendCors, policy => policy
        .WithOrigins(builder.Configuration["Cors:FrontendOrigin"] ?? "http://localhost:3000")
        .AllowAnyHeader()
        .AllowAnyMethod()
        .AllowCredentials());
});

// JWT de corta duración (HU-32 CA4)
builder.Services
    .AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
    .AddJwtBearer(options =>
    {
        options.TokenValidationParameters = new TokenValidationParameters
        {
            ValidateIssuer = true,
            ValidIssuer = builder.Configuration["Jwt:Issuer"] ?? "micelio",
            ValidateAudience = false,
            ValidateIssuerSigningKey = true,
            IssuerSigningKey = new SymmetricSecurityKey(
                Encoding.UTF8.GetBytes(builder.Configuration["Jwt:Secret"]
                    ?? throw new InvalidOperationException("Falta configurar Jwt:Secret."))),
            ClockSkew = TimeSpan.FromSeconds(30),
        };
    });
builder.Services.AddAuthorization();

builder.Services.AddSingleton<TokenService>();
builder.Services.AddSingleton<AuthRepository>();
builder.Services.AddSingleton<Micelio.Api.Features.Vaults.VaultRepository>();
builder.Services.AddSingleton<Micelio.Api.Features.Vaults.SharingRepository>();
builder.Services.AddSingleton<Micelio.Api.Features.Vaults.PdfService>();

// Proveedor de almacenamiento conmutable (HU-39): `local` corre todo contra
// SQLite + disco; `cloudflare` (default) usa D1/R2. Riesgo cero para producción.
var storageProvider = builder.Configuration["Storage:Provider"] ?? "cloudflare";
if (storageProvider == "local")
{
    builder.Services.AddSingleton<ID1Client, LocalSqliteD1Client>();
    builder.Services.AddSingleton<IBlobStorage, LocalDiskBlobStorage>();
    builder.Services.AddSingleton<IEmailSender, LogEmailSender>();
    builder.Services.AddSingleton<ICollabRelay, LocalCollabRelay>();
    builder.Services.AddHostedService<LocalDbInitializer>();
}
else
{
    builder.Services.AddHttpClient();
    builder.Services.AddSingleton<ID1Client, Micelio.Api.Adapters.Cloudflare.D1Client>();
    builder.Services.AddSingleton<IBlobStorage, Micelio.Api.Adapters.Cloudflare.R2BlobStorage>();
    builder.Services.AddSingleton<ICollabRelay, Micelio.Api.Adapters.Cloudflare.DurableObjectCollabRelay>();
    // Email deshabilitado por ahora: el admin verifica cuentas a mano en D1.
    // (Resend / verificación automática quedan como mejora futura.)
    builder.Services.AddSingleton<IEmailSender, LogEmailSender>();
}

var app = builder.Build();

// Detrás del proxy TLS de Render/Cloudflare, honrar X-Forwarded-Proto para que
// Request.IsHttps sea correcto y las cookies Secure/SameSite=None funcionen.
// En Development no se aplica para no alterar el comportamiento local.
if (!app.Environment.IsDevelopment())
{
    var forwarded = new ForwardedHeadersOptions
    {
        ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto,
    };
    // El proxy del PaaS no está en una red conocida: limpiar las listas por
    // defecto para que el header sea honrado.
    forwarded.KnownNetworks.Clear();
    forwarded.KnownProxies.Clear();
    app.UseForwardedHeaders(forwarded);
}

app.UseCors(FrontendCors);
app.UseAuthentication();
app.UseAuthorization();

app.MapAuthEndpoints();
Micelio.Api.Features.Auth.PreferencesEndpoints.MapPreferencesEndpoints(app);
Micelio.Api.Features.Vaults.VaultEndpoints.MapVaultEndpoints(app);
Micelio.Api.Features.Vaults.NoteContentEndpoints.MapNoteContentEndpoints(app);
Micelio.Api.Features.Vaults.NoteContentEndpoints.MapDiagramEndpoints(app);
Micelio.Api.Features.Vaults.SearchEndpoints.MapSearchEndpoints(app);
Micelio.Api.Features.Vaults.PdfEndpoints.MapPdfEndpoints(app);
Micelio.Api.Features.Vaults.SharingEndpoints.MapSharingEndpoints(app);
Micelio.Api.Features.Vaults.CollabEndpoints.MapCollabEndpoints(app);

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
