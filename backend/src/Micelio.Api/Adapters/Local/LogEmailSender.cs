using Micelio.Api.Ports;

namespace Micelio.Api.Adapters.Local;

/// <summary>
/// Adaptador local de <see cref="IEmailSender"/>: no envía nada, escribe el
/// email en el log del backend. Los links de verificación/reset se copian
/// desde la consola durante el desarrollo.
/// </summary>
public sealed class LogEmailSender(ILogger<LogEmailSender> logger) : IEmailSender
{
    public Task SendAsync(string to, string subject, string body, CancellationToken ct = default)
    {
        logger.LogInformation("EMAIL (modo local) → {To} | {Subject}\n{Body}", to, subject, body);
        return Task.CompletedTask;
    }
}
