using System.Text.Json;

namespace Micelio.Api.Features.Common;

/// <summary>Helpers para leer filas del envelope D1 (objetos JSON).</summary>
public static class D1Rows
{
    public static string GetString(this JsonElement row, string column) =>
        row.GetProperty(column).GetString()
        ?? throw new InvalidOperationException($"Columna '{column}' es null.");

    public static string? GetStringOrNull(this JsonElement row, string column) =>
        row.TryGetProperty(column, out var value) && value.ValueKind != JsonValueKind.Null
            ? value.GetString()
            : null;

    public static long GetInt64(this JsonElement row, string column) =>
        row.GetProperty(column).GetInt64();

    public static bool GetBool(this JsonElement row, string column) =>
        row.GetProperty(column).ValueKind switch
        {
            JsonValueKind.True => true,
            JsonValueKind.False => false,
            JsonValueKind.Number => row.GetProperty(column).GetInt64() != 0,
            _ => false,
        };
}
