using System.Security.Claims;
using Micelio.Api.Features.Auth;
using Micelio.Api.Features.Common;
using Micelio.Api.Ports;

namespace Micelio.Api.Features.Vaults;

/// <summary>
/// Compartir carpetas, gestionar miembros y roles (HU-35/36). Las notificaciones
/// se entregan vía IEmailSender (en local quedan logueadas, como la verificación
/// de email). La sección "Compartido" del explorer consume GET /compartido.
/// </summary>
public static class SharingEndpoints
{
    private static readonly string[] Roles = ["lector", "editor", "propietario"];

    public static void MapSharingEndpoints(this WebApplication app)
    {
        var group = app.MapGroup("").RequireAuthorization();

        // ── Compartir carpeta (HU-35) ─────────────────────────────
        group.MapPost("/carpetas/{id}/compartir", async (
            string id,
            ShareRequest request,
            ClaimsPrincipal user,
            VaultRepository vaults,
            SharingRepository sharing,
            AuthRepository auth,
            IEmailSender email,
            CancellationToken ct) =>
        {
            var userId = GetUserId(user);
            var vaultId = await vaults.GetVaultIdOfCarpetaAsync(id, ct);
            if (vaultId is null) return Results.NotFound();
            if (userId is null ||
                await sharing.GetEffectiveCarpetaRoleAsync(userId, vaultId, id, ct) != "propietario")
            {
                return Results.Json(new { error = "Solo el propietario puede compartir." }, statusCode: 403);
            }

            var rol = request.Rol?.ToLowerInvariant() ?? "";
            if (!Roles.Contains(rol)) return Results.BadRequest(new { error = "Rol inválido." });

            var emailDest = request.Email?.Trim().ToLowerInvariant() ?? "";
            if (await auth.FindUserByEmailAsync(emailDest, ct) is not { } dest)
            {
                return Results.NotFound(new { error = "No existe un usuario con ese email." });
            }
            var destId = dest.GetString("id");

            await sharing.UpsertCarpetaMemberAsync(destId, id, rol, ct);
            var carpeta = await vaults.GetCarpetaAsync(id, ct);
            var nombre = carpeta?.GetString("nombre") ?? "una carpeta";
            await email.SendAsync(emailDest, "Te compartieron una carpeta en Micelio",
                $"Tenés acceso ({rol}) a la carpeta «{nombre}».", ct); // CA9

            return Results.Ok(new { ok = true });
        });

        // ── Listar miembros (HU-36 CA1) ───────────────────────────
        group.MapGet("/carpetas/{id}/miembros", async (
            string id,
            ClaimsPrincipal user,
            VaultRepository vaults,
            SharingRepository sharing,
            CancellationToken ct) =>
        {
            var userId = GetUserId(user);
            var vaultId = await vaults.GetVaultIdOfCarpetaAsync(id, ct);
            if (vaultId is null) return Results.NotFound();
            if (userId is null ||
                await sharing.GetEffectiveCarpetaRoleAsync(userId, vaultId, id, ct) != "propietario")
            {
                return Results.Json(new { error = "Solo el propietario puede gestionar." }, statusCode: 403);
            }
            return Results.Ok(new { miembros = await sharing.GetCarpetaMembersAsync(id, ct) });
        });

        // ── Cambiar rol (HU-36 CA2/CA4) ───────────────────────────
        group.MapPatch("/carpetas/{id}/miembros/{usuarioId}", async (
            string id,
            string usuarioId,
            RolRequest request,
            ClaimsPrincipal user,
            VaultRepository vaults,
            SharingRepository sharing,
            IEmailSender email,
            AuthRepository auth,
            CancellationToken ct) =>
        {
            var userId = GetUserId(user);
            var vaultId = await vaults.GetVaultIdOfCarpetaAsync(id, ct);
            if (vaultId is null) return Results.NotFound();
            if (userId is null ||
                await sharing.GetEffectiveCarpetaRoleAsync(userId, vaultId, id, ct) != "propietario")
            {
                return Results.Json(new { error = "Solo el propietario puede gestionar." }, statusCode: 403);
            }
            var rol = request.Rol?.ToLowerInvariant() ?? "";
            if (!Roles.Contains(rol)) return Results.BadRequest(new { error = "Rol inválido." });

            // No dejar la carpeta sin propietario al degradar al último (CA4):
            // solo aplica si el miembro objetivo es hoy propietario.
            var members = await sharing.GetCarpetaMembersAsync(id, ct);
            var current = members.FirstOrDefault(m => m.GetString("usuario_id") == usuarioId);
            var eraPropietario = current.ValueKind != System.Text.Json.JsonValueKind.Undefined
                && current.GetString("rol") == "propietario";
            if (eraPropietario && rol != "propietario"
                && await sharing.CountPropietariosAsync(vaultId, id, ct) <= 1)
            {
                return Results.BadRequest(new { error = "Debe haber al menos un propietario." });
            }

            await sharing.UpdateCarpetaMemberRoleAsync(usuarioId, id, rol, ct);
            if (await auth.FindUserByIdAsync(usuarioId, ct) is { } u)
            {
                await email.SendAsync(u.GetString("email"), "Tu rol cambió en Micelio",
                    $"Tu rol en una carpeta compartida ahora es {rol}.", ct); // CA5
            }
            return Results.Ok(new { ok = true });
        });

        // ── Revocar acceso (HU-36 CA3/CA4) ────────────────────────
        group.MapDelete("/carpetas/{id}/miembros/{usuarioId}", async (
            string id,
            string usuarioId,
            ClaimsPrincipal user,
            VaultRepository vaults,
            SharingRepository sharing,
            IEmailSender email,
            AuthRepository auth,
            CancellationToken ct) =>
        {
            var userId = GetUserId(user);
            var vaultId = await vaults.GetVaultIdOfCarpetaAsync(id, ct);
            if (vaultId is null) return Results.NotFound();
            if (userId is null ||
                await sharing.GetEffectiveCarpetaRoleAsync(userId, vaultId, id, ct) != "propietario")
            {
                return Results.Json(new { error = "Solo el propietario puede gestionar." }, statusCode: 403);
            }

            var members = await sharing.GetCarpetaMembersAsync(id, ct);
            var target = members.FirstOrDefault(m => m.GetString("usuario_id") == usuarioId);
            if (target.ValueKind != System.Text.Json.JsonValueKind.Undefined
                && target.GetString("rol") == "propietario"
                && await sharing.CountPropietariosAsync(vaultId, id, ct) <= 1)
            {
                return Results.BadRequest(new { error = "Debe haber al menos un propietario." });
            }

            await sharing.RemoveCarpetaMemberAsync(usuarioId, id, ct);
            if (await auth.FindUserByIdAsync(usuarioId, ct) is { } u)
            {
                await email.SendAsync(u.GetString("email"), "Se revocó tu acceso en Micelio",
                    "Ya no tenés acceso a una carpeta que te habían compartido.", ct); // CA5
            }
            return Results.Ok(new { ok = true });
        });

        // ── Ids de carpetas compartidas del vault (marcador, HU-35 CA5) ──
        group.MapGet("/vaults/{vaultId}/carpetas-compartidas", async (
            string vaultId,
            ClaimsPrincipal user,
            VaultRepository vaults,
            SharingRepository sharing,
            CancellationToken ct) =>
        {
            var userId = GetUserId(user);
            if (userId is null || await vaults.GetVaultRoleAsync(userId, vaultId, ct) is null)
            {
                return Results.Json(new { error = "Sin acceso." }, statusCode: 403);
            }
            return Results.Ok(new { ids = await sharing.GetSharedCarpetaIdsAsync(vaultId, ct) });
        });

        // ── Carpetas compartidas conmigo (HU-35 CA4/CA5) ──────────
        group.MapGet("/compartido", async (
            ClaimsPrincipal user,
            VaultRepository vaults,
            SharingRepository sharing,
            CancellationToken ct) =>
        {
            var userId = GetUserId(user);
            if (userId is null) return Results.Unauthorized();

            var compartidas = await sharing.GetSharedCarpetasAsync(userId, ct);
            var items = new List<object>();
            foreach (var c in compartidas)
            {
                var carpetaId = c.GetString("id");
                var vaultId = c.GetString("vault_id");
                var subtreeIds = await vaults.GetCarpetaSubtreeIdsAsync(carpetaId, ct);
                var allCarpetas = await vaults.GetAllCarpetasAsync(vaultId, ct);
                var subCarpetas = allCarpetas
                    .Where(x => subtreeIds.Contains(x.GetString("id")))
                    .Select(x => new
                    {
                        id = x.GetString("id"),
                        padreId = x.GetStringOrNull("padre_id"),
                        nombre = x.GetString("nombre"),
                    });
                var notas = (await vaults.GetNotasInCarpetasAsync(subtreeIds, ct))
                    .Select(n => new
                    {
                        id = n.GetString("id"),
                        carpetaId = n.GetStringOrNull("carpeta_id"),
                        titulo = n.GetString("titulo"),
                    });
                items.Add(new
                {
                    id = carpetaId,
                    nombre = c.GetString("nombre"),
                    vaultNombre = c.GetString("vault_nombre"),
                    rol = c.GetString("rol"),
                    carpetas = subCarpetas,
                    notas,
                });
            }
            return Results.Ok(new { compartidos = items });
        });
    }

    private static string? GetUserId(ClaimsPrincipal user) =>
        user.FindFirstValue(ClaimTypes.NameIdentifier) ?? user.FindFirstValue("sub");

    public sealed record ShareRequest(string? Email, string? Rol);
    public sealed record RolRequest(string? Rol);
}
