using System.Security.Claims;
using System.Text.RegularExpressions;
using Micelio.Api.Features.Common;
using Micelio.Api.Ports;

namespace Micelio.Api.Features.Auth;

/// <summary>Endpoints de registro e inicio de sesión (HU-32) y vault personal (HU-33).</summary>
public static partial class AuthEndpoints
{
    private const string RefreshCookieName = "micelio_refresh";

    [GeneratedRegex(@"^[^@\s]+@[^@\s]+\.[^@\s]+$")]
    private static partial Regex EmailRegex();

    public static void MapAuthEndpoints(this WebApplication app)
    {
        var group = app.MapGroup("/auth");
        var frontendUrl = app.Configuration["Cors:FrontendOrigin"] ?? "http://localhost:3000";

        // ── Registro (CA1, CA3; HU-33 CA1) ────────────────────────
        group.MapPost("/register", async (
            RegisterRequest request,
            AuthRepository repo,
            IEmailSender email,
            CancellationToken ct) =>
        {
            var emailNormalized = request.Email?.Trim().ToLowerInvariant() ?? "";
            if (!EmailRegex().IsMatch(emailNormalized))
            {
                return Results.BadRequest(new { error = "El email no es válido." });
            }

            if (string.IsNullOrEmpty(request.Password) || request.Password.Length < 8)
            {
                return Results.BadRequest(new { error = "La contraseña debe tener al menos 8 caracteres." });
            }

            var nombre = string.IsNullOrWhiteSpace(request.Nombre)
                ? emailNormalized.Split('@')[0]
                : request.Nombre.Trim();

            if (await repo.FindUserByEmailAsync(emailNormalized, ct) is not null)
            {
                return Results.Conflict(new { error = "Ya existe una cuenta con ese email." });
            }

            var userId = Guid.NewGuid().ToString();
            var passwordHash = BCrypt.Net.BCrypt.HashPassword(request.Password);
            await repo.CreateUserWithPersonalVaultAsync(
                userId, emailNormalized, nombre, passwordHash, emailVerificado: false, ct);

            var (token, hash) = TokenService.CreateOpaqueToken();
            await repo.InsertOneUseTokenAsync(userId, "verificar_email", hash, DateTime.UtcNow.AddDays(2), ct);
            await email.SendAsync(
                emailNormalized,
                "Verificá tu cuenta de Micelio",
                $"Abrí este link para activar tu cuenta: {frontendUrl}/verify-email?token={token}",
                ct);

            return Results.Created("/auth/me", new
            {
                message = "Cuenta creada. Revisá tu email para verificarla.",
            });
        });

        // ── Verificación de email (CA3) ───────────────────────────
        group.MapPost("/verify-email", async (
            VerifyEmailRequest request,
            AuthRepository repo,
            CancellationToken ct) =>
        {
            var row = await repo.FindOneUseTokenAsync(
                TokenService.HashToken(request.Token ?? ""), "verificar_email", ct);
            if (row is not { } tokenRow)
            {
                return Results.BadRequest(new { error = "El link de verificación no es válido o expiró." });
            }

            await repo.SetEmailVerifiedAsync(tokenRow.GetString("usuario_id"), ct);
            await repo.MarkOneUseTokenUsedAsync(tokenRow.GetString("id"), ct);
            return Results.Ok(new { message = "Email verificado. Ya podés iniciar sesión." });
        });

        // ── Login (CA4, CA7) ──────────────────────────────────────
        group.MapPost("/login", async (
            LoginRequest request,
            AuthRepository repo,
            TokenService tokens,
            HttpContext http,
            CancellationToken ct) =>
        {
            var emailNormalized = request.Email?.Trim().ToLowerInvariant() ?? "";
            var user = await repo.FindUserByEmailAsync(emailNormalized, ct);

            var passwordHash = user?.GetStringOrNull("password_hash");
            if (user is not { } userRow
                || passwordHash is null
                || !BCrypt.Net.BCrypt.Verify(request.Password ?? "", passwordHash))
            {
                return Results.Json(new { error = "Email o contraseña incorrectos." }, statusCode: 401);
            }

            if (!userRow.GetBool("email_verificado"))
            {
                return Results.Json(new { error = "Verificá tu email antes de iniciar sesión." }, statusCode: 403);
            }

            return Results.Ok(await IssueSessionAsync(userRow, repo, tokens, http, ct));
        });

        // ── Refresh con rotación (CA4, CA5) ───────────────────────
        group.MapPost("/refresh", async (
            AuthRepository repo,
            TokenService tokens,
            HttpContext http,
            CancellationToken ct) =>
        {
            var cookie = http.Request.Cookies[RefreshCookieName];
            if (string.IsNullOrEmpty(cookie))
            {
                return Results.Json(new { error = "Sin sesión." }, statusCode: 401);
            }

            var stored = await repo.FindActiveRefreshTokenAsync(TokenService.HashToken(cookie), ct);
            if (stored is not { } tokenRow)
            {
                http.Response.Cookies.Delete(RefreshCookieName, BuildCookieOptions(http, expires: null));
                return Results.Json(new { error = "La sesión expiró." }, statusCode: 401);
            }

            // Rotación: el token usado se revoca y se emite uno nuevo.
            await repo.RevokeRefreshTokenAsync(tokenRow.GetString("id"), ct);

            var user = await repo.FindUserByIdAsync(tokenRow.GetString("usuario_id"), ct);
            if (user is not { } userRow)
            {
                return Results.Json(new { error = "La sesión expiró." }, statusCode: 401);
            }

            return Results.Ok(await IssueSessionAsync(userRow, repo, tokens, http, ct));
        });

        // ── Logout (CA8) ──────────────────────────────────────────
        group.MapPost("/logout", async (
            AuthRepository repo,
            HttpContext http,
            CancellationToken ct) =>
        {
            var cookie = http.Request.Cookies[RefreshCookieName];
            if (!string.IsNullOrEmpty(cookie))
            {
                var stored = await repo.FindActiveRefreshTokenAsync(TokenService.HashToken(cookie), ct);
                if (stored is { } tokenRow)
                {
                    await repo.RevokeRefreshTokenAsync(tokenRow.GetString("id"), ct);
                }
            }

            http.Response.Cookies.Delete(RefreshCookieName, BuildCookieOptions(http, expires: null));
            return Results.Ok(new { message = "Sesión cerrada." });
        });

        // ── Olvidé mi contraseña (CA6) ────────────────────────────
        group.MapPost("/forgot-password", async (
            ForgotPasswordRequest request,
            AuthRepository repo,
            IEmailSender email,
            CancellationToken ct) =>
        {
            var emailNormalized = request.Email?.Trim().ToLowerInvariant() ?? "";
            if (await repo.FindUserByEmailAsync(emailNormalized, ct) is { } user)
            {
                var (token, hash) = TokenService.CreateOpaqueToken();
                await repo.InsertOneUseTokenAsync(
                    user.GetString("id"), "reset_password", hash, DateTime.UtcNow.AddHours(2), ct);
                await email.SendAsync(
                    emailNormalized,
                    "Restablecé tu contraseña de Micelio",
                    $"Abrí este link (válido por 2 horas, un solo uso): {frontendUrl}/reset-password?token={token}",
                    ct);
            }

            // Siempre 200 para no revelar si el email existe.
            return Results.Ok(new { message = "Si el email existe, vas a recibir un link para restablecer la contraseña." });
        });

        group.MapPost("/reset-password", async (
            ResetPasswordRequest request,
            AuthRepository repo,
            CancellationToken ct) =>
        {
            if (string.IsNullOrEmpty(request.Password) || request.Password.Length < 8)
            {
                return Results.BadRequest(new { error = "La contraseña debe tener al menos 8 caracteres." });
            }

            var row = await repo.FindOneUseTokenAsync(
                TokenService.HashToken(request.Token ?? ""), "reset_password", ct);
            if (row is not { } tokenRow)
            {
                return Results.BadRequest(new { error = "El link no es válido o expiró." });
            }

            var userId = tokenRow.GetString("usuario_id");
            await repo.UpdatePasswordAsync(userId, BCrypt.Net.BCrypt.HashPassword(request.Password), ct);
            await repo.MarkOneUseTokenUsedAsync(tokenRow.GetString("id"), ct);
            await repo.RevokeAllRefreshTokensAsync(userId, ct);
            return Results.Ok(new { message = "Contraseña actualizada. Iniciá sesión con la nueva." });
        });

        // ── Usuario actual + vaults (HU-33) ───────────────────────
        group.MapGet("/me", async (
            ClaimsPrincipal principal,
            AuthRepository repo,
            CancellationToken ct) =>
        {
            var userId = principal.FindFirstValue(ClaimTypes.NameIdentifier)
                ?? principal.FindFirstValue("sub");
            if (userId is null || await repo.FindUserByIdAsync(userId, ct) is not { } user)
            {
                return Results.Json(new { error = "No autenticado." }, statusCode: 401);
            }

            return Results.Ok(new
            {
                user = UserDto(user),
                vaults = await repo.GetUserVaultsAsync(userId, ct),
            });
        }).RequireAuthorization();
    }

    /// <summary>Emite access token + cookie de refresh (rotada en cada uso).</summary>
    private static async Task<object> IssueSessionAsync(
        System.Text.Json.JsonElement user,
        AuthRepository repo,
        TokenService tokens,
        HttpContext http,
        CancellationToken ct)
    {
        var userId = user.GetString("id");
        var (refreshToken, refreshHash) = TokenService.CreateOpaqueToken();
        var expiraEn = DateTime.UtcNow.AddDays(tokens.RefreshTokenDays);
        await repo.InsertRefreshTokenAsync(userId, refreshHash, expiraEn, ct);

        http.Response.Cookies.Append(RefreshCookieName, refreshToken, BuildCookieOptions(http, expiraEn));

        return new
        {
            accessToken = tokens.CreateAccessToken(userId, user.GetString("email"), user.GetString("nombre")),
            expiresInMinutes = tokens.AccessTokenMinutes,
            user = UserDto(user),
        };
    }

    /// <summary>
    /// Opciones de la cookie de refresh, configurables para el despliegue:
    /// <c>Auth:CookieSameSite</c> (Lax|None|Strict), <c>Auth:CookieSecure</c> y
    /// <c>Auth:CookieDomain</c>. En cross-site (Pages ↔ Render) hace falta
    /// SameSite=None + Secure; con dominio propio basta Lax + Domain. Append y
    /// Delete comparten estas opciones para que el borrado haga match.
    /// </summary>
    private static CookieOptions BuildCookieOptions(HttpContext http, DateTimeOffset? expires)
    {
        var config = http.RequestServices.GetRequiredService<IConfiguration>();

        var sameSite = config["Auth:CookieSameSite"]?.Trim().ToLowerInvariant() switch
        {
            "none" => SameSiteMode.None,
            "strict" => SameSiteMode.Strict,
            _ => SameSiteMode.Lax,
        };

        // SameSite=None exige Secure; si no, respetar Auth:CookieSecure o el esquema.
        var secure = config.GetValue<bool?>("Auth:CookieSecure") ?? http.Request.IsHttps;
        if (sameSite == SameSiteMode.None)
        {
            secure = true;
        }

        var options = new CookieOptions
        {
            HttpOnly = true,
            Secure = secure,
            SameSite = sameSite,
            Path = "/auth",
        };

        if (expires.HasValue)
        {
            options.Expires = expires;
        }

        var domain = config["Auth:CookieDomain"];
        if (!string.IsNullOrWhiteSpace(domain))
        {
            options.Domain = domain;
        }

        return options;
    }

    internal static object UserDto(System.Text.Json.JsonElement user) => new
    {
        id = user.GetString("id"),
        email = user.GetString("email"),
        nombre = user.GetString("nombre"),
        avatarUrl = user.GetStringOrNull("avatar_url"),
        tema = user.GetString("tema"),
        modoOscuro = user.GetBool("modo_oscuro"),
        preferencias = ParsePreferencias(user.GetStringOrNull("preferencias_json")),
    };

    /// <summary>preferencias_json → objeto JSON (o {} si está vacío/corrupto).</summary>
    private static System.Text.Json.JsonElement ParsePreferencias(string? json)
    {
        if (!string.IsNullOrWhiteSpace(json))
        {
            try
            {
                return System.Text.Json.JsonDocument.Parse(json).RootElement.Clone();
            }
            catch (System.Text.Json.JsonException)
            {
                // preferencias corruptas → objeto vacío
            }
        }
        return System.Text.Json.JsonDocument.Parse("{}").RootElement.Clone();
    }

    public sealed record RegisterRequest(string? Email, string? Password, string? Nombre);
    public sealed record LoginRequest(string? Email, string? Password);
    public sealed record VerifyEmailRequest(string? Token);
    public sealed record ForgotPasswordRequest(string? Email);
    public sealed record ResetPasswordRequest(string? Token, string? Password);
}
