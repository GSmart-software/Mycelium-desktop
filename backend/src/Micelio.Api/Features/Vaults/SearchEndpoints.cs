using System.Security.Claims;
using System.Text;
using System.Text.RegularExpressions;
using Micelio.Api.Features.Common;
using Micelio.Api.Ports;

namespace Micelio.Api.Features.Vaults;

/// <summary>
/// Búsqueda full-text en el vault vía FTS5 (HU-21) y conexiones de una nota
/// (HU-30): enlaces salientes, retroenlaces y mini-grafo de 1 salto.
/// </summary>
public static partial class SearchEndpoints
{
    [GeneratedRegex(@"\[\[([^\[\]]+)\]\]")]
    private static partial Regex WikilinkRegex();

    public static void MapSearchEndpoints(this WebApplication app)
    {
        var group = app.MapGroup("").RequireAuthorization();

        // ── Búsqueda FTS5 (HU-21) ─────────────────────────────────
        group.MapGet("/vaults/{vaultId}/buscar", async (
            string vaultId,
            string? q,
            ClaimsPrincipal user,
            VaultRepository repo,
            ID1Client d1,
            CancellationToken ct) =>
        {
            var userId = GetUserId(user);
            if (userId is null || await repo.GetVaultRoleAsync(userId, vaultId, ct) is null)
            {
                return Results.Json(new { error = "Sin acceso a este vault." }, statusCode: 403);
            }

            var match = BuildFtsQuery(q ?? "");
            if (match.Length == 0)
            {
                return Results.Ok(new { resultados = Array.Empty<object>() });
            }

            // Marcadores no-HTML: el cliente escapa el texto y los convierte a <mark>
            var result = await d1.QueryAsync(
                """
                SELECT f.nota_id, n.titulo, n.carpeta_id,
                       snippet(notas_fts, 2, '«', '»', '…', 10) AS fragmento
                FROM notas_fts f
                JOIN notas n ON n.id = f.nota_id
                WHERE notas_fts MATCH ?
                  AND n.vault_id = ?
                  AND n.id NOT IN (SELECT nota_id FROM papelera)
                ORDER BY rank
                LIMIT 50
                """,
                [match, vaultId], ct);

            return Results.Ok(new { resultados = result.Results });
        });

        // ── Grafo global del vault (HU-30 / rail) ─────────────────
        group.MapGet("/vaults/{vaultId}/grafo", async (
            string vaultId,
            ClaimsPrincipal user,
            VaultRepository repo,
            IBlobStorage blobs,
            CancellationToken ct) =>
        {
            var userId = GetUserId(user);
            if (userId is null || await repo.GetVaultRoleAsync(userId, vaultId, ct) is null)
            {
                return Results.Json(new { error = "Sin acceso a este vault." }, statusCode: 403);
            }

            var (_, notas) = await repo.GetTreeAsync(vaultId, ct);
            var (aristasVault, titulosPorId, _) = await BuildVaultGraphAsync(notas, vaultId, blobs, ct);

            var conexionesTotales = ContarConexiones(aristasVault);
            var nodos = titulosPorId.Select(kv => new
            {
                id = kv.Key,
                titulo = kv.Value,
                conexiones = conexionesTotales.GetValueOrDefault(kv.Key),
            });
            var aristas = aristasVault.Select(a => new { source = a.From, target = a.To });

            return Results.Ok(new { nodos, aristas });
        });

        // ── Conexiones de la nota (HU-30) ─────────────────────────
        group.MapGet("/notas/{id}/conexiones", async (
            string id,
            ClaimsPrincipal user,
            VaultRepository repo,
            IBlobStorage blobs,
            CancellationToken ct) =>
        {
            var vaultId = await repo.GetVaultIdOfNotaAsync(id, ct);
            var userId = GetUserId(user);
            if (vaultId is null) return Results.NotFound();
            if (userId is null || await repo.GetVaultRoleAsync(userId, vaultId, ct) is null)
            {
                return Results.Json(new { error = "Sin acceso." }, statusCode: 403);
            }

            if (await repo.GetNotaAsync(id, ct) is not { } nota) return Results.NotFound();

            // Escaneo del vault para construir el grafo de enlaces. En modo
            // cloudflare esto se materializará en una tabla de links en D1.
            var (_, notas) = await repo.GetTreeAsync(vaultId, ct);
            var (aristasVault, titulosPorId, contenidos) =
                await BuildVaultGraphAsync(notas, vaultId, blobs, ct);

            // Adyacencia completa del vault (para tamaños de nodo, CA3)
            var conexionesTotales = ContarConexiones(aristasVault);

            var salientes = aristasVault
                .Where(a => a.From == id)
                .Select(a => new { id = a.To, titulo = titulosPorId[a.To] })
                .ToList();

            var retro = aristasVault
                .Where(a => a.To == id)
                .Select(a => new
                {
                    id = a.From,
                    titulo = titulosPorId[a.From],
                    fragmento = FragmentAround(contenidos[a.From], nota.GetString("titulo")),
                })
                .ToList();

            // Mini-grafo 1 salto (CA2): nota activa + conexiones inmediatas
            var vecinos = salientes.Select(s => s.id)
                .Concat(retro.Select(r => r.id))
                .Distinct()
                .ToList();
            var nodos = new[] { id }.Concat(vecinos)
                .Select(n => new
                {
                    id = n,
                    titulo = titulosPorId.GetValueOrDefault(n, "?"),
                    conexiones = conexionesTotales.GetValueOrDefault(n),
                })
                .ToList();
            var aristas = aristasVault
                .Where(a => (a.From == id || a.To == id))
                .Select(a => new { source = a.From, target = a.To })
                .ToList();

            return Results.Ok(new
            {
                nota = new
                {
                    id,
                    titulo = nota.GetString("titulo"),
                    carpetaId = nota.GetStringOrNull("carpeta_id"),
                    creadoEn = nota.GetString("creado_en"),
                    actualizadoEn = nota.GetString("actualizado_en"),
                    tamanoBytes = nota.GetInt64("tamano_bytes"),
                },
                salientes,
                retro,
                grafo = new { nodos, aristas },
            });
        });
    }

    private static string? GetUserId(ClaimsPrincipal user) =>
        user.FindFirstValue(ClaimTypes.NameIdentifier) ?? user.FindFirstValue("sub");

    /// <summary>
    /// Escanea los blobs del vault y arma el grafo de wikilinks: aristas
    /// dirigidas (origen → destino), títulos por id y contenidos por id.
    /// En modo cloudflare esto se materializará en una tabla de links en D1.
    /// </summary>
    private static async Task<(
        HashSet<(string From, string To)> Aristas,
        Dictionary<string, string> Titulos,
        Dictionary<string, string> Contenidos)> BuildVaultGraphAsync(
        IReadOnlyList<System.Text.Json.JsonElement> notas,
        string vaultId,
        IBlobStorage blobs,
        CancellationToken ct)
    {
        var porTitulo = notas.ToDictionary(
            n => n.GetString("titulo"),
            n => n.GetString("id"),
            StringComparer.OrdinalIgnoreCase);
        var titulosPorId = notas.ToDictionary(
            n => n.GetString("id"),
            n => n.GetString("titulo"));

        var contenidos = new Dictionary<string, string>();
        foreach (var n in notas)
        {
            var key = $"vaults/{vaultId}/notas/{n.GetString("id")}.md";
            await using var stream = await blobs.GetAsync(key, ct);
            if (stream is null) continue;
            using var reader = new StreamReader(stream, Encoding.UTF8);
            contenidos[n.GetString("id")] = await reader.ReadToEndAsync(ct);
        }

        var aristas = new HashSet<(string From, string To)>();
        foreach (var (notaId, contenido) in contenidos)
        {
            foreach (Match m in WikilinkRegex().Matches(contenido))
            {
                if (porTitulo.TryGetValue(m.Groups[1].Value.Trim(), out var destinoId)
                    && destinoId != notaId)
                {
                    aristas.Add((notaId, destinoId));
                }
            }
        }

        return (aristas, titulosPorId, contenidos);
    }

    /// <summary>Grado total (entrante + saliente) de cada nodo (HU-30 CA3).</summary>
    private static Dictionary<string, int> ContarConexiones(
        HashSet<(string From, string To)> aristas)
    {
        var conteo = new Dictionary<string, int>();
        foreach (var (from, to) in aristas)
        {
            conteo[from] = conteo.GetValueOrDefault(from) + 1;
            conteo[to] = conteo.GetValueOrDefault(to) + 1;
        }
        return conteo;
    }

    /// <summary>Fragmento de contexto alrededor del [[enlace]] (HU-30 CA7).</summary>
    private static string FragmentAround(string contenido, string titulo)
    {
        var index = contenido.IndexOf($"[[{titulo}", StringComparison.OrdinalIgnoreCase);
        if (index < 0) return "";
        var start = Math.Max(0, index - 40);
        var end = Math.Min(contenido.Length, index + titulo.Length + 44);
        var fragment = contenido[start..end].Replace('\n', ' ').Trim();
        return (start > 0 ? "…" : "") + fragment + (end < contenido.Length ? "…" : "");
    }

    /// <summary>
    /// Query del usuario → expresión FTS5 segura (HU-21 CA5/CA6/CA7):
    /// AND implícito, frases entre comillas, `tag:x` y `#x` buscan el tag.
    /// </summary>
    internal static string BuildFtsQuery(string raw)
    {
        var parts = new List<string>();
        var tokens = Regex.Matches(raw, "\"[^\"]+\"|\\S+");

        foreach (Match token in tokens)
        {
            var text = token.Value;

            if (text.StartsWith('"') && text.EndsWith('"') && text.Length > 2)
            {
                // Frase exacta: escapar comillas internas
                parts.Add($"\"{text[1..^1].Replace("\"", "\"\"")}\"");
                continue;
            }

            if (text.StartsWith("tag:", StringComparison.OrdinalIgnoreCase) && text.Length > 4)
            {
                text = "#" + text[4..];
            }

            // Los términos van entre comillas para neutralizar operadores FTS
            var sanitized = text.Replace("\"", "\"\"");
            if (sanitized.Length > 0)
            {
                parts.Add($"\"{sanitized}\"");
            }
        }

        return string.Join(" ", parts);
    }
}
