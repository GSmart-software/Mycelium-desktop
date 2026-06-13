using System.Security.Claims;
using System.Text;
using System.Text.Json;
using Micelio.Api.Features.Common;
using Micelio.Api.Ports;

namespace Micelio.Api.Features.Auth;

/// <summary>
/// Perfil y preferencias del usuario (HU-34), tema/modo oscuro (HU-12),
/// tipografía (HU-14) y CSS personalizado (HU-13/15). Todo detrás de los
/// puertos: preferencias en D1 (usuarios.preferencias_json) y el CSS en blob.
/// </summary>
public static class PreferencesEndpoints
{
    private const int MaxCssBytes = 512 * 1024; // 512 KB de guarda dura

    public static void MapPreferencesEndpoints(this WebApplication app)
    {
        var group = app.MapGroup("/auth").RequireAuthorization();

        // ── Preferencias de apariencia (HU-12 / HU-14) ────────────
        group.MapPut("/preferencias", async (
            PreferenciasRequest request,
            ClaimsPrincipal principal,
            AuthRepository repo,
            CancellationToken ct) =>
        {
            var userId = GetUserId(principal);
            if (userId is null) return Results.Unauthorized();

            var tema = request.Tema is "bioluminiscencia" or "cantarela"
                ? request.Tema
                : "bioluminiscencia";
            var prefsJson = request.Preferencias.ValueKind == JsonValueKind.Undefined
                ? null
                : request.Preferencias.GetRawText();

            await repo.UpdatePreferencesAsync(userId, tema, request.ModoOscuro, prefsJson, ct);
            if (await repo.FindUserByIdAsync(userId, ct) is not { } user) return Results.Unauthorized();
            return Results.Ok(AuthEndpoints.UserDto(user));
        });

        // ── Perfil: nombre + avatar (HU-34 CA1) ───────────────────
        group.MapPatch("/perfil", async (
            PerfilRequest request,
            ClaimsPrincipal principal,
            AuthRepository repo,
            CancellationToken ct) =>
        {
            var userId = GetUserId(principal);
            if (userId is null) return Results.Unauthorized();

            var nombre = request.Nombre?.Trim();
            if (string.IsNullOrWhiteSpace(nombre))
            {
                return Results.BadRequest(new { error = "El nombre no puede estar vacío." });
            }

            await repo.UpdateProfileAsync(userId, nombre, request.AvatarUrl, ct);
            if (await repo.FindUserByIdAsync(userId, ct) is not { } user) return Results.Unauthorized();
            return Results.Ok(AuthEndpoints.UserDto(user));
        });

        // ── Cambio de contraseña (HU-34 CA1) ──────────────────────
        group.MapPost("/cambiar-password", async (
            CambiarPasswordRequest request,
            ClaimsPrincipal principal,
            AuthRepository repo,
            CancellationToken ct) =>
        {
            var userId = GetUserId(principal);
            if (userId is null) return Results.Unauthorized();
            if (await repo.FindUserByIdAsync(userId, ct) is not { } user) return Results.Unauthorized();

            var hash = user.GetStringOrNull("password_hash");
            if (hash is null || string.IsNullOrEmpty(request.Actual)
                || !BCrypt.Net.BCrypt.Verify(request.Actual, hash))
            {
                return Results.BadRequest(new { error = "La contraseña actual no es correcta." });
            }
            if (string.IsNullOrEmpty(request.Nueva) || request.Nueva.Length < 8)
            {
                return Results.BadRequest(new { error = "La nueva contraseña debe tener al menos 8 caracteres." });
            }

            await repo.UpdatePasswordAsync(userId, BCrypt.Net.BCrypt.HashPassword(request.Nueva), ct);
            return Results.Ok(new { message = "Contraseña actualizada." });
        });

        // ── Cerrar sesión en todos los dispositivos (HU-34 CA6) ───
        group.MapPost("/cerrar-todo", async (
            ClaimsPrincipal principal,
            AuthRepository repo,
            CancellationToken ct) =>
        {
            var userId = GetUserId(principal);
            if (userId is null) return Results.Unauthorized();
            await repo.RevokeAllRefreshTokensAsync(userId, ct);
            return Results.Ok(new { message = "Sesiones cerradas en todos los dispositivos." });
        });

        // ── CSS personalizado (HU-13 / HU-15) ─────────────────────
        group.MapGet("/css", async (
            ClaimsPrincipal principal,
            IBlobStorage blobs,
            CancellationToken ct) =>
        {
            var userId = GetUserId(principal);
            if (userId is null) return Results.Unauthorized();

            await using var stream = await blobs.GetAsync(CssKey(userId), ct);
            if (stream is null) return Results.Ok(new { css = "" });
            using var reader = new StreamReader(stream, Encoding.UTF8);
            return Results.Ok(new { css = await reader.ReadToEndAsync(ct) });
        });

        group.MapPut("/css", async (
            CssRequest request,
            ClaimsPrincipal principal,
            IBlobStorage blobs,
            CancellationToken ct) =>
        {
            var userId = GetUserId(principal);
            if (userId is null) return Results.Unauthorized();

            var css = request.Css ?? "";
            if (Encoding.UTF8.GetByteCount(css) > MaxCssBytes)
            {
                return Results.BadRequest(new { error = "El CSS supera el límite de 512 KB." });
            }

            using var ms = new MemoryStream(Encoding.UTF8.GetBytes(css));
            await blobs.PutAsync(CssKey(userId), ms, "text/css", ct);
            return Results.Ok(new { message = "CSS guardado." });
        });
    }

    private static string CssKey(string userId) => $"usuarios/{userId}/temas/custom.css";

    private static string? GetUserId(ClaimsPrincipal user) =>
        user.FindFirstValue(ClaimTypes.NameIdentifier) ?? user.FindFirstValue("sub");

    public sealed record PreferenciasRequest(string? Tema, bool ModoOscuro, JsonElement Preferencias);
    public sealed record PerfilRequest(string? Nombre, string? AvatarUrl);
    public sealed record CambiarPasswordRequest(string? Actual, string? Nueva);
    public sealed record CssRequest(string? Css);
}
