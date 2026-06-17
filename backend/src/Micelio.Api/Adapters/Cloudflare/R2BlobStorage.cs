using System.Net;
using Amazon.S3;
using Amazon.S3.Model;
using Micelio.Api.Ports;

namespace Micelio.Api.Adapters.Cloudflare;

/// <summary>
/// Adaptador Cloudflare R2 vía API S3 (HU-04). R2 exige
/// <c>DisablePayloadSigning = true</c> y path-style. Mismo contrato que
/// <c>LocalDiskBlobStorage</c>: <see cref="GetAsync"/> devuelve <c>null</c> si la
/// clave no existe. Se activa con <c>Storage:Provider=cloudflare</c>.
/// </summary>
public sealed class R2BlobStorage : IBlobStorage
{
    private readonly IAmazonS3 _s3;
    private readonly string _bucket;

    public R2BlobStorage(IConfiguration config)
    {
        var accountId = Require(config, "Cloudflare:AccountId");
        var accessKeyId = Require(config, "Cloudflare:R2:AccessKeyId");
        var secretAccessKey = Require(config, "Cloudflare:R2:SecretAccessKey");
        _bucket = Require(config, "Cloudflare:R2:Bucket");

        _s3 = new AmazonS3Client(accessKeyId, secretAccessKey, new AmazonS3Config
        {
            ServiceURL = $"https://{accountId}.r2.cloudflarestorage.com",
            ForcePathStyle = true,
            AuthenticationRegion = "auto",
        });
    }

    public async Task<Stream?> GetAsync(string key, CancellationToken ct = default)
    {
        try
        {
            using var response = await _s3.GetObjectAsync(_bucket, key, ct);
            // Copiar a memoria para poder cerrar la respuesta HTTP y devolver un
            // stream seekable, igual que el FileStream del adaptador local.
            var buffer = new MemoryStream();
            await response.ResponseStream.CopyToAsync(buffer, ct);
            buffer.Position = 0;
            return buffer;
        }
        catch (AmazonS3Exception ex) when (ex.StatusCode == HttpStatusCode.NotFound)
        {
            return null;
        }
    }

    public async Task PutAsync(string key, Stream content, string contentType, CancellationToken ct = default)
    {
        await _s3.PutObjectAsync(new PutObjectRequest
        {
            BucketName = _bucket,
            Key = key,
            InputStream = content,
            ContentType = contentType,
            DisablePayloadSigning = true,
        }, ct);
    }

    public async Task DeleteAsync(string key, CancellationToken ct = default)
    {
        await _s3.DeleteObjectAsync(_bucket, key, ct);
    }

    public async Task<bool> ExistsAsync(string key, CancellationToken ct = default)
    {
        try
        {
            await _s3.GetObjectMetadataAsync(_bucket, key, ct);
            return true;
        }
        catch (AmazonS3Exception ex) when (ex.StatusCode == HttpStatusCode.NotFound)
        {
            return false;
        }
    }

    private static string Require(IConfiguration config, string key) =>
        config[key] ?? throw new InvalidOperationException(
            $"Falta configurar '{key}' para Storage:Provider=cloudflare.");
}
