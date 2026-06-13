using System.Text.Json;
using Micelio.Api.Features.Common;
using Micelio.Api.Ports;

namespace Micelio.Api.Features.Vaults;

/// <summary>
/// Acceso a datos de compartición de carpetas y roles efectivos (HU-35/36).
/// Un usuario accede a una nota/carpeta por su rol de vault o por una membresía
/// de carpeta sobre cualquier ancestro. Idéntico en local (SQLite) y D1.
/// </summary>
public sealed class SharingRepository(ID1Client d1)
{
    private static string Now() => DateTime.UtcNow.ToString("O");

    private static readonly Dictionary<string, int> Precedence = new()
    {
        ["lector"] = 1,
        ["editor"] = 2,
        ["propietario"] = 3,
    };

    /// <summary>Devuelve el rol más alto entre dos (o el no nulo).</summary>
    private static string? Higher(string? a, string? b)
    {
        if (a is null) return b;
        if (b is null) return a;
        return Precedence.GetValueOrDefault(a) >= Precedence.GetValueOrDefault(b) ? a : b;
    }

    /// <summary>Ids de la carpeta y todos sus ancestros (de hija a raíz).</summary>
    private async Task<List<string>> AncestorsAsync(string carpetaId, CancellationToken ct)
    {
        var chain = new List<string>();
        string? current = carpetaId;
        var guard = 0;
        while (current is not null && guard++ < 256)
        {
            chain.Add(current);
            var res = await d1.QueryAsync("SELECT padre_id FROM carpetas WHERE id = ?", [current], ct);
            current = res.Results.Count > 0 ? res.Results[0].GetStringOrNull("padre_id") : null;
        }
        return chain;
    }

    /// <summary>Rol efectivo del usuario sobre una carpeta (vault o ancestro compartido).</summary>
    public async Task<string?> GetEffectiveCarpetaRoleAsync(
        string userId, string vaultId, string carpetaId, CancellationToken ct = default)
    {
        var vaultRole = await VaultRoleAsync(userId, vaultId, ct);
        var ancestors = await AncestorsAsync(carpetaId, ct);
        string? best = vaultRole;
        foreach (var id in ancestors)
        {
            var res = await d1.QueryAsync(
                "SELECT rol FROM membresias WHERE usuario_id = ? AND recurso_tipo = 'carpeta' AND recurso_id = ?",
                [userId, id], ct);
            if (res.Results.Count > 0) best = Higher(best, res.Results[0].GetString("rol"));
        }
        return best;
    }

    /// <summary>Rol efectivo del usuario sobre una nota (según su carpeta/vault).</summary>
    public async Task<string?> GetEffectiveNotaRoleAsync(string userId, string notaId, CancellationToken ct = default)
    {
        var res = await d1.QueryAsync("SELECT vault_id, carpeta_id FROM notas WHERE id = ?", [notaId], ct);
        if (res.Results.Count == 0) return null;
        var vaultId = res.Results[0].GetString("vault_id");
        var carpetaId = res.Results[0].GetStringOrNull("carpeta_id");
        var vaultRole = await VaultRoleAsync(userId, vaultId, ct);
        if (carpetaId is null) return vaultRole;
        return Higher(vaultRole, await GetEffectiveCarpetaRoleAsync(userId, vaultId, carpetaId, ct));
    }

    private async Task<string?> VaultRoleAsync(string userId, string vaultId, CancellationToken ct)
    {
        var res = await d1.QueryAsync(
            "SELECT rol FROM membresias WHERE usuario_id = ? AND recurso_tipo = 'vault' AND recurso_id = ?",
            [userId, vaultId], ct);
        return res.Results.Count > 0 ? res.Results[0].GetString("rol") : null;
    }

    // ── Gestión de miembros de carpeta ────────────────────────────

    /// <summary>Crea o actualiza la membresía de carpeta de un usuario (HU-35 CA3).</summary>
    public Task UpsertCarpetaMemberAsync(string usuarioId, string carpetaId, string rol, CancellationToken ct = default) =>
        d1.QueryAsync(
            """
            INSERT INTO membresias (id, usuario_id, recurso_tipo, recurso_id, rol, creado_en)
            VALUES (?, ?, 'carpeta', ?, ?, ?)
            ON CONFLICT(usuario_id, recurso_tipo, recurso_id) DO UPDATE SET rol = excluded.rol
            """,
            [Guid.NewGuid().ToString(), usuarioId, carpetaId, rol, Now()], ct);

    public async Task<IReadOnlyList<JsonElement>> GetCarpetaMembersAsync(string carpetaId, CancellationToken ct = default)
    {
        var res = await d1.QueryAsync(
            """
            SELECT m.usuario_id, u.email, u.nombre, m.rol, m.creado_en
            FROM membresias m JOIN usuarios u ON u.id = m.usuario_id
            WHERE m.recurso_tipo = 'carpeta' AND m.recurso_id = ?
            ORDER BY m.creado_en
            """,
            [carpetaId], ct);
        return res.Results;
    }

    public Task UpdateCarpetaMemberRoleAsync(string usuarioId, string carpetaId, string rol, CancellationToken ct = default) =>
        d1.QueryAsync(
            "UPDATE membresias SET rol = ? WHERE usuario_id = ? AND recurso_tipo = 'carpeta' AND recurso_id = ?",
            [rol, usuarioId, carpetaId], ct);

    public Task RemoveCarpetaMemberAsync(string usuarioId, string carpetaId, CancellationToken ct = default) =>
        d1.QueryAsync(
            "DELETE FROM membresias WHERE usuario_id = ? AND recurso_tipo = 'carpeta' AND recurso_id = ?",
            [usuarioId, carpetaId], ct);

    /// <summary>Cuenta propietarios efectivos de la carpeta: vault + membresías (HU-35 CA8).</summary>
    public async Task<int> CountPropietariosAsync(string vaultId, string carpetaId, CancellationToken ct = default)
    {
        var vaultOwners = await d1.QueryAsync(
            "SELECT COUNT(*) AS n FROM membresias WHERE recurso_tipo = 'vault' AND recurso_id = ? AND rol = 'propietario'",
            [vaultId], ct);
        var folderOwners = await d1.QueryAsync(
            "SELECT COUNT(*) AS n FROM membresias WHERE recurso_tipo = 'carpeta' AND recurso_id = ? AND rol = 'propietario'",
            [carpetaId], ct);
        return (int)folderOwners.Results[0].GetInt64("n") + (int)vaultOwners.Results[0].GetInt64("n");
    }

    /// <summary>
    /// true si la nota está dentro de una carpeta compartida (la carpeta o algún
    /// ancestro tiene membresías de carpeta). Habilita la colaboración (HU-05 CA5).
    /// </summary>
    public async Task<bool> IsNotaInSharedFolderAsync(string notaId, CancellationToken ct = default)
    {
        var res = await d1.QueryAsync("SELECT carpeta_id FROM notas WHERE id = ?", [notaId], ct);
        if (res.Results.Count == 0) return false;
        var carpetaId = res.Results[0].GetStringOrNull("carpeta_id");
        if (carpetaId is null) return false;

        foreach (var id in await AncestorsAsync(carpetaId, ct))
        {
            var m = await d1.QueryAsync(
                "SELECT 1 FROM membresias WHERE recurso_tipo = 'carpeta' AND recurso_id = ? LIMIT 1",
                [id], ct);
            if (m.Results.Count > 0) return true;
        }
        return false;
    }

    /// <summary>Carpetas compartidas con el usuario (sección "Compartido", HU-35 CA4).</summary>
    public async Task<IReadOnlyList<JsonElement>> GetSharedCarpetasAsync(string userId, CancellationToken ct = default)
    {
        var res = await d1.QueryAsync(
            """
            SELECT c.id, c.vault_id, c.padre_id, c.nombre, m.rol, v.nombre AS vault_nombre
            FROM membresias m
            JOIN carpetas c ON c.id = m.recurso_id
            JOIN vaults v ON v.id = c.vault_id
            WHERE m.usuario_id = ? AND m.recurso_tipo = 'carpeta'
            ORDER BY c.nombre
            """,
            [userId], ct);
        return res.Results;
    }
}
