using Micelio.Api.Ports;

namespace Micelio.Api.Adapters.Cloudflare;

/// <summary>
/// Relay de colaboración sobre Durable Objects (HU-05 CA3/CA6). Cada nota mapea
/// a un Durable Object que relaya y persiste los updates Yjs entre sesiones. El
/// cliente conecta por WebSocket a <c>{RelayBaseUrl}/{room}</c>. Se activa al
/// configurar <c>Collab:RelayBaseUrl</c> con el endpoint del Worker/DO.
/// </summary>
public sealed class DurableObjectCollabRelay(IConfiguration config) : ICollabRelay
{
    public Task<CollabSession> GetSessionAsync(string room, string userId, CancellationToken ct = default)
    {
        var baseUrl = config["Collab:RelayBaseUrl"];
        if (string.IsNullOrWhiteSpace(baseUrl))
        {
            // Cloudflare seleccionado pero el relay aún no está configurado.
            return Task.FromResult(new CollabSession(Enabled: false, room, WebsocketUrl: null));
        }
        return Task.FromResult(new CollabSession(Enabled: true, room, baseUrl.TrimEnd('/')));
    }
}
