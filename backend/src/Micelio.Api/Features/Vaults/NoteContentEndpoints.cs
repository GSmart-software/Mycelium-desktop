using System.Security.Claims;
using System.Text;
using Micelio.Api.Features.Common;
using Micelio.Api.Ports;

namespace Micelio.Api.Features.Vaults;

/// <summary>
/// Contenido .md de las notas vía <see cref="IBlobStorage"/> (HU-04).
/// El cliente persiste primero en IndexedDB y sincroniza aquí (throttle 10 s).
/// </summary>
public static class NoteContentEndpoints
{
    public static void MapNoteContentEndpoints(this WebApplication app)
    {
        var group = app.MapGroup("").RequireAuthorization();

        group.MapGet("/notas/{id}/contenido", async (
            string id,
            ClaimsPrincipal user,
            VaultRepository repo,
            IBlobStorage blobs,
            CancellationToken ct) =>
        {
            if (await AuthorizeAsync(repo, user, id, requireEditor: false, ct) is { } error) return error;
            if (await repo.GetNotaAsync(id, ct) is not { } nota) return Results.NotFound();

            var contenido = "";
            await using (var stream = await blobs.GetAsync(nota.GetString("r2_key"), ct))
            {
                if (stream is not null)
                {
                    using var reader = new StreamReader(stream, Encoding.UTF8);
                    contenido = await reader.ReadToEndAsync(ct);
                }
            }

            return Results.Ok(new
            {
                id,
                contenido,
                actualizadoEn = nota.GetString("actualizado_en"),
            });
        });

        group.MapPut("/notas/{id}/contenido", async (
            string id,
            ContentRequest request,
            ClaimsPrincipal user,
            VaultRepository repo,
            IBlobStorage blobs,
            CancellationToken ct) =>
        {
            if (await AuthorizeAsync(repo, user, id, requireEditor: true, ct) is { } error) return error;
            if (await repo.GetNotaAsync(id, ct) is not { } nota) return Results.NotFound();

            var contenido = request.Contenido ?? "";
            var bytes = Encoding.UTF8.GetBytes(contenido);
            await using (var stream = new MemoryStream(bytes))
            {
                await blobs.PutAsync(nota.GetString("r2_key"), stream, "text/markdown", ct);
            }

            var actualizadoEn = await repo.TouchNotaContenidoAsync(
                id, nota.GetString("titulo"), contenido, bytes.Length, ct);

            return Results.Ok(new { id, actualizadoEn, tamanoBytes = bytes.Length });
        });
    }

    private static async Task<IResult?> AuthorizeAsync(
        VaultRepository repo, ClaimsPrincipal user, string notaId, bool requireEditor, CancellationToken ct)
    {
        var vaultId = await repo.GetVaultIdOfNotaAsync(notaId, ct);
        if (vaultId is null) return Results.NotFound(new { error = "La nota no existe." });

        var userId = user.FindFirstValue(ClaimTypes.NameIdentifier) ?? user.FindFirstValue("sub");
        if (userId is null) return Results.Json(new { error = "No autenticado." }, statusCode: 401);

        var rol = await repo.GetVaultRoleAsync(userId, vaultId, ct);
        if (rol is null) return Results.Json(new { error = "Sin acceso a este vault." }, statusCode: 403);
        if (requireEditor && rol == "lector")
        {
            return Results.Json(new { error = "Tu rol no permite editar." }, statusCode: 403);
        }

        return null;
    }

    public sealed record ContentRequest(string? Contenido);
}
