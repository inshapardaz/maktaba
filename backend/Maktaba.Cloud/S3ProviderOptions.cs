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
    // self-hosted Nawishta-adjacent object store, ...) - a bare host, optionally with a port
    // ("s3.example.com" or "play.min.io:9000"), not a full URL; BuildClientConfig turns it into
    // one. A value that already includes a scheme ("http://..."/"https://...") is respected as-is,
    // so a non-TLS local dev server still works.
    string? Endpoint = null)
{
    public const string BucketKey = "bucket";
    public const string RegionKey = "region";
    public const string PrefixKey = "prefix";
    public const string EndpointKey = "endpoint";

    // The frontend sends {accessKeyId, secretAccessKey} (camelCase, natural for TS - see api.ts's
    // S3Credential). System.Text.Json's default Deserialize<T> is case-sensitive and matches
    // against this record's PascalCase constructor parameters, so without this option every field
    // silently comes back empty instead of throwing - the request then gets signed with blank
    // credentials, which a server reports back as a perfectly ordinary "Access Denied" with no hint
    // that the credentials themselves never arrived. Found via an isolated deserialization test
    // after ruling out region/endpoint/checksum-config theories that all tested fine in isolation.
    private static readonly System.Text.Json.JsonSerializerOptions CredentialJsonOptions = new()
    {
        PropertyNameCaseInsensitive = true,
    };

    public static S3ProviderOptions FromConfig(IReadOnlyDictionary<string, string> config, string credentialJson)
    {
        var credential = System.Text.Json.JsonSerializer.Deserialize<S3Credential>(credentialJson, CredentialJsonOptions)
            ?? throw new InvalidOperationException("Malformed S3 credential.");

        if (string.IsNullOrWhiteSpace(credential.AccessKeyId) || string.IsNullOrWhiteSpace(credential.SecretAccessKey))
        {
            throw new InvalidOperationException("S3 credential is missing an access key or secret key.");
        }

        return new S3ProviderOptions(
            config.GetValueOrDefault(BucketKey) ?? throw new InvalidOperationException("Missing S3 bucket."),
            config.GetValueOrDefault(RegionKey) ?? throw new InvalidOperationException("Missing S3 region."),
            config.GetValueOrDefault(PrefixKey) ?? "",
            credential.AccessKeyId,
            credential.SecretAccessKey,
            config.GetValueOrDefault(EndpointKey) is { Length: > 0 } endpoint ? endpoint : null);
    }

    // AWS itself is addressed by RegionEndpoint (the SDK resolves the right regional hostname).
    // Any other S3-compatible provider is addressed by a literal ServiceURL instead, which almost
    // always requires path-style bucket addressing (https://host/bucket/key) rather than AWS's own
    // default virtual-hosted style (https://bucket.host/key) - most non-AWS S3-compatible servers
    // don't do the DNS/TLS-cert setup virtual-hosted style needs. AuthenticationRegion still has to
    // be set for SigV4 request signing even against a non-AWS endpoint; most such providers accept
    // any non-empty region string (MinIO in particular ignores it entirely) - but Cloudflare R2
    // specifically *requires* the literal string "auto" for the signature to verify at all
    // (https://developers.cloudflare.com/r2/api/s3/tokens/), regardless of what the user typed in
    // the Region field - a mismatched region there is a signature failure R2 reports back as a
    // plain, unhelpful "Access Denied", not a clearer "region mismatch" error.
    // A dead/unreachable network (the whole point of adding cloud support is that this becomes a
    // routine scenario, not an edge case) must fail fast rather than hang - the AWS SDK's own
    // defaults are tuned for a normally-reachable AWS endpoint and can block for a long time
    // (multiple retries, each with its own long timeout) before giving up. A cloud library's
    // reconnect on app startup (see App.tsx's cloudReconnectQuery) would otherwise leave the whole
    // app stuck behind a loading screen for that entire duration. Applied to every AmazonS3Config
    // this options object builds, AWS or not.
    private static readonly TimeSpan RequestTimeout = TimeSpan.FromSeconds(10);

    public AmazonS3Config BuildClientConfig()
    {
        if (string.IsNullOrWhiteSpace(Endpoint))
        {
            return new AmazonS3Config
            {
                RegionEndpoint = RegionEndpoint.GetBySystemName(Region),
                Timeout = RequestTimeout,
                MaxErrorRetry = 1,
            };
        }

        var serviceUrl = ToServiceUrl(Endpoint);
        var authRegion = serviceUrl.Contains(".r2.cloudflarestorage.com", StringComparison.OrdinalIgnoreCase)
            ? "auto"
            : Region;
        return new AmazonS3Config
        {
            ServiceURL = serviceUrl,
            ForcePathStyle = true,
            AuthenticationRegion = authRegion,
            Timeout = RequestTimeout,
            MaxErrorRetry = 1,
            // AWSSDK.S3 3.7.412+ (this project is on the 4.x line) defaults to attaching a CRC32
            // integrity checksum to every request and validating one on every response
            // (RequestChecksumCalculation/ResponseChecksumValidation = WHEN_SUPPORTED). Real AWS S3
            // handles this fine, but some non-AWS S3-compatible servers (MinIO in particular - see
            // github.com/minio/minio/issues/20845) don't understand the extra
            // x-amz-sdk-checksum-algorithm/aws-chunked framing this adds to the signed request, and
            // reject the whole request - surfacing as a plain 403 AccessDenied with no hint that
            // checksums were the actual problem (confirmed *not* the cause for the IDrive e2 bug
            // that prompted this pass - see the credential case-sensitivity fix above, which was -
            // but kept anyway since it's still AWS's own documented guidance for any non-AWS
            // endpoint: https://docs.aws.amazon.com/sdkref/latest/guide/feature-dataintegrity.html).
            RequestChecksumCalculation = Amazon.Runtime.RequestChecksumCalculation.WHEN_REQUIRED,
            ResponseChecksumValidation = Amazon.Runtime.ResponseChecksumValidation.WHEN_REQUIRED,
        };
    }

    private static string ToServiceUrl(string endpoint) =>
        endpoint.Contains("://", StringComparison.Ordinal) ? endpoint : $"https://{endpoint}";
}

/// <summary>The JSON shape stored (encrypted) via window.maktaba.saveCloudCredential and passed
/// transiently to the backend - see the frontend's S3 connect form.</summary>
public record S3Credential(string AccessKeyId, string SecretAccessKey);
