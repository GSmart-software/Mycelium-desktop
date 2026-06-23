using System.Collections.Concurrent;
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

    // #tag al inicio o tras un espacio/paréntesis (igual que el cliente).
    [GeneratedRegex(@"(?:^|[\s(])#([\p{L}\p{N}_/-]+)")]
    private static partial Regex TagRegex();

    /// <summary>Lecturas de blob simultáneas al escanear el grafo (R2/local).</summary>
    private const int BlobReadConcurrency = 32;

    public static void MapSearchEndpoints(this WebApplication app)
    {
        var group = app.MapGroup("").RequireAuthorization();

        // ── Búsqueda FTS5 (HU-21) ─────────────────────────────────
        group.MapGet("/vaults/{vaultId}/buscar", async (
            string vaultId,
            string? q,
            bool? exacto,
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

            // Por defecto (exacto=false) la búsqueda es por coincidencia (prefijo).
            var match = BuildFtsQuery(q ?? "", prefix: !(exacto ?? false));
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
            var (aristasVault, titulosPorId, contenidos) =
                await BuildVaultGraphAsync(notas, vaultId, blobs, ct);

            // Etiquetas (#tag) por nota, para colorear nodos por etiqueta (HU-30).
            var tagsPorId = contenidos.ToDictionary(
                kv => kv.Key,
                kv => TagRegex().Matches(kv.Value)
                    .Select(m => m.Groups[1].Value)
                    .Distinct(StringComparer.OrdinalIgnoreCase)
                    .ToArray());
            // Fecha de creación por nota, para la construcción temporal del grafo.
            var creadoPorId = notas.ToDictionary(n => n.GetString("id"), n => n.GetString("creado_en"));

            var conexionesTotales = ContarConexiones(aristasVault);
            var nodos = titulosPorId.Select(kv => new
            {
                id = kv.Key,
                titulo = kv.Value,
                conexiones = conexionesTotales.GetValueOrDefault(kv.Key),
                tags = tagsPorId.GetValueOrDefault(kv.Key, Array.Empty<string>()),
                creadoEn = creadoPorId.GetValueOrDefault(kv.Key),
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
        // Títulos duplicados son posibles (p. ej. varias "Sin título"): se
        // resuelve el wikilink a la primera nota con ese título.
        var porTitulo = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        var titulosPorId = new Dictionary<string, string>();
        foreach (var n in notas)
        {
            var nid = n.GetString("id");
            var titulo = n.GetString("titulo");
            porTitulo.TryAdd(titulo, nid);
            titulosPorId[nid] = titulo;
        }

        // Lectura de blobs EN PARALELO con concurrencia acotada: el escaneo del
        // grafo es dominado por N lecturas de blob (en R2, N round-trips de red).
        // Secuencial era O(N) round-trips; esto las solapa (~DegreeOfParallelism
        // simultáneas), clave cuando el vault tiene muchos archivos.
        var contenidos = new ConcurrentDictionary<string, string>();
        using var gate = new SemaphoreSlim(BlobReadConcurrency);
        await Task.WhenAll(notas.Select(async n =>
        {
            var nid = n.GetString("id");
            await gate.WaitAsync(ct);
            try
            {
                await using var stream = await blobs.GetAsync($"vaults/{vaultId}/notas/{nid}.md", ct);
                if (stream is null) return;
                using var reader = new StreamReader(stream, Encoding.UTF8);
                contenidos[nid] = await reader.ReadToEndAsync(ct);
            }
            finally
            {
                gate.Release();
            }
        }));

        var aristas = new HashSet<(string From, string To)>();
        foreach (var (notaId, contenido) in contenidos)
        {
            foreach (Match m in WikilinkRegex().Matches(contenido))
            {
                // [[destino|alias]] y [[Carpeta/destino]]: el enlace apunta al
                // título (parte antes del `|`, último segmento de la ruta).
                var inner = m.Groups[1].Value;
                var pipe = inner.IndexOf('|');
                if (pipe >= 0) inner = inner[..pipe];
                var slash = inner.LastIndexOf('/');
                var destino = (slash >= 0 ? inner[(slash + 1)..] : inner).Trim();
                if (porTitulo.TryGetValue(destino, out var destinoId) && destinoId != notaId)
                {
                    aristas.Add((notaId, destinoId));
                }
            }
        }

        return (aristas, titulosPorId, new Dictionary<string, string>(contenidos));
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
    internal static string BuildFtsQuery(string raw, bool prefix = false)
    {
        // `prefix` (búsqueda por coincidencia, por defecto): cada término se trata
        // como prefijo (`"perr"*` encuentra "perro"). Si es false (búsqueda
        // exacta), solo coincide la palabra completa.
        var parts = new List<string>();
        var tokens = Regex.Matches(raw, "\"[^\"]+\"|\\S+");
        var star = prefix ? "*" : "";

        foreach (Match token in tokens)
        {
            var text = token.Value;

            if (text.StartsWith('"') && text.EndsWith('"') && text.Length > 2)
            {
                // Frase exacta: escapar comillas internas (en modo coincidencia, el
                // `*` aplica el prefijo al último término de la frase).
                parts.Add($"\"{text[1..^1].Replace("\"", "\"\"")}\"{star}");
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
                parts.Add($"\"{sanitized}\"{star}");
            }
        }

        return string.Join(" ", parts);
    }
}
