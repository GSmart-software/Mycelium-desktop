using System.Security.Claims;
using Micelio.Api.Features.Auth;
using Micelio.Api.Features.Common;
using Micelio.Api.Ports;

namespace Micelio.Api.Features.Vaults;

/// <summary>
/// Sesión de colaboración en tiempo real de una nota (HU-05/06/37). Devuelve si
/// la colaboración está habilitada (solo notas en carpetas compartidas, CA5),
/// la URL del relay y los datos de presencia del usuario. En local viene
/// deshabilitada; en cloudflare apunta al Durable Object.
/// </summary>
public static class CollabEndpoints
{
    public static void MapCollabEndpoints(this WebApplication app)
    {
        var group = app.MapGroup("").RequireAuthorization();

        group.MapGet("/notas/{id}/colaboracion", async (
            string id,
            ClaimsPrincipal user,
            SharingRepository sharing,
            AuthRepository auth,
            ICollabRelay relay,
            CancellationToken ct) =>
        {
            var userId = user.FindFirstValue(ClaimTypes.NameIdentifier) ?? user.FindFirstValue("sub");
            if (userId is null) return Results.Unauthorized();

            var rol = await sharing.GetEffectiveNotaRoleAsync(userId, id, ct);
            if (rol is null) return Results.Json(new { error = "Sin acceso." }, statusCode: 403);

            // La colaboración en vivo solo aplica a notas en carpetas compartidas (CA5).
            if (!await sharing.IsNotaInSharedFolderAsync(id, ct))
            {
                return Results.Ok(new { habilitada = false });
            }

            var session = await relay.GetSessionAsync(id, userId, ct);
            var u = await auth.FindUserByIdAsync(userId, ct);
            var nombre = u?.GetString("nombre") ?? "Usuario";

            return Results.Ok(new
            {
                habilitada = session.Enabled,
                room = session.Room,
                url = session.WebsocketUrl,
                rol, // 'lector' => el cliente abre en modo lectura (CA5 de HU-37)
                usuario = new
                {
                    id = userId,
                    nombre,
                    color = ColorFromId(userId), // color estable por id (HU-06 CA3)
                },
            });
        });
    }

    /// <summary>Color HSL estable derivado del id de usuario (HU-06 CA3).</summary>
    private static string ColorFromId(string userId)
    {
        var hash = 0;
        foreach (var c in userId) hash = unchecked(hash * 31 + c);
        var hue = Math.Abs(hash) % 360;
        return $"hsl({hue}, 70%, 55%)";
    }
}
