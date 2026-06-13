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
            SharingRepository sharing,
            IBlobStorage blobs,
            CancellationToken ct) =>
        {
            if (await AuthorizeAsync(repo, sharing, user, id, requireEditor: false, ct) is { } error) return error;
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
            SharingRepository sharing,
            IBlobStorage blobs,
            CancellationToken ct) =>
        {
            if (await AuthorizeAsync(repo, sharing, user, id, requireEditor: true, ct) is { } error) return error;
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

    /// <summary>
    /// Diagramas Excalidraw de una nota (HU-16 CA4):
    /// clave R2 = vaults/{vaultId}/diagramas/{notaId}/{diagId}.excalidraw
    /// </summary>
    public static void MapDiagramEndpoints(this WebApplication app)
    {
        var group = app.MapGroup("").RequireAuthorization();

        group.MapGet("/notas/{notaId}/diagramas/{diagId}", async (
            string notaId,
            string diagId,
            ClaimsPrincipal user,
            VaultRepository repo,
            SharingRepository sharing,
            IBlobStorage blobs,
            CancellationToken ct) =>
        {
            if (await AuthorizeAsync(repo, sharing, user, notaId, requireEditor: false, ct) is { } error) return error;
            if (await repo.GetNotaAsync(notaId, ct) is not { } nota) return Results.NotFound();

            var key = DiagramKey(nota.GetString("vault_id"), notaId, diagId);
            await using var stream = await blobs.GetAsync(key, ct);
            if (stream is null)
            {
                return Results.NotFound(new { error = "El diagrama no existe." });
            }

            using var reader = new StreamReader(stream, Encoding.UTF8);
            var json = await reader.ReadToEndAsync(ct);
            return Results.Text(json, "application/json");
        });

        group.MapPut("/notas/{notaId}/diagramas/{diagId}", async (
            string notaId,
            string diagId,
            HttpContext http,
            ClaimsPrincipal user,
            VaultRepository repo,
            SharingRepository sharing,
            IBlobStorage blobs,
            CancellationToken ct) =>
        {
            if (await AuthorizeAsync(repo, sharing, user, notaId, requireEditor: true, ct) is { } error) return error;
            if (await repo.GetNotaAsync(notaId, ct) is not { } nota) return Results.NotFound();

            using var reader = new StreamReader(http.Request.Body, Encoding.UTF8);
            var json = await reader.ReadToEndAsync(ct);
            var key = DiagramKey(nota.GetString("vault_id"), notaId, diagId);
            await using var stream = new MemoryStream(Encoding.UTF8.GetBytes(json));
            await blobs.PutAsync(key, stream, "application/json", ct);
            return Results.Ok(new { notaId, diagId });
        });
    }

    private static string DiagramKey(string vaultId, string notaId, string diagId) =>
        $"vaults/{vaultId}/diagramas/{notaId}/{SanitizeId(diagId)}.excalidraw";

    private static string SanitizeId(string id) =>
        new([.. id.Where(c => char.IsLetterOrDigit(c) || c is '-' or '_')]);

    /// <summary>
    /// Autoriza por rol efectivo sobre la nota: rol de vault o membresía de una
    /// carpeta ancestro compartida (HU-35 CA6). `requireEditor` exige editor+.
    /// </summary>
    private static async Task<IResult?> AuthorizeAsync(
        VaultRepository repo, SharingRepository sharing, ClaimsPrincipal user,
        string notaId, bool requireEditor, CancellationToken ct)
    {
        var vaultId = await repo.GetVaultIdOfNotaAsync(notaId, ct);
        if (vaultId is null) return Results.NotFound(new { error = "La nota no existe." });

        var userId = user.FindFirstValue(ClaimTypes.NameIdentifier) ?? user.FindFirstValue("sub");
        if (userId is null) return Results.Json(new { error = "No autenticado." }, statusCode: 401);

        var rol = await sharing.GetEffectiveNotaRoleAsync(userId, notaId, ct);
        if (rol is null) return Results.Json(new { error = "Sin acceso a esta nota." }, statusCode: 403);
        if (requireEditor && rol == "lector")
        {
            return Results.Json(new { error = "Tu rol no permite editar." }, statusCode: 403);
        }

        return null;
    }

    public sealed record ContentRequest(string? Contenido);
}
