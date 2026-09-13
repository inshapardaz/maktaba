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
    // Keyed by (libraryId, providerType, credential hash) rather than just libraryId, so a
    // freshly-supplied credential (the frontend re-opening with a new/changed one) naturally
    // produces a fresh provider instead of needing an explicit cache-invalidation call - a stale
    // entry here is just never looked up again once the credential in ICloudCredentialCache
    // changes. providerType is part of the key too (not just libraryId+hash) so a library that's
    // been migrated from one cloud provider to another can't accidentally reuse a cached instance
    // built for the old one.
    private readonly Dictionary<(string LibraryId, string ProviderType, string CredentialHash), IStorageProvider> _cloudCache = [];

    public IStorageProvider Current
    {
        get
        {
            var entry = libraryService.Libraries.FirstOrDefault(l => l.Id == libraryService.CurrentLibraryId);
            var providerType = entry?.ProviderType ?? "local";

            if (providerType == "local")
            {
                return local;
            }

            if (!credentials.TryGet(entry!.Id, out var credential))
            {
                throw new InvalidOperationException(
                    "This library's credentials haven't been supplied for this session yet - reopen it with its credential.");
            }

            return GetOrCreateCloudProvider(entry.Id, providerType, entry.ProviderConfig ?? new Dictionary<string, string>(), credential);
        }
    }

    // The migration wizard (Cloud: Phase 3) needs a provider for a library that isn't registered
    // under its new ProviderType yet - it's still "local" (or another cloud provider) in the
    // registry until LibraryService.SwitchProviderAsync runs at the end of a successful migration.
    // libraryId is deliberately the *same* id the library already has (migration never creates a
    // new library, only changes where an existing one's files live) - see ICloudCacheManager, whose
    // cache is keyed by libraryId, so the target's local cache mirror naturally lines up with
    // whatever this library ends up being once the switch happens.
    //
    // Deliberately bypasses _cloudCache (unlike Current, below): a migration target is a one-off,
    // and the same libraryId+credential can legitimately point at a *different* bucket/folder
    // across retries (e.g. the user picks a different target the second time around, or retries
    // migration after fixing something) - satisfying that from a cache keyed only on
    // (libraryId, providerType, credentialHash) would silently keep using whichever config was
    // supplied on the *first* call this backend process ever made for that combination, ignoring
    // the new providerConfig entirely.
    public IStorageProvider CreateForProvider(
        string libraryId, string providerType, IReadOnlyDictionary<string, string> providerConfig, string credential)
    {
        credentials.Set(libraryId, credential);
        return BuildProvider(libraryId, providerType, providerConfig, credential);
    }

    private IStorageProvider BuildProvider(
        string libraryId, string providerType, IReadOnlyDictionary<string, string> providerConfig, string credential) =>
        providerType switch
        {
            "local" => local,
            "s3" => new S3StorageProvider(libraryId, S3ProviderOptions.FromConfig(providerConfig, credential), cloudCacheManager),
            "onedrive" => new OneDriveStorageProvider(libraryId, OneDriveProviderOptions.FromConfig(providerConfig, credential), cloudCacheManager),
            _ => throw new NotSupportedException($"Storage provider \"{providerType}\" isn't implemented yet."),
        };

    private IStorageProvider GetOrCreateCloudProvider(
        string libraryId, string providerType, IReadOnlyDictionary<string, string> providerConfig, string credential)
    {
        var credentialHash = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(credential)));
        var key = (libraryId, providerType, credentialHash);
        if (_cloudCache.TryGetValue(key, out var existing))
        {
            return existing;
        }

        var provider = BuildProvider(libraryId, providerType, providerConfig, credential);
        _cloudCache[key] = provider;
        return provider;
    }
}
