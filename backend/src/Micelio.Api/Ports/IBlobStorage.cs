namespace Micelio.Api.Ports;

/// <summary>
/// Puerto de almacenamiento de blobs (contenido .md, adjuntos, CSS de usuario).
/// Implementaciones: LocalDiskBlobStorage (disco) y R2BlobStorage (Cloudflare) — HU-04.
/// </summary>
public interface IBlobStorage
{
    /// <summary>Devuelve el contenido del blob o <c>null</c> si la clave no existe.</summary>
    Task<Stream?> GetAsync(string key, CancellationToken ct = default);

    Task PutAsync(string key, Stream content, string contentType, CancellationToken ct = default);

    Task DeleteAsync(string key, CancellationToken ct = default);

    Task<bool> ExistsAsync(string key, CancellationToken ct = default);
}
