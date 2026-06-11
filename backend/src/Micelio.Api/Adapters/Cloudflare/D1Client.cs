using Micelio.Api.Ports;

namespace Micelio.Api.Adapters.Cloudflare;

/// <summary>
/// Adaptador Cloudflare D1 (HTTP API). Stub: la integración con Cloudflare
/// se implementa al activar el proveedor <c>Storage:Provider=cloudflare</c>.
/// </summary>
public sealed class D1Client : ID1Client
{
    public Task<D1Result> QueryAsync(string sql, IReadOnlyList<object?>? parameters = null, CancellationToken ct = default)
        => throw new NotImplementedException("Integración Cloudflare D1 pendiente. Usar Storage:Provider=local.");

    public Task<IReadOnlyList<D1Result>> BatchAsync(IReadOnlyList<D1Statement> statements, CancellationToken ct = default)
        => throw new NotImplementedException("Integración Cloudflare D1 pendiente. Usar Storage:Provider=local.");
}
