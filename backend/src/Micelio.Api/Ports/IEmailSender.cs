namespace Micelio.Api.Ports;

/// <summary>
/// Puerto de envío de emails transaccionales (verificación, reset de contraseña).
/// En producción: Resend. En modo local: los links se escriben en el log.
/// </summary>
public interface IEmailSender
{
    Task SendAsync(string to, string subject, string body, CancellationToken ct = default);
}
