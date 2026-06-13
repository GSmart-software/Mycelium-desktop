namespace Micelio.Api.Ports;

/// <summary>
/// Puerto del relay de colaboración en tiempo real (HU-05/06/37). Entrega al
/// cliente la sesión Yjs de una nota compartida. El adaptador local lo deja
/// deshabilitado (la edición es por turnos vía HU-04); el adaptador Cloudflare
/// devuelve el WebSocket del Durable Object que relaya los updates Yjs.
/// </summary>
public interface ICollabRelay
{
    Task<CollabSession> GetSessionAsync(string room, string userId, CancellationToken ct = default);
}

/// <param name="Enabled">true si hay relay disponible para conectar.</param>
/// <param name="Room">Sala (id de la nota) sobre la que se sincroniza el CRDT.</param>
/// <param name="WebsocketUrl">URL base del WebSocket del relay, o null si deshabilitado.</param>
public sealed record CollabSession(bool Enabled, string Room, string? WebsocketUrl);
