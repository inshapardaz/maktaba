using Amazon;
using Amazon.S3;

namespace Maktaba.Cloud;

/// <summary>
/// S3StorageProvider's config, assembled from a library registry entry's ProviderConfig dict
/// (Bucket/Region/Prefix/ServiceUrl - non-secret) plus a credential supplied transiently by the
/// frontend (AccessKeyId/SecretAccessKey - never persisted by this backend, see
/// ICloudCredentialCache).
/// </summary>
public record S3ProviderOptions(
    string Bucket,
    string Region,
    string Prefix,
    string AccessKeyId,
    string SecretAccessKey,
    // Null/empty = talk to AWS's own region endpoint (RegionEndpoint.GetBySystemName). Set for any
    // other S3-compatible provider (MinIO, Backblaze B2, DigitalOcean Spaces, Cloudflare R2, a
    // self-hosted Nawishta-adjacent object store, ...) - see S3StorageProvider's constructor.
    string? ServiceUrl = null)
{
    public const string BucketKey = "bucket";
    public const string RegionKey = "region";
    public const string PrefixKey = "prefix";
    public const string ServiceUrlKey = "serviceUrl";

    public static S3ProviderOptions FromConfig(IReadOnlyDictionary<string, string> config, string credentialJson)
    {
        var credential = System.Text.Json.JsonSerializer.Deserialize<S3Credential>(credentialJson)
            ?? throw new InvalidOperationException("Malformed S3 credential.");

        return new S3ProviderOptions(
            config.GetValueOrDefault(BucketKey) ?? throw new InvalidOperationException("Missing S3 bucket."),
            config.GetValueOrDefault(RegionKey) ?? throw new InvalidOperationException("Missing S3 region."),
            config.GetValueOrDefault(PrefixKey) ?? "",
            credential.AccessKeyId,
            credential.SecretAccessKey,
            config.GetValueOrDefault(ServiceUrlKey) is { Length: > 0 } url ? url : null);
    }

    // AWS itself is addressed by RegionEndpoint (the SDK resolves the right regional hostname).
    // Any other S3-compatible provider is addressed by a literal ServiceUrl instead, which almost
    // always requires path-style bucket addressing (https://host/bucket/key) rather than AWS's own
    // default virtual-hosted style (https://bucket.host/key) - most non-AWS S3-compatible servers
    // don't do the DNS/TLS-cert setup virtual-hosted style needs. AuthenticationRegion still has to
    // be set for SigV4 request signing even against a non-AWS endpoint; most such providers accept
    // any non-empty region string (MinIO in particular ignores it entirely).
    public AmazonS3Config BuildClientConfig() =>
        string.IsNullOrWhiteSpace(ServiceUrl)
            ? new AmazonS3Config { RegionEndpoint = RegionEndpoint.GetBySystemName(Region) }
            : new AmazonS3Config { ServiceURL = ServiceUrl, ForcePathStyle = true, AuthenticationRegion = Region };
}

/// <summary>The JSON shape stored (encrypted) via window.maktaba.saveCloudCredential and passed
/// transiently to the backend - see the frontend's S3 connect form.</summary>
public record S3Credential(string AccessKeyId, string SecretAccessKey);
