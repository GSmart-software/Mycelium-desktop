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

        // ── Snippets de CSS personalizado (HU-13/15, estilo Obsidian) ──
        // Listado con contenido; el cliente aplica solo los activos.
        group.MapGet("/css/snippets", async (
            ClaimsPrincipal principal,
            ID1Client d1,
            IBlobStorage blobs,
            CancellationToken ct) =>
        {
            var userId = GetUserId(principal);
            if (userId is null) return Results.Unauthorized();

            var rows = await d1.QueryAsync(
                "SELECT id, nombre, activo, r2_key FROM css_snippets WHERE usuario_id = ? ORDER BY creado_en",
                [userId], ct);

            var snippets = new List<object>();
            foreach (var r in rows.Results)
            {
                var contenido = "";
                await using (var stream = await blobs.GetAsync(r.GetString("r2_key"), ct))
                {
                    if (stream is not null)
                    {
                        using var reader = new StreamReader(stream, Encoding.UTF8);
                        contenido = await reader.ReadToEndAsync(ct);
                    }
                }
                snippets.Add(new
                {
                    id = r.GetString("id"),
                    nombre = r.GetString("nombre"),
                    activo = r.GetBool("activo"),
                    contenido,
                });
            }
            return Results.Ok(new { snippets });
        });

        // Importar un snippet nuevo
        group.MapPost("/css/snippets", async (
            CssSnippetRequest request,
            ClaimsPrincipal principal,
            ID1Client d1,
            IBlobStorage blobs,
            CancellationToken ct) =>
        {
            var userId = GetUserId(principal);
            if (userId is null) return Results.Unauthorized();

            var contenido = request.Contenido ?? "";
            if (Encoding.UTF8.GetByteCount(contenido) > MaxCssBytes)
            {
                return Results.BadRequest(new { error = "El CSS supera el límite de 512 KB." });
            }

            var nombre = string.IsNullOrWhiteSpace(request.Nombre) ? "snippet.css" : request.Nombre.Trim();
            var id = Guid.NewGuid().ToString();
            var key = $"usuarios/{userId}/css/{id}.css";
            using (var ms = new MemoryStream(Encoding.UTF8.GetBytes(contenido)))
            {
                await blobs.PutAsync(key, ms, "text/css", ct);
            }
            await d1.QueryAsync(
                "INSERT INTO css_snippets (id, usuario_id, nombre, activo, r2_key, creado_en) VALUES (?, ?, ?, 1, ?, ?)",
                [id, userId, nombre, key, DateTime.UtcNow.ToString("O")], ct);

            return Results.Ok(new { id, nombre, activo = true, contenido });
        });

        // Activar/desactivar o renombrar un snippet
        group.MapPatch("/css/snippets/{id}", async (
            string id,
            CssSnippetPatch request,
            ClaimsPrincipal principal,
            ID1Client d1,
            CancellationToken ct) =>
        {
            var userId = GetUserId(principal);
            if (userId is null) return Results.Unauthorized();

            var owned = await d1.QueryAsync(
                "SELECT id FROM css_snippets WHERE id = ? AND usuario_id = ?", [id, userId], ct);
            if (owned.Results.Count == 0) return Results.NotFound();

            if (request.Activo is { } activo)
            {
                await d1.QueryAsync("UPDATE css_snippets SET activo = ? WHERE id = ?", [activo, id], ct);
            }
            if (!string.IsNullOrWhiteSpace(request.Nombre))
            {
                await d1.QueryAsync("UPDATE css_snippets SET nombre = ? WHERE id = ?", [request.Nombre.Trim(), id], ct);
            }
            return Results.Ok(new { ok = true });
        });

        // Eliminar un snippet
        group.MapDelete("/css/snippets/{id}", async (
            string id,
            ClaimsPrincipal principal,
            ID1Client d1,
            IBlobStorage blobs,
            CancellationToken ct) =>
        {
            var userId = GetUserId(principal);
            if (userId is null) return Results.Unauthorized();

            var rows = await d1.QueryAsync(
                "SELECT r2_key FROM css_snippets WHERE id = ? AND usuario_id = ?", [id, userId], ct);
            if (rows.Results.Count == 0) return Results.NotFound();

            await blobs.DeleteAsync(rows.Results[0].GetString("r2_key"), ct);
            await d1.QueryAsync("DELETE FROM css_snippets WHERE id = ?", [id], ct);
            return Results.Ok(new { ok = true });
        });
    }

    private static string? GetUserId(ClaimsPrincipal user) =>
        user.FindFirstValue(ClaimTypes.NameIdentifier) ?? user.FindFirstValue("sub");

    public sealed record PreferenciasRequest(string? Tema, bool ModoOscuro, JsonElement Preferencias);
    public sealed record PerfilRequest(string? Nombre, string? AvatarUrl);
    public sealed record CambiarPasswordRequest(string? Actual, string? Nueva);
    public sealed record CssSnippetRequest(string? Nombre, string? Contenido);
    public sealed record CssSnippetPatch(bool? Activo, string? Nombre);
}
