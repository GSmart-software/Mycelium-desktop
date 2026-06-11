using System.Text.Json;
using Micelio.Api.Ports;

namespace Micelio.Api.Features.Auth;

/// <summary>
/// Acceso a datos de auth contra <see cref="ID1Client"/> (HU-32/HU-33).
/// Funciona idéntico en modo local (SQLite) y cloudflare (D1).
/// </summary>
public sealed class AuthRepository(ID1Client d1)
{
    public async Task<JsonElement?> FindUserByEmailAsync(string email, CancellationToken ct = default)
    {
        var result = await d1.QueryAsync(
            "SELECT * FROM usuarios WHERE email = ?", [email], ct);
        return result.Results.Count > 0 ? result.Results[0] : null;
    }

    public async Task<JsonElement?> FindUserByIdAsync(string id, CancellationToken ct = default)
    {
        var result = await d1.QueryAsync(
            "SELECT * FROM usuarios WHERE id = ?", [id], ct);
        return result.Results.Count > 0 ? result.Results[0] : null;
    }

    /// <summary>
    /// Alta transaccional de usuario + vault personal privado + membresía
    /// propietario (HU-33 CA1): o se crea todo, o nada.
    /// </summary>
    public async Task CreateUserWithPersonalVaultAsync(
        string userId,
        string email,
        string nombre,
        string? passwordHash,
        bool emailVerificado,
        CancellationToken ct = default)
    {
        var now = DateTime.UtcNow.ToString("O");
        var vaultId = Guid.NewGuid().ToString();
        await d1.BatchAsync(
        [
            new D1Statement(
                """
                INSERT INTO usuarios (id, email, nombre, password_hash, email_verificado, creado_en, actualizado_en)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                [userId, email, nombre, passwordHash, emailVerificado, now, now]),
            new D1Statement(
                "INSERT INTO vaults (id, nombre, propietario_id, creado_en) VALUES (?, ?, ?, ?)",
                [vaultId, $"Vault de {nombre}", userId, now]),
            new D1Statement(
                """
                INSERT INTO membresias (id, usuario_id, recurso_tipo, recurso_id, rol, creado_en)
                VALUES (?, ?, 'vault', ?, 'propietario', ?)
                """,
                [Guid.NewGuid().ToString(), userId, vaultId, now]),
        ], ct);
    }

    public Task SetEmailVerifiedAsync(string userId, CancellationToken ct = default) =>
        d1.QueryAsync(
            "UPDATE usuarios SET email_verificado = 1, actualizado_en = ? WHERE id = ?",
            [DateTime.UtcNow.ToString("O"), userId], ct);

    public Task UpdatePasswordAsync(string userId, string passwordHash, CancellationToken ct = default) =>
        d1.QueryAsync(
            "UPDATE usuarios SET password_hash = ?, actualizado_en = ? WHERE id = ?",
            [passwordHash, DateTime.UtcNow.ToString("O"), userId], ct);

    // ── Refresh tokens ────────────────────────────────────────────

    public Task InsertRefreshTokenAsync(string userId, string tokenHash, DateTime expiraEn, CancellationToken ct = default) =>
        d1.QueryAsync(
            """
            INSERT INTO refresh_tokens (id, usuario_id, token_hash, expira_en, creado_en)
            VALUES (?, ?, ?, ?, ?)
            """,
            [Guid.NewGuid().ToString(), userId, tokenHash, expiraEn.ToString("O"), DateTime.UtcNow.ToString("O")], ct);

    public async Task<JsonElement?> FindActiveRefreshTokenAsync(string tokenHash, CancellationToken ct = default)
    {
        var result = await d1.QueryAsync(
            "SELECT * FROM refresh_tokens WHERE token_hash = ? AND revocado = 0 AND expira_en > ?",
            [tokenHash, DateTime.UtcNow.ToString("O")], ct);
        return result.Results.Count > 0 ? result.Results[0] : null;
    }

    public Task RevokeRefreshTokenAsync(string id, CancellationToken ct = default) =>
        d1.QueryAsync("UPDATE refresh_tokens SET revocado = 1 WHERE id = ?", [id], ct);

    public Task RevokeAllRefreshTokensAsync(string userId, CancellationToken ct = default) =>
        d1.QueryAsync("UPDATE refresh_tokens SET revocado = 1 WHERE usuario_id = ?", [userId], ct);

    // ── Tokens de un solo uso (verificación de email / reset) ─────

    public Task InsertOneUseTokenAsync(string userId, string tipo, string tokenHash, DateTime expiraEn, CancellationToken ct = default) =>
        d1.QueryAsync(
            """
            INSERT INTO tokens_un_uso (id, usuario_id, tipo, token_hash, expira_en, creado_en)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            [Guid.NewGuid().ToString(), userId, tipo, tokenHash, expiraEn.ToString("O"), DateTime.UtcNow.ToString("O")], ct);

    public async Task<JsonElement?> FindOneUseTokenAsync(string tokenHash, string tipo, CancellationToken ct = default)
    {
        var result = await d1.QueryAsync(
            "SELECT * FROM tokens_un_uso WHERE token_hash = ? AND tipo = ? AND usado = 0 AND expira_en > ?",
            [tokenHash, tipo, DateTime.UtcNow.ToString("O")], ct);
        return result.Results.Count > 0 ? result.Results[0] : null;
    }

    public Task MarkOneUseTokenUsedAsync(string id, CancellationToken ct = default) =>
        d1.QueryAsync("UPDATE tokens_un_uso SET usado = 1 WHERE id = ?", [id], ct);

    // ── Vaults del usuario ────────────────────────────────────────

    public async Task<IReadOnlyList<JsonElement>> GetUserVaultsAsync(string userId, CancellationToken ct = default)
    {
        var result = await d1.QueryAsync(
            """
            SELECT v.id, v.nombre, v.propietario_id, m.rol
            FROM vaults v
            JOIN membresias m ON m.recurso_tipo = 'vault' AND m.recurso_id = v.id
            WHERE m.usuario_id = ?
            ORDER BY v.creado_en
            """,
            [userId], ct);
        return result.Results;
    }
}
