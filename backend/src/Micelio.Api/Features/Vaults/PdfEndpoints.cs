using System.Security.Claims;
using System.Text;

namespace Micelio.Api.Features.Vaults;

/// <summary>
/// Exportación de una nota a PDF con el tema visual aplicado (HU-10). El cliente
/// envía el HTML ya renderizado (con SVGs de Mermaid/Excalidraw) y el CSS de
/// impresión; el servidor envuelve con el tema y delega en PuppeteerSharp.
/// </summary>
public static class PdfEndpoints
{
    // KaTeX y highlight.js desde CDN: los carga Chromium al renderizar (CA2/CA4).
    private const string KatexCss =
        "https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.css";
    private const string HljsCss =
        "https://cdn.jsdelivr.net/npm/highlight.js@11.9.0/styles/atom-one-dark.min.css";

    public static void MapPdfEndpoints(this WebApplication app)
    {
        var group = app.MapGroup("").RequireAuthorization();

        group.MapPost("/notas/{id}/exportar-pdf", async (
            string id,
            PdfRequest request,
            ClaimsPrincipal user,
            VaultRepository repo,
            PdfService pdf,
            CancellationToken ct) =>
        {
            var userId = user.FindFirstValue(ClaimTypes.NameIdentifier) ?? user.FindFirstValue("sub");
            var vaultId = await repo.GetVaultIdOfNotaAsync(id, ct);
            if (vaultId is null) return Results.NotFound();
            if (userId is null || await repo.GetVaultRoleAsync(userId, vaultId, ct) is null)
            {
                return Results.Json(new { error = "Sin acceso." }, statusCode: 403);
            }

            var tema = request.Tema == "cantarela" ? "cantarela" : "bioluminiscencia";
            var html = BuildDocument(tema, request.ModoOscuro, request.Html ?? "", request.Css ?? "");

            try
            {
                var bytes = await pdf.RenderAsync(html, request.PageSize ?? "A4", ct);
                return Results.File(bytes, "application/pdf");
            }
            catch (Exception ex)
            {
                return Results.Json(new { error = $"No se pudo generar el PDF: {ex.Message}" }, statusCode: 500);
            }
        });
    }

    private static string BuildDocument(string tema, bool modoOscuro, string bodyHtml, string css)
    {
        var dark = modoOscuro ? " data-dark=\"true\"" : "";
        var sb = new StringBuilder();
        sb.Append("<!doctype html><html lang=\"es\" data-theme=\"").Append(tema).Append('"').Append(dark).Append('>');
        sb.Append("<head><meta charset=\"utf-8\">");
        sb.Append("<link rel=\"stylesheet\" href=\"").Append(KatexCss).Append("\">");
        sb.Append("<link rel=\"stylesheet\" href=\"").Append(HljsCss).Append("\">");
        sb.Append("<style>").Append(css).Append("</style>");
        sb.Append("</head><body><div class=\"mic-preview mic-pdf\">");
        sb.Append(bodyHtml);
        sb.Append("</div></body></html>");
        return sb.ToString();
    }

    public sealed record PdfRequest(string? PageSize, string? Tema, bool ModoOscuro, string? Html, string? Css);
}
