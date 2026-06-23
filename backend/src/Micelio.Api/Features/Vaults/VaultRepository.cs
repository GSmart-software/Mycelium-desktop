using System.Text.Json;
using Micelio.Api.Features.Common;
using Micelio.Api.Ports;

namespace Micelio.Api.Features.Vaults;

/// <summary>
/// Acceso a datos de carpetas, notas y papelera (HU-22/23/24) vía ID1Client.
/// </summary>
public sealed class VaultRepository(ID1Client d1)
{
    private static string Now() => DateTime.UtcNow.ToString("O");

    // ── Autorización ──────────────────────────────────────────────

    public async Task<string?> GetVaultRoleAsync(string userId, string vaultId, CancellationToken ct = default)
    {
        var result = await d1.QueryAsync(
            "SELECT rol FROM membresias WHERE usuario_id = ? AND recurso_tipo = 'vault' AND recurso_id = ?",
            [userId, vaultId], ct);
        return result.Results.Count > 0 ? result.Results[0].GetString("rol") : null;
    }

    public async Task<string?> GetVaultIdOfCarpetaAsync(string carpetaId, CancellationToken ct = default)
    {
        var result = await d1.QueryAsync(
            "SELECT vault_id FROM carpetas WHERE id = ?", [carpetaId], ct);
        return result.Results.Count > 0 ? result.Results[0].GetString("vault_id") : null;
    }

    public async Task<string?> GetVaultIdOfNotaAsync(string notaId, CancellationToken ct = default)
    {
        var result = await d1.QueryAsync(
            "SELECT vault_id FROM notas WHERE id = ?", [notaId], ct);
        return result.Results.Count > 0 ? result.Results[0].GetString("vault_id") : null;
    }

    // ── Árbol del explorer ────────────────────────────────────────

    public async Task<(IReadOnlyList<JsonElement> Carpetas, IReadOnlyList<JsonElement> Notas)> GetTreeAsync(
        string vaultId, CancellationToken ct = default)
    {
        var carpetas = await d1.QueryAsync(
            "SELECT id, padre_id, nombre FROM carpetas WHERE vault_id = ? ORDER BY nombre COLLATE NOCASE",
            [vaultId], ct);
        var notas = await d1.QueryAsync(
            """
            SELECT id, carpeta_id, titulo, tipo, creado_en, actualizado_en FROM notas
            WHERE vault_id = ? AND id NOT IN (SELECT nota_id FROM papelera)
            ORDER BY titulo COLLATE NOCASE
            """,
            [vaultId], ct);
        return (carpetas.Results, notas.Results);
    }

    // ── Carpetas (HU-22) ──────────────────────────────────────────

    public async Task<string> CreateCarpetaAsync(string vaultId, string? padreId, string nombre, CancellationToken ct = default)
    {
        var id = Guid.NewGuid().ToString();
        var now = Now();
        await d1.QueryAsync(
            "INSERT INTO carpetas (id, vault_id, padre_id, nombre, creado_en, actualizado_en) VALUES (?, ?, ?, ?, ?, ?)",
            [id, vaultId, padreId, nombre, now, now], ct);
        return id;
    }

    public Task RenameCarpetaAsync(string carpetaId, string nombre, CancellationToken ct = default) =>
        d1.QueryAsync(
            "UPDATE carpetas SET nombre = ?, actualizado_en = ? WHERE id = ?",
            [nombre, Now(), carpetaId], ct);

    /// <summary>IDs de la carpeta y todas sus descendientes.</summary>
    public async Task<IReadOnlyList<string>> GetCarpetaSubtreeIdsAsync(string carpetaId, CancellationToken ct = default)
    {
        var result = await d1.QueryAsync(
            """
            WITH RECURSIVE sub(id) AS (
              SELECT id FROM carpetas WHERE id = ?
              UNION ALL
              SELECT c.id FROM carpetas c JOIN sub s ON c.padre_id = s.id
            )
            SELECT id FROM sub
            """,
            [carpetaId], ct);
        return result.Results.Select(r => r.GetString("id")).ToList();
    }

    public async Task<IReadOnlyList<JsonElement>> GetNotasInCarpetasAsync(
        IReadOnlyList<string> carpetaIds, CancellationToken ct = default)
    {
        if (carpetaIds.Count == 0) return [];
        var placeholders = string.Join(", ", carpetaIds.Select(_ => "?"));
        var result = await d1.QueryAsync(
            $"SELECT id, titulo, carpeta_id FROM notas WHERE carpeta_id IN ({placeholders}) AND id NOT IN (SELECT nota_id FROM papelera)",
            [.. carpetaIds], ct);
        return result.Results;
    }

    /// <summary>
    /// Elimina una carpeta: sus notas (recursivas) van a la papelera y el
    /// subárbol de carpetas se borra en una única transacción.
    /// </summary>
    public async Task DeleteCarpetaAsync(
        string carpetaId,
        IReadOnlyList<(string NotaId, string RutaOriginal, string? CarpetaOriginalId)> notasAPapelera,
        CancellationToken ct = default)
    {
        var statements = new List<D1Statement>();
        var now = Now();
        foreach (var (notaId, ruta, carpetaOriginal) in notasAPapelera)
        {
            statements.Add(new D1Statement(
                "INSERT OR IGNORE INTO papelera (id, nota_id, ruta_original, carpeta_original_id, eliminado_en) VALUES (?, ?, ?, ?, ?)",
                [Guid.NewGuid().ToString(), notaId, ruta, carpetaOriginal, now]));
        }

        statements.Add(new D1Statement("DELETE FROM carpetas WHERE id = ?", [carpetaId]));
        await d1.BatchAsync(statements, ct);
    }

    public Task MoveCarpetaAsync(string carpetaId, string? nuevoPadreId, CancellationToken ct = default) =>
        d1.QueryAsync(
            "UPDATE carpetas SET padre_id = ?, actualizado_en = ? WHERE id = ?",
            [nuevoPadreId, Now(), carpetaId], ct);

    public async Task<JsonElement?> GetCarpetaAsync(string carpetaId, CancellationToken ct = default)
    {
        var result = await d1.QueryAsync(
            "SELECT * FROM carpetas WHERE id = ?", [carpetaId], ct);
        return result.Results.Count > 0 ? result.Results[0] : null;
    }

    public async Task<IReadOnlyList<JsonElement>> GetAllCarpetasAsync(string vaultId, CancellationToken ct = default)
    {
        var result = await d1.QueryAsync(
            "SELECT id, padre_id, nombre FROM carpetas WHERE vault_id = ?", [vaultId], ct);
        return result.Results;
    }

    // ── Notas (HU-23) ─────────────────────────────────────────────

    public async Task<string> CreateNotaAsync(
        string vaultId, string? carpetaId, string titulo, string tipo = "markdown", CancellationToken ct = default)
    {
        var id = Guid.NewGuid().ToString();
        var now = Now();
        // r2_key ID-based e invariante ante renombres (HU-23 CA3). La extensión
        // refleja el tipo: .md para notas, .excalidraw para dibujos (HU-16).
        var ext = tipo == "excalidraw" ? "excalidraw" : "md";
        var r2Key = $"vaults/{vaultId}/notas/{id}.{ext}";
        await d1.QueryAsync(
            """
            INSERT INTO notas (id, vault_id, carpeta_id, titulo, tipo, r2_key, creado_en, actualizado_en)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            [id, vaultId, carpetaId, titulo, tipo, r2Key, now, now], ct);
        return id;
    }

    public async Task<JsonElement?> GetNotaAsync(string notaId, CancellationToken ct = default)
    {
        var result = await d1.QueryAsync("SELECT * FROM notas WHERE id = ?", [notaId], ct);
        return result.Results.Count > 0 ? result.Results[0] : null;
    }

    public Task RenameNotaAsync(string notaId, string titulo, CancellationToken ct = default) =>
        d1.QueryAsync(
            "UPDATE notas SET titulo = ?, actualizado_en = ? WHERE id = ?",
            [titulo, Now(), notaId], ct);

    public Task MoveNotaAsync(string notaId, string? carpetaId, CancellationToken ct = default) =>
        d1.QueryAsync(
            "UPDATE notas SET carpeta_id = ?, actualizado_en = ? WHERE id = ?",
            [carpetaId, Now(), notaId], ct);

    public async Task<IReadOnlyList<string>> GetTitulosInCarpetaAsync(
        string vaultId, string? carpetaId, CancellationToken ct = default)
    {
        var result = carpetaId is null
            ? await d1.QueryAsync(
                "SELECT titulo FROM notas WHERE vault_id = ? AND carpeta_id IS NULL AND id NOT IN (SELECT nota_id FROM papelera)",
                [vaultId], ct)
            : await d1.QueryAsync(
                "SELECT titulo FROM notas WHERE vault_id = ? AND carpeta_id = ? AND id NOT IN (SELECT nota_id FROM papelera)",
                [vaultId, carpetaId], ct);
        return result.Results.Select(r => r.GetString("titulo")).ToList();
    }

    /// <summary>
    /// Actualiza metadatos tras guardar contenido (HU-04) y refresca el
    /// índice FTS5 (HU-21 CA10). Devuelve el nuevo actualizado_en.
    /// </summary>
    public async Task<string> TouchNotaContenidoAsync(
        string notaId, string titulo, string contenido, long tamanoBytes, CancellationToken ct = default)
    {
        var now = Now();
        await d1.BatchAsync(
        [
            new D1Statement(
                "UPDATE notas SET tamano_bytes = ?, actualizado_en = ? WHERE id = ?",
                [tamanoBytes, now, notaId]),
            new D1Statement("DELETE FROM notas_fts WHERE nota_id = ?", [notaId]),
            new D1Statement(
                "INSERT INTO notas_fts (nota_id, titulo, contenido) VALUES (?, ?, ?)",
                [notaId, titulo, contenido]),
        ], ct);
        return now;
    }

    // ── Papelera (HU-23 CA6–10) ───────────────────────────────────

    public Task SendToPapeleraAsync(string notaId, string rutaOriginal, string? carpetaOriginalId, CancellationToken ct = default) =>
        d1.QueryAsync(
            "INSERT INTO papelera (id, nota_id, ruta_original, carpeta_original_id, eliminado_en) VALUES (?, ?, ?, ?, ?)",
            [Guid.NewGuid().ToString(), notaId, rutaOriginal, carpetaOriginalId, Now()], ct);

    public async Task<IReadOnlyList<JsonElement>> GetPapeleraAsync(string vaultId, CancellationToken ct = default)
    {
        var result = await d1.QueryAsync(
            """
            SELECT p.nota_id, n.titulo, p.ruta_original, p.carpeta_original_id, p.eliminado_en
            FROM papelera p JOIN notas n ON n.id = p.nota_id
            WHERE n.vault_id = ?
            ORDER BY p.eliminado_en DESC
            """,
            [vaultId], ct);
        return result.Results;
    }

    public async Task<JsonElement?> GetPapeleraEntryAsync(string notaId, CancellationToken ct = default)
    {
        var result = await d1.QueryAsync(
            "SELECT * FROM papelera WHERE nota_id = ?", [notaId], ct);
        return result.Results.Count > 0 ? result.Results[0] : null;
    }

    public Task RestoreFromPapeleraAsync(string notaId, string? carpetaId, CancellationToken ct = default) =>
        d1.BatchAsync(
        [
            new D1Statement("UPDATE notas SET carpeta_id = ?, actualizado_en = ? WHERE id = ?", [carpetaId, Now(), notaId]),
            new D1Statement("DELETE FROM papelera WHERE nota_id = ?", [notaId]),
        ], ct);

    public Task DeleteNotaPermanentlyAsync(string notaId, CancellationToken ct = default) =>
        // papelera y notas_fts se limpian por separado; el blob se borra vía IBlobStorage (HU-04)
        d1.BatchAsync(
        [
            new D1Statement("DELETE FROM papelera WHERE nota_id = ?", [notaId]),
            new D1Statement("DELETE FROM notas_fts WHERE nota_id = ?", [notaId]),
            new D1Statement("DELETE FROM notas WHERE id = ?", [notaId]),
        ], ct);

    /// <summary>Purga permanente de notas con más de 30 días en la papelera (HU-23 CA7).</summary>
    public async Task<IReadOnlyList<string>> PurgeExpiredAsync(string vaultId, CancellationToken ct = default)
    {
        var cutoff = DateTime.UtcNow.AddDays(-30).ToString("O");
        var expired = await d1.QueryAsync(
            """
            SELECT p.nota_id FROM papelera p JOIN notas n ON n.id = p.nota_id
            WHERE n.vault_id = ? AND p.eliminado_en < ?
            """,
            [vaultId, cutoff], ct);
        var ids = expired.Results.Select(r => r.GetString("nota_id")).ToList();
        foreach (var id in ids)
        {
            await DeleteNotaPermanentlyAsync(id, ct);
        }

        return ids;
    }
}
