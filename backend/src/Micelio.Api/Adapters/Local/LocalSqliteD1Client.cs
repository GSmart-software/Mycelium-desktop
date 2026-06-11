using System.Text;
using System.Text.Json;
using Micelio.Api.Ports;
using Microsoft.Data.Sqlite;

namespace Micelio.Api.Adapters.Local;

/// <summary>
/// Implementación local de <see cref="ID1Client"/> sobre SQLite (HU-39).
/// Replica el contrato de Cloudflare D1: mismo envelope JSON, parámetros
/// posicionales <c>?</c> enlazados en orden, y BatchAsync como única
/// transacción con rollback ante fallo.
/// </summary>
public sealed class LocalSqliteD1Client : ID1Client
{
    private readonly string _connectionString;

    public LocalSqliteD1Client(IConfiguration config, IHostEnvironment env)
    {
        var dbPath = config["Storage:Local:DatabasePath"] ?? "micelio.local.db";
        if (!Path.IsPathRooted(dbPath))
        {
            dbPath = Path.Combine(env.ContentRootPath, dbPath);
        }

        _connectionString = new SqliteConnectionStringBuilder
        {
            DataSource = dbPath,
            ForeignKeys = true,
        }.ToString();
    }

    public async Task<D1Result> QueryAsync(string sql, IReadOnlyList<object?>? parameters = null, CancellationToken ct = default)
    {
        await using var connection = new SqliteConnection(_connectionString);
        await connection.OpenAsync(ct);
        return await ExecuteAsync(connection, transaction: null, new D1Statement(sql, parameters), ct);
    }

    public async Task<IReadOnlyList<D1Result>> BatchAsync(IReadOnlyList<D1Statement> statements, CancellationToken ct = default)
    {
        await using var connection = new SqliteConnection(_connectionString);
        await connection.OpenAsync(ct);
        await using var transaction = (SqliteTransaction)await connection.BeginTransactionAsync(ct);

        try
        {
            var results = new List<D1Result>(statements.Count);
            foreach (var statement in statements)
            {
                results.Add(await ExecuteAsync(connection, transaction, statement, ct));
            }

            await transaction.CommitAsync(ct);
            return results;
        }
        catch
        {
            await transaction.RollbackAsync(ct);
            throw;
        }
    }

    private static async Task<D1Result> ExecuteAsync(
        SqliteConnection connection,
        SqliteTransaction? transaction,
        D1Statement statement,
        CancellationToken ct)
    {
        // Microsoft.Data.Sqlite no soporta parámetros sin nombre: se reescriben
        // los `?` posicionales (fuera de literales y comentarios) a @p0, @p1...
        var (sql, parameterCount) = RewritePositionalParameters(statement.Sql);
        var parameters = statement.Parameters ?? [];
        if (parameterCount != parameters.Count)
        {
            throw new ArgumentException(
                $"La sentencia espera {parameterCount} parámetros posicionales pero recibió {parameters.Count}.");
        }

        await using var command = connection.CreateCommand();
        command.CommandText = sql;
        command.Transaction = transaction;
        for (var i = 0; i < parameters.Count; i++)
        {
            command.Parameters.AddWithValue($"@p{i}", ToSqliteValue(parameters[i]));
        }

        var rows = new List<Dictionary<string, object?>>();
        await using (var reader = await command.ExecuteReaderAsync(ct))
        {
            while (await reader.ReadAsync(ct))
            {
                var row = new Dictionary<string, object?>(reader.FieldCount);
                for (var i = 0; i < reader.FieldCount; i++)
                {
                    row[reader.GetName(i)] = FromSqliteValue(reader.GetValue(i));
                }

                rows.Add(row);
            }
        }

        // Meta del envelope D1: cambios de la última sentencia + last_row_id.
        await using var metaCommand = connection.CreateCommand();
        metaCommand.CommandText = "SELECT changes(), last_insert_rowid();";
        metaCommand.Transaction = transaction;
        long changes = 0, lastRowId = 0;
        await using (var metaReader = await metaCommand.ExecuteReaderAsync(ct))
        {
            if (await metaReader.ReadAsync(ct))
            {
                changes = metaReader.GetInt64(0);
                lastRowId = metaReader.GetInt64(1);
            }
        }

        var results = rows
            .Select(row => JsonSerializer.SerializeToElement(row))
            .ToList();

        return new D1Result(results, Success: true, new D1Meta(changes, lastRowId));
    }

    private static object ToSqliteValue(object? value) => value switch
    {
        null => DBNull.Value,
        bool b => b ? 1L : 0L,
        Guid g => g.ToString(),
        DateTime dt => dt.ToUniversalTime().ToString("O"),
        DateTimeOffset dto => dto.ToUniversalTime().ToString("O"),
        JsonElement json => json.ValueKind switch
        {
            JsonValueKind.Null => DBNull.Value,
            JsonValueKind.True => 1L,
            JsonValueKind.False => 0L,
            JsonValueKind.Number => json.TryGetInt64(out var l) ? l : json.GetDouble(),
            JsonValueKind.String => json.GetString()!,
            _ => json.GetRawText(),
        },
        _ => value,
    };

    private static object? FromSqliteValue(object value) => value switch
    {
        DBNull => null,
        byte[] bytes => Convert.ToBase64String(bytes),
        _ => value,
    };

    internal static (string Sql, int ParameterCount) RewritePositionalParameters(string sql)
    {
        var output = new StringBuilder(sql.Length + 16);
        var count = 0;
        var i = 0;

        while (i < sql.Length)
        {
            var c = sql[i];

            switch (c)
            {
                case '\'' or '"' or '`':
                    // Literal o identificador citado: copiar hasta el cierre.
                    // Los escapes por duplicación ('' "" ``) quedan cubiertos
                    // porque el cierre re-abre inmediatamente otro tramo citado.
                    output.Append(c);
                    i++;
                    while (i < sql.Length)
                    {
                        output.Append(sql[i]);
                        if (sql[i] == c)
                        {
                            i++;
                            break;
                        }

                        i++;
                    }

                    break;

                case '-' when i + 1 < sql.Length && sql[i + 1] == '-':
                    // Comentario de línea
                    while (i < sql.Length && sql[i] != '\n')
                    {
                        output.Append(sql[i]);
                        i++;
                    }

                    break;

                case '/' when i + 1 < sql.Length && sql[i + 1] == '*':
                    // Comentario de bloque
                    output.Append("/*");
                    i += 2;
                    while (i < sql.Length)
                    {
                        if (sql[i] == '*' && i + 1 < sql.Length && sql[i + 1] == '/')
                        {
                            output.Append("*/");
                            i += 2;
                            break;
                        }

                        output.Append(sql[i]);
                        i++;
                    }

                    break;

                case '?':
                    output.Append("@p").Append(count);
                    count++;
                    i++;
                    break;

                default:
                    output.Append(c);
                    i++;
                    break;
            }
        }

        return (output.ToString(), count);
    }
}
