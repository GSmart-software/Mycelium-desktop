using PuppeteerSharp;
using PuppeteerSharp.Media;

namespace Micelio.Api.Features.Vaults;

/// <summary>
/// Render de PDF con PuppeteerSharp (HU-10). Descarga Chromium una sola vez y
/// reutiliza la instancia del navegador entre peticiones. En modo local corre
/// contra el Chromium descargado; el contrato no cambia al migrar a Cloudflare.
/// </summary>
public sealed class PdfService : IAsyncDisposable
{
    private readonly SemaphoreSlim _gate = new(1, 1);
    private IBrowser? _browser;

    public async Task<byte[]> RenderAsync(string fullHtml, string pageSize, CancellationToken ct)
    {
        var browser = await GetBrowserAsync(ct);
        await using var page = await browser.NewPageAsync();
        await page.SetContentAsync(fullHtml, new SetContentOptions
        {
            WaitUntil = [WaitUntilNavigation.Load],
            Timeout = 30_000,
        });
        // Esperar a que las hojas de estilo del CDN (KaTeX/highlight) y las
        // fuentes terminen de cargar antes de imprimir (CA2/CA4).
        await page.EvaluateFunctionAsync(
            @"async () => {
                await Promise.all(Array.from(document.querySelectorAll('link[rel=stylesheet]')).map(
                    l => l.sheet ? Promise.resolve() : new Promise(res => {
                        l.addEventListener('load', res);
                        l.addEventListener('error', res);
                        setTimeout(res, 5000);
                    })));
                if (document.fonts && document.fonts.ready) await document.fonts.ready;
            }");
        return await page.PdfDataAsync(new PdfOptions
        {
            Format = pageSize.Equals("Letter", StringComparison.OrdinalIgnoreCase)
                ? PaperFormat.Letter
                : PaperFormat.A4,
            PrintBackground = true,
            MarginOptions = new MarginOptions
            {
                Top = "18mm",
                Bottom = "18mm",
                Left = "14mm",
                Right = "14mm",
            },
        });
    }

    private async Task<IBrowser> GetBrowserAsync(CancellationToken ct)
    {
        if (_browser is { } ready) return ready;
        await _gate.WaitAsync(ct);
        try
        {
            if (_browser is null)
            {
                await new BrowserFetcher().DownloadAsync();
                _browser = await Puppeteer.LaunchAsync(new LaunchOptions
                {
                    Headless = true,
                    Args = ["--no-sandbox", "--disable-setuid-sandbox"],
                });
            }
        }
        finally
        {
            _gate.Release();
        }
        return _browser;
    }

    public async ValueTask DisposeAsync()
    {
        if (_browser is not null) await _browser.DisposeAsync();
        _gate.Dispose();
    }
}
