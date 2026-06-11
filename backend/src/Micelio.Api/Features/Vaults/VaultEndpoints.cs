using System.Security.Claims;
using System.Text.Json;
using Micelio.Api.Features.Common;

namespace Micelio.Api.Features.Vaults;

/// <summary>Endpoints de carpetas, notas y papelera (HU-22, HU-23, HU-24).</summary>
public static class VaultEndpoints
{
    public static void MapVaultEndpoints(this WebApplication app)
    {
        var group = app.MapGroup("").RequireAuthorization();

        // ── Árbol del explorer ────────────────────────────────────
        group.MapGet("/vaults/{vaultId}/tree", async (
            string vaultId, ClaimsPrincipal user, VaultRepository repo, CancellationToken ct) =>
        {
            if (await Forbidden(repo, user, vaultId, requireEditor: false, ct) is { } error) return error;
            var (carpetas, notas) = await repo.GetTreeAsync(vaultId, ct);
            return Results.Ok(new { carpetas, notas });
        });

        // ── Carpetas (HU-22) ──────────────────────────────────────
        group.MapPost("/vaults/{vaultId}/carpetas", async (
            string vaultId, CreateCarpetaRequest request, ClaimsPrincipal user, VaultRepository repo, CancellationToken ct) =>
        {
            if (await Forbidden(repo, user, vaultId, requireEditor: true, ct) is { } error) return error;
            var nombre = request.Nombre?.Trim();
            if (string.IsNullOrEmpty(nombre))
            {
                return Results.BadRequest(new { error = "El nombre no puede estar vacío." });
            }

            var id = await repo.CreateCarpetaAsync(vaultId, NullIfEmpty(request.PadreId), nombre, ct);
            return Results.Created($"/carpetas/{id}", new { id });
        });

        group.MapPatch("/carpetas/{id}", async (
            string id, RenameRequest request, ClaimsPrincipal user, VaultRepository repo, CancellationToken ct) =>
        {
            if (await ForbiddenForCarpeta(repo, user, id, ct) is { } error) return error;
            var nombre = request.Nombre?.Trim();
            if (string.IsNullOrEmpty(nombre))
            {
                return Results.BadRequest(new { error = "El nombre no puede estar vacío." });
            }

            await repo.RenameCarpetaAsync(id, nombre, ct);
            return Results.Ok(new { id, nombre });
        });

        // Mover carpeta (HU-24): valida que el destino no sea ella misma ni un descendiente
        group.MapPost("/carpetas/{id}/mover", async (
            string id, MoveRequest request, ClaimsPrincipal user, VaultRepository repo, CancellationToken ct) =>
        {
            if (await ForbiddenForCarpeta(repo, user, id, ct) is { } error) return error;

            var destino = NullIfEmpty(request.DestinoId);
            if (destino is not null)
            {
                var subtree = await repo.GetCarpetaSubtreeIdsAsync(id, ct);
                if (subtree.Contains(destino))
                {
                    return Results.BadRequest(new { error = "No se puede mover una carpeta dentro de sí misma ni de sus hijos." });
                }

                // El destino debe ser del mismo vault
                var vaultDestino = await repo.GetVaultIdOfCarpetaAsync(destino, ct);
                var vaultOrigen = await repo.GetVaultIdOfCarpetaAsync(id, ct);
                if (vaultDestino != vaultOrigen)
                {
                    return Results.BadRequest(new { error = "El destino no pertenece al mismo vault." });
                }
            }

            await repo.MoveCarpetaAsync(id, destino, ct);
            return Results.Ok(new { id, padreId = destino });
        });

        group.MapDelete("/carpetas/{id}", async (
            string id, ClaimsPrincipal user, VaultRepository repo, CancellationToken ct) =>
        {
            if (await ForbiddenForCarpeta(repo, user, id, ct) is { } error) return error;

            var vaultId = await repo.GetVaultIdOfCarpetaAsync(id, ct);
            var subtree = await repo.GetCarpetaSubtreeIdsAsync(id, ct);
            var notas = await repo.GetNotasInCarpetasAsync(subtree, ct);
            var rutas = await BuildRutaLookupAsync(repo, vaultId!, ct);

            var aPapelera = notas
                .Select(n =>
                {
                    var carpetaId = n.GetStringOrNull("carpeta_id");
                    return (n.GetString("id"), RutaDe(rutas, carpetaId), carpetaId);
                })
                .ToList();

            await repo.DeleteCarpetaAsync(id, aPapelera, ct);
            return Results.Ok(new { id, notasEnPapelera = aPapelera.Count });
        });

        // ── Notas (HU-23) ─────────────────────────────────────────
        group.MapPost("/vaults/{vaultId}/notas", async (
            string vaultId, CreateNotaRequest request, ClaimsPrincipal user, VaultRepository repo, CancellationToken ct) =>
        {
            if (await Forbidden(repo, user, vaultId, requireEditor: true, ct) is { } error) return error;

            var titulo = string.IsNullOrWhiteSpace(request.Titulo) ? "Sin título" : request.Titulo.Trim();
            var carpetaId = NullIfEmpty(request.CarpetaId);
            titulo = await EnsureUniqueTituloAsync(repo, vaultId, carpetaId, titulo, ct);
            var id = await repo.CreateNotaAsync(vaultId, carpetaId, titulo, ct);
            return Results.Created($"/notas/{id}", new { id, titulo });
        });

        group.MapPatch("/notas/{id}", async (
            string id, RenameNotaRequest request, ClaimsPrincipal user, VaultRepository repo, CancellationToken ct) =>
        {
            if (await ForbiddenForNota(repo, user, id, ct) is { } error) return error;
            var titulo = request.Titulo?.Trim();
            if (string.IsNullOrEmpty(titulo))
            {
                return Results.BadRequest(new { error = "El título no puede estar vacío." });
            }

            // Renombrar actualiza notas.titulo; r2_key permanece invariante (HU-23 CA3)
            await repo.RenameNotaAsync(id, titulo, ct);
            return Results.Ok(new { id, titulo });
        });

        group.MapPost("/notas/{id}/mover", async (
            string id, MoveRequest request, ClaimsPrincipal user, VaultRepository repo, CancellationToken ct) =>
        {
            if (await ForbiddenForNota(repo, user, id, ct) is { } error) return error;

            var destino = NullIfEmpty(request.DestinoId);
            if (destino is not null)
            {
                var vaultDestino = await repo.GetVaultIdOfCarpetaAsync(destino, ct);
                var vaultNota = await repo.GetVaultIdOfNotaAsync(id, ct);
                if (vaultDestino != vaultNota)
                {
                    return Results.BadRequest(new { error = "El destino no pertenece al mismo vault." });
                }
            }

            await repo.MoveNotaAsync(id, destino, ct);
            return Results.Ok(new { id, carpetaId = destino });
        });

        // Duplicar con sufijo numérico incremental (HU-23 CA5)
        group.MapPost("/notas/{id}/duplicar", async (
            string id, ClaimsPrincipal user, VaultRepository repo, CancellationToken ct) =>
        {
            if (await ForbiddenForNota(repo, user, id, ct) is { } error) return error;
            if (await repo.GetNotaAsync(id, ct) is not { } nota)
            {
                return Results.NotFound();
            }

            var vaultId = nota.GetString("vault_id");
            var carpetaId = nota.GetStringOrNull("carpeta_id");
            var titulo = await EnsureUniqueTituloAsync(repo, vaultId, carpetaId, nota.GetString("titulo"), ct);
            var nuevoId = await repo.CreateNotaAsync(vaultId, carpetaId, titulo, ct);
            // La copia del contenido .md se hace vía IBlobStorage al integrar HU-04.
            return Results.Created($"/notas/{nuevoId}", new { id = nuevoId, titulo });
        });

        // Eliminar → papelera (HU-23 CA6)
        group.MapDelete("/notas/{id}", async (
            string id, ClaimsPrincipal user, VaultRepository repo, CancellationToken ct) =>
        {
            if (await ForbiddenForNota(repo, user, id, ct) is { } error) return error;
            if (await repo.GetNotaAsync(id, ct) is not { } nota)
            {
                return Results.NotFound();
            }

            if (await repo.GetPapeleraEntryAsync(id, ct) is not null)
            {
                return Results.BadRequest(new { error = "La nota ya está en la papelera." });
            }

            var rutas = await BuildRutaLookupAsync(repo, nota.GetString("vault_id"), ct);
            var carpetaId = nota.GetStringOrNull("carpeta_id");
            await repo.SendToPapeleraAsync(id, RutaDe(rutas, carpetaId), carpetaId, ct);
            return Results.Ok(new { id });
        });

        // ── Papelera (HU-23 CA7–10) ───────────────────────────────
        group.MapGet("/vaults/{vaultId}/papelera", async (
            string vaultId, ClaimsPrincipal user, VaultRepository repo, CancellationToken ct) =>
        {
            if (await Forbidden(repo, user, vaultId, requireEditor: false, ct) is { } error) return error;
            await repo.PurgeExpiredAsync(vaultId, ct);
            return Results.Ok(new { items = await repo.GetPapeleraAsync(vaultId, ct) });
        });

        group.MapPost("/notas/{id}/recuperar", async (
            string id, ClaimsPrincipal user, VaultRepository repo, CancellationToken ct) =>
        {
            if (await ForbiddenForNota(repo, user, id, ct) is { } error) return error;
            if (await repo.GetPapeleraEntryAsync(id, ct) is not { } entry)
            {
                return Results.NotFound(new { error = "La nota no está en la papelera." });
            }

            // Restaura al directorio original; si ya no existe, a la raíz (CA8)
            var carpetaOriginal = entry.GetStringOrNull("carpeta_original_id");
            if (carpetaOriginal is not null && await repo.GetCarpetaAsync(carpetaOriginal, ct) is null)
            {
                carpetaOriginal = null;
            }

            await repo.RestoreFromPapeleraAsync(id, carpetaOriginal, ct);
            return Results.Ok(new { id, carpetaId = carpetaOriginal });
        });

        group.MapDelete("/notas/{id}/permanente", async (
            string id, ClaimsPrincipal user, VaultRepository repo, CancellationToken ct) =>
        {
            if (await ForbiddenForNota(repo, user, id, ct) is { } error) return error;
            if (await repo.GetPapeleraEntryAsync(id, ct) is null)
            {
                return Results.BadRequest(new { error = "Solo se pueden eliminar permanentemente notas en la papelera." });
            }

            await repo.DeleteNotaPermanentlyAsync(id, ct);
            return Results.Ok(new { id });
        });
    }

    // ── Helpers ───────────────────────────────────────────────────

    private static string? GetUserId(ClaimsPrincipal user) =>
        user.FindFirstValue(ClaimTypes.NameIdentifier) ?? user.FindFirstValue("sub");

    private static string? NullIfEmpty(string? value) =>
        string.IsNullOrWhiteSpace(value) ? null : value;

    /// <summary>403/401 si el usuario no tiene acceso (o rol insuficiente) al vault.</summary>
    private static async Task<IResult?> Forbidden(
        VaultRepository repo, ClaimsPrincipal user, string vaultId, bool requireEditor, CancellationToken ct)
    {
        var userId = GetUserId(user);
        if (userId is null) return Results.Json(new { error = "No autenticado." }, statusCode: 401);

        var rol = await repo.GetVaultRoleAsync(userId, vaultId, ct);
        if (rol is null) return Results.Json(new { error = "Sin acceso a este vault." }, statusCode: 403);
        if (requireEditor && rol == "lector")
        {
            return Results.Json(new { error = "Tu rol no permite editar." }, statusCode: 403);
        }

        return null;
    }

    private static async Task<IResult?> ForbiddenForCarpeta(
        VaultRepository repo, ClaimsPrincipal user, string carpetaId, CancellationToken ct)
    {
        var vaultId = await repo.GetVaultIdOfCarpetaAsync(carpetaId, ct);
        if (vaultId is null) return Results.NotFound(new { error = "La carpeta no existe." });
        return await Forbidden(repo, user, vaultId, requireEditor: true, ct);
    }

    private static async Task<IResult?> ForbiddenForNota(
        VaultRepository repo, ClaimsPrincipal user, string notaId, CancellationToken ct)
    {
        var vaultId = await repo.GetVaultIdOfNotaAsync(notaId, ct);
        if (vaultId is null) return Results.NotFound(new { error = "La nota no existe." });
        return await Forbidden(repo, user, vaultId, requireEditor: true, ct);
    }

    /// <summary>Lookup carpetaId → ruta completa ("Proyectos/Ideas").</summary>
    private static async Task<Dictionary<string, string>> BuildRutaLookupAsync(
        VaultRepository repo, string vaultId, CancellationToken ct)
    {
        var carpetas = await repo.GetAllCarpetasAsync(vaultId, ct);
        var porId = carpetas.ToDictionary(
            c => c.GetString("id"),
            c => (Padre: c.GetStringOrNull("padre_id"), Nombre: c.GetString("nombre")));

        var rutas = new Dictionary<string, string>();
        foreach (var id in porId.Keys)
        {
            var partes = new List<string>();
            var actual = (string?)id;
            while (actual is not null && porId.TryGetValue(actual, out var info))
            {
                partes.Insert(0, info.Nombre);
                actual = info.Padre;
            }

            rutas[id] = string.Join("/", partes);
        }

        return rutas;
    }

    private static string RutaDe(Dictionary<string, string> rutas, string? carpetaId) =>
        carpetaId is not null && rutas.TryGetValue(carpetaId, out var ruta) ? ruta : "/";

    /// <summary>
    /// Sufijo numérico incremental para títulos duplicados (HU-23 CA5):
    /// "Nota" → "Nota 2" → "Nota 3".
    /// </summary>
    private static async Task<string> EnsureUniqueTituloAsync(
        VaultRepository repo, string vaultId, string? carpetaId, string titulo, CancellationToken ct)
    {
        var existentes = (await repo.GetTitulosInCarpetaAsync(vaultId, carpetaId, ct))
            .ToHashSet(StringComparer.OrdinalIgnoreCase);
        if (!existentes.Contains(titulo)) return titulo;

        // Base sin sufijo numérico: "Nota 2" → "Nota"
        var partes = titulo.Split(' ');
        var baseTitulo = partes.Length > 1 && int.TryParse(partes[^1], out _)
            ? string.Join(' ', partes[..^1])
            : titulo;

        var n = 2;
        while (existentes.Contains($"{baseTitulo} {n}"))
        {
            n++;
        }

        return $"{baseTitulo} {n}";
    }

    public sealed record CreateCarpetaRequest(string? Nombre, string? PadreId);
    public sealed record RenameRequest(string? Nombre);
    public sealed record MoveRequest(string? DestinoId);
    public sealed record CreateNotaRequest(string? Titulo, string? CarpetaId);
    public sealed record RenameNotaRequest(string? Titulo);
}
