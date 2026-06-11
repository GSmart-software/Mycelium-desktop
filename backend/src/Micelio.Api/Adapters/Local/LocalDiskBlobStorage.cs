using Micelio.Api.Ports;

namespace Micelio.Api.Adapters.Local;

/// <summary>
/// Adaptador local de <see cref="IBlobStorage"/> (HU-04 CA10): guarda los
/// blobs como archivos bajo <c>Storage:Local:BlobsRoot</c>, espejando la
/// clave R2 como ruta relativa (p. ej. ./.local-storage/blobs/vaults/...).
/// </summary>
public sealed class LocalDiskBlobStorage : IBlobStorage
{
    private readonly string _root;

    public LocalDiskBlobStorage(IConfiguration config, IHostEnvironment env)
    {
        var root = config["Storage:Local:BlobsRoot"] ?? "./.local-storage/blobs";
        if (!Path.IsPathRooted(root))
        {
            root = Path.Combine(env.ContentRootPath, root);
        }

        _root = Path.GetFullPath(root);
        Directory.CreateDirectory(_root);
    }

    public Task<Stream?> GetAsync(string key, CancellationToken ct = default)
    {
        var path = Resolve(key);
        return Task.FromResult<Stream?>(
            File.Exists(path) ? File.OpenRead(path) : null);
    }

    public async Task PutAsync(string key, Stream content, string contentType, CancellationToken ct = default)
    {
        var path = Resolve(key);
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        await using var file = File.Create(path);
        await content.CopyToAsync(file, ct);
    }

    public Task DeleteAsync(string key, CancellationToken ct = default)
    {
        var path = Resolve(key);
        if (File.Exists(path))
        {
            File.Delete(path);
        }

        return Task.CompletedTask;
    }

    public Task<bool> ExistsAsync(string key, CancellationToken ct = default) =>
        Task.FromResult(File.Exists(Resolve(key)));

    /// <summary>Mapea la clave a una ruta dentro del root, bloqueando escapes (..).</summary>
    private string Resolve(string key)
    {
        var path = Path.GetFullPath(Path.Combine(_root, key.Replace('/', Path.DirectorySeparatorChar)));
        if (!path.StartsWith(_root, StringComparison.OrdinalIgnoreCase))
        {
            throw new ArgumentException($"Clave de blob inválida: '{key}'.");
        }

        return path;
    }
}
