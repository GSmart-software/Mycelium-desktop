using Micelio.Api.Ports;

namespace Micelio.Api.Adapters.Cloudflare;

/// <summary>
/// Adaptador Cloudflare R2 (S3 compatible, con <c>DisablePayloadSigning = true</c>).
/// Stub: la integración con Cloudflare se implementa al activar el proveedor
/// <c>Storage:Provider=cloudflare</c>.
/// </summary>
public sealed class R2BlobStorage : IBlobStorage
{
    public Task<Stream?> GetAsync(string key, CancellationToken ct = default)
        => throw new NotImplementedException("Integración Cloudflare R2 pendiente. Usar Storage:Provider=local.");

    public Task PutAsync(string key, Stream content, string contentType, CancellationToken ct = default)
        => throw new NotImplementedException("Integración Cloudflare R2 pendiente. Usar Storage:Provider=local.");

    public Task DeleteAsync(string key, CancellationToken ct = default)
        => throw new NotImplementedException("Integración Cloudflare R2 pendiente. Usar Storage:Provider=local.");

    public Task<bool> ExistsAsync(string key, CancellationToken ct = default)
        => throw new NotImplementedException("Integración Cloudflare R2 pendiente. Usar Storage:Provider=local.");
}
