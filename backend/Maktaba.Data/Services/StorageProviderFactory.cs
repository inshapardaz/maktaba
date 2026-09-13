using System.Security.Cryptography;
using System.Text;
using Maktaba.Cloud;
using Maktaba.Core.Services;

namespace Maktaba.Data.Services;

/// <summary>
/// Resolves the currently open library's <see cref="IStorageProvider"/> by its registry entry's
/// <see cref="LibraryRegistryEntry.ProviderType"/>. This is the one place a new provider type gets
/// wired in without any caller above this factory needing to change - OneDrive/Google Drive/
/// Nawishta land here in later phases the same way "s3" did.
/// </summary>
public class StorageProviderFactory(
    ILibraryService libraryService,
    LocalFileSystemProvider local,
    ICloudCacheManager cloudCacheManager,
    ICloudCredentialCache credentials) : IStorageProviderFactory
{
    // Keyed by (libraryId, credential hash) rather than just libraryId, so a freshly-supplied
    // credential (the frontend re-opening with a new/changed one) naturally produces a fresh
    // S3StorageProvider instead of needing an explicit cache-invalidation call - a stale entry here
    // is just never looked up again once the credential in ICloudCredentialCache changes.
    private readonly Dictionary<(string LibraryId, string CredentialHash), S3StorageProvider> _s3Cache = [];

    public IStorageProvider Current
    {
        get
        {
            var entry = libraryService.Libraries.FirstOrDefault(l => l.Id == libraryService.CurrentLibraryId);
            var providerType = entry?.ProviderType ?? "local";

            return providerType switch
            {
                "local" => local,
                "s3" => GetOrCreateS3Provider(entry!),
                _ => throw new NotSupportedException($"Storage provider \"{providerType}\" isn't implemented yet."),
            };
        }
    }

    private S3StorageProvider GetOrCreateS3Provider(LibraryRegistryEntry entry)
    {
        if (!credentials.TryGet(entry.Id, out var credential))
        {
            throw new InvalidOperationException(
                "This library's S3 credentials haven't been supplied for this session yet - reopen it with its credential.");
        }

        var credentialHash = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(credential)));
        var key = (entry.Id, credentialHash);
        if (_s3Cache.TryGetValue(key, out var existing))
        {
            return existing;
        }

        var options = S3ProviderOptions.FromConfig(entry.ProviderConfig ?? new Dictionary<string, string>(), credential);
        var provider = new S3StorageProvider(entry.Id, options, cloudCacheManager);
        _s3Cache[key] = provider;
        return provider;
    }
}
