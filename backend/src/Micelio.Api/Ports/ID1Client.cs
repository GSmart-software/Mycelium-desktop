using System.Text.Json;

namespace Micelio.Api.Ports;

/// <summary>
/// Puerto de acceso a datos relacional (Cloudflare D1 o SQLite local — HU-39).
/// Las implementaciones devuelven el envelope JSON de D1 para que los
/// repositorios y mappers funcionen sin cambios en ambos modos.
/// </summary>
public interface ID1Client
{
    /// <summary>SELECT y escrituras individuales. Parámetros posicionales <c>?</c> en orden.</summary>
    Task<D1Result> QueryAsync(string sql, IReadOnlyList<object?>? parameters = null, CancellationToken ct = default);

    /// <summary>Varias sentencias en una única transacción con rollback ante fallo.</summary>
    Task<IReadOnlyList<D1Result>> BatchAsync(IReadOnlyList<D1Statement> statements, CancellationToken ct = default);
}

public sealed record D1Statement(string Sql, IReadOnlyList<object?>? Parameters = null);

/// <summary>Envelope de D1: <c>{ "results": [...], "success": true, "meta": { "changes", "last_row_id" } }</c>.</summary>
public sealed record D1Result(IReadOnlyList<JsonElement> Results, bool Success, D1Meta Meta);

public sealed record D1Meta(long Changes, long LastRowId);
