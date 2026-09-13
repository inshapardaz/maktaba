namespace Maktaba.Cloud;

/// <summary>
/// S3StorageProvider's config, assembled from a library registry entry's ProviderConfig dict
/// (Bucket/Region/Prefix - non-secret) plus a credential supplied transiently by the frontend
/// (AccessKeyId/SecretAccessKey - never persisted by this backend, see ICloudCredentialCache).
/// </summary>
public record S3ProviderOptions(
    string Bucket,
    string Region,
    string Prefix,
    string AccessKeyId,
    string SecretAccessKey)
{
    public const string BucketKey = "bucket";
    public const string RegionKey = "region";
    public const string PrefixKey = "prefix";

    public static S3ProviderOptions FromConfig(IReadOnlyDictionary<string, string> config, string credentialJson)
    {
        var credential = System.Text.Json.JsonSerializer.Deserialize<S3Credential>(credentialJson)
            ?? throw new InvalidOperationException("Malformed S3 credential.");

        return new S3ProviderOptions(
            config.GetValueOrDefault(BucketKey) ?? throw new InvalidOperationException("Missing S3 bucket."),
            config.GetValueOrDefault(RegionKey) ?? throw new InvalidOperationException("Missing S3 region."),
            config.GetValueOrDefault(PrefixKey) ?? "",
            credential.AccessKeyId,
            credential.SecretAccessKey);
    }
}

/// <summary>The JSON shape stored (encrypted) via window.maktaba.saveCloudCredential and passed
/// transiently to the backend - see the frontend's S3 connect form.</summary>
public record S3Credential(string AccessKeyId, string SecretAccessKey);
