using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using Micelio.Api.Ports;

namespace Micelio.Api.Adapters.Cloudflare;

/// <summary>
/// Adaptador Cloudflare D1 sobre la REST API (HU-39). Devuelve el mismo envelope
/// que <c>LocalSqliteD1Client</c>, de modo que los repositorios y mappers
/// funcionan sin cambios. Se activa con <c>Storage:Provider=cloudflare</c>.
/// </summary>
public sealed class D1Client : ID1Client
{
    private readonly IHttpClientFactory _httpFactory;
    private readonly string _endpoint;
    private readonly string _apiToken;

    public D1Client(IHttpClientFactory httpFactory, IConfiguration config)
    {
        _httpFactory = httpFactory;
        var accountId = Require(config, "Cloudflare:AccountId");
        var databaseId = Require(config, "Cloudflare:D1:DatabaseId");
        _apiToken = Require(config, "Cloudflare:ApiToken");
        _endpoint = $"https://api.cloudflare.com/client/v4/accounts/{accountId}/d1/database/{databaseId}/query";
    }

    public async Task<D1Result> QueryAsync(string sql, IReadOnlyList<object?>? parameters = null, CancellationToken ct = default)
    {
        var results = await SendAsync(sql, parameters ?? [], ct);
        return results.Count > 0 ? results[0] : new D1Result([], Success: true, new D1Meta(0, 0));
    }

    public async Task<IReadOnlyList<D1Result>> BatchAsync(IReadOnlyList<D1Statement> statements, CancellationToken ct = default)
    {
        // D1 REST NO soporta parámetros con múltiples sentencias en una sola
        // petición (error 7400 "params with multiple statements is not
        // supported"), ni transacciones explícitas como el binding de Workers.
        // Se ejecuta cada sentencia en su propia petición, en orden. Caveat: sin
        // atomicidad/rollback entre sentencias (aceptado para estos usos).
        var results = new List<D1Result>(statements.Count);
        foreach (var statement in statements)
        {
            var single = await SendAsync(statement.Sql, statement.Parameters ?? [], ct);
            results.Add(single.Count > 0 ? single[0] : new D1Result([], Success: true, new D1Meta(0, 0)));
        }

        return results;
    }

    private async Task<List<D1Result>> SendAsync(string sql, IReadOnlyList<object?> parameters, CancellationToken ct)
    {
        using var http = _httpFactory.CreateClient();
        http.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", _apiToken);

        var payload = new
        {
            sql,
            @params = parameters.Select(ToD1Param).ToArray(),
        };

        using var response = await http.PostAsJsonAsync(_endpoint, payload, ct);
        var body = await response.Content.ReadAsStringAsync(ct);
        if (!response.IsSuccessStatusCode)
        {
            throw new InvalidOperationException($"D1 HTTP {(int)response.StatusCode}: {body}");
        }

        using var doc = JsonDocument.Parse(body);
        var root = doc.RootElement;
        if (root.TryGetProperty("success", out var ok) && !ok.GetBoolean())
        {
            var errors = root.TryGetProperty("errors", out var e) ? e.GetRawText() : "[]";
            throw new InvalidOperationException($"D1 error: {errors}");
        }

        var list = new List<D1Result>();
        foreach (var entry in root.GetProperty("result").EnumerateArray())
        {
            var rows = new List<JsonElement>();
            if (entry.TryGetProperty("results", out var rowsEl) && rowsEl.ValueKind == JsonValueKind.Array)
            {
                foreach (var row in rowsEl.EnumerateArray())
                {
                    rows.Add(row.Clone());
                }
            }

            long changes = 0, lastRowId = 0;
            if (entry.TryGetProperty("meta", out var meta) && meta.ValueKind == JsonValueKind.Object)
            {
                if (meta.TryGetProperty("changes", out var ch) && ch.ValueKind == JsonValueKind.Number)
                {
                    changes = ch.GetInt64();
                }

                if (meta.TryGetProperty("last_row_id", out var lr) && lr.ValueKind == JsonValueKind.Number)
                {
                    lastRowId = lr.GetInt64();
                }
            }

            var success = !entry.TryGetProperty("success", out var s) || s.GetBoolean();
            list.Add(new D1Result(rows, success, new D1Meta(changes, lastRowId)));
        }

        return list;
    }

    // D1 acepta parámetros JSON: null, número, string o booleano. Se normaliza
    // igual que el adaptador local (Guid/DateTime → string, bool → 0/1).
    private static object? ToD1Param(object? value) => value switch
    {
        null => null,
        bool b => b ? 1 : 0,
        Guid g => g.ToString(),
        DateTime dt => dt.ToUniversalTime().ToString("O"),
        DateTimeOffset dto => dto.ToUniversalTime().ToString("O"),
        JsonElement json => json.ValueKind switch
        {
            JsonValueKind.Null => null,
            JsonValueKind.True => 1,
            JsonValueKind.False => 0,
            JsonValueKind.Number => json.TryGetInt64(out var l) ? l : json.GetDouble(),
            JsonValueKind.String => json.GetString(),
            _ => json.GetRawText(),
        },
        _ => value,
    };

    private static string Require(IConfiguration config, string key) =>
        config[key] ?? throw new InvalidOperationException(
            $"Falta configurar '{key}' para Storage:Provider=cloudflare.");
}
