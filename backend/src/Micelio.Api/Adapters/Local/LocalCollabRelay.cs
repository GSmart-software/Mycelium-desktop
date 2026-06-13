using Micelio.Api.Ports;

namespace Micelio.Api.Adapters.Local;

/// <summary>
/// Relay local de colaboración (HU-05/06/37): deshabilitado por diseño. En modo
/// local no hay servidor de relay Yjs, así que la edición simultánea en tiempo
/// real no opera; las notas compartidas se sincronizan por turnos (HU-04). El
/// contrato queda listo para enchufar el Durable Object al integrar Cloudflare.
/// </summary>
public sealed class LocalCollabRelay : ICollabRelay
{
    public Task<CollabSession> GetSessionAsync(string room, string userId, CancellationToken ct = default)
        => Task.FromResult(new CollabSession(Enabled: false, room, WebsocketUrl: null));
}
