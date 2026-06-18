using System.Text;
using Micelio.Api.Adapters.Local;
using Micelio.Api.Features.Auth;
using Micelio.Api.Ports;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.HttpOverrides;
using Microsoft.IdentityModel.Tokens;

var builder = WebApplication.CreateBuilder(args);

// Capa de overrides/secretos local (gitignored). Un único lugar para las keys
// de Cloudflare y, en el modo desktop, para Urls/Hosting:ServeFrontend. Se carga
// después de los appsettings por defecto y antes de las variables de entorno.
builder.Configuration.AddJsonFile("appsettings.Local.json", optional: true, reloadOnChange: true);

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

// Modo desktop (un solo proceso sirve la UI estática + la API en el mismo origen).
// Gateado por Hosting:ServeFrontend; en dev/deploy queda apagado. Los estáticos van
// antes de CORS/auth (no requieren autenticación).
var serveFrontend = app.Configuration.GetValue<bool>("Hosting:ServeFrontend");
if (serveFrontend)
{
    app.UseDefaultFiles();
    app.UseStaticFiles();
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

if (serveFrontend)
{
    // Fallback de la SPA exportada por Next (output:'export'): replica
    // `try_files $uri $uri.html` → sirve wwwroot/{ruta}.html si existe, si no
    // index.html. Solo captura GET no resueltos por estáticos ni por la API
    // (que están mapeados explícitamente), así que /login, /workspace, etc.
    // cargan su página y el cliente toma el routing.
    app.MapFallback(async context =>
    {
        var webRoot = app.Environment.WebRootPath
            ?? Path.Combine(app.Environment.ContentRootPath, "wwwroot");
        var requested = context.Request.Path.Value?.Trim('/') ?? "";
        var candidate = string.IsNullOrEmpty(requested) ? "index.html" : $"{requested}.html";

        var filePath = Path.Combine(webRoot, candidate.Replace('/', Path.DirectorySeparatorChar));
        if (!File.Exists(filePath))
        {
            filePath = Path.Combine(webRoot, "index.html");
        }

        context.Response.ContentType = "text/html; charset=utf-8";
        await context.Response.SendFileAsync(filePath);
    });

    // Abrir el navegador en la URL de la app (sensación de "app de escritorio").
    var url = app.Configuration["Urls"]?.Split(';')[0] ?? "http://localhost:5279";
    app.Lifetime.ApplicationStarted.Register(() =>
    {
        try
        {
            System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo(url)
            {
                UseShellExecute = true,
            });
        }
        catch
        {
            // Si no hay navegador/entorno gráfico, no es crítico.
        }
    });
}

app.Run();
