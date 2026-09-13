namespace Maktaba.Core.Services;

/// <summary>One entry (file or folder) returned by <see cref="IStorageProvider.EnumerateAsync"/>,
/// relative to the library root.</summary>
public record StorageEntry(string RelativePath, bool IsDirectory);

/// <summary>
/// Abstracts where a library's book files (and its metadata.db) actually live, so callers work
/// with library-relative paths instead of raw System.IO calls. <see cref="LocalFileSystemProvider"/>
/// (the default) is a thin pass-through onto the library root; a cloud-backed provider instead
/// keeps a local cache mirror in sync with a remote store - see the "local cache mirror" design in
/// the cloud storage epic. Either way, callers always end up with a plain local path to read/write,
/// never a remote stream.
/// </summary>
public interface IStorageProvider
{
    /// <summary>"local" | "s3" | "onedrive" | "googledrive" | "nawishta" - matches the owning
    /// library registry entry's provider type.</summary>
    string ProviderType { get; }

    /// <summary>Resolves a library-relative path to a local, readable/writable filesystem path,
    /// downloading it into the cache first if this provider is cloud-backed and the cache copy is
    /// missing or stale. For <see cref="LocalFileSystemProvider"/> this is just the relative path
    /// combined with the library root.</summary>
    Task<string> GetLocalPathAsync(string relativePath, CancellationToken ct = default);

    /// <summary>Call after writing to the path returned by <see cref="GetLocalPathAsync"/> so a
    /// cloud-backed provider can queue/perform the upload back to the remote store. A no-op for
    /// <see cref="LocalFileSystemProvider"/>.</summary>
    Task NotifyWrittenAsync(string relativePath, CancellationToken ct = default);

    Task CreateDirectoryAsync(string relativePath, CancellationToken ct = default);

    Task DeleteAsync(string relativePath, bool recursive = false, CancellationToken ct = default);

    Task MoveAsync(string fromRelativePath, string toRelativePath, CancellationToken ct = default);

    Task<bool> ExistsAsync(string relativePath, CancellationToken ct = default);

    /// <summary>Like <see cref="ExistsAsync"/> but never trusts a cloud-backed provider's local
    /// cache mirror - always confirms against the remote store itself. The migration wizard's
    /// per-file resumability check needs this distinction: a target's cache can hold a file that
    /// was copied into it locally but never actually confirmed pushed remotely (an interrupted or
    /// retried migration), which <see cref="ExistsAsync"/>'s cache-first shortcut would otherwise
    /// mistake for "already migrated" and skip re-uploading. Identical to
    /// <see cref="ExistsAsync"/> for <see cref="LocalFileSystemProvider"/>, which has no cache to
    /// be wrong about.</summary>
    Task<bool> ExistsRemoteAsync(string relativePath, CancellationToken ct = default);

    /// <summary>Lists the immediate children of <paramref name="relativePath"/> (not recursive -
    /// callers recurse by enumerating a returned directory entry themselves).</summary>
    IAsyncEnumerable<StorageEntry> EnumerateAsync(string relativePath, CancellationToken ct = default);

    /// <summary>Ensures the library's metadata.db is present and current locally (pulling from the
    /// remote store first for a cloud-backed provider) and returns its local path. Call before an
    /// EF Core DbContext opens it. A no-op for <see cref="LocalFileSystemProvider"/>.</summary>
    Task<string> PullDatabaseAsync(CancellationToken ct = default);

    /// <summary>Pushes the local metadata.db back to the remote store. A no-op for
    /// <see cref="LocalFileSystemProvider"/>.</summary>
    Task PushDatabaseAsync(CancellationToken ct = default);
}

/// <summary>Resolves the <see cref="IStorageProvider"/> for a library, by its registry entry's
/// provider type - the one extension point new providers (S3, OneDrive, Google Drive, Nawishta)
/// plug into without any caller above this factory needing to change.</summary>
public interface IStorageProviderFactory
{
    /// <summary>The storage provider for the currently open library.</summary>
    IStorageProvider Current { get; }

    /// <summary>Resolves (constructing and caching if needed) a provider for an arbitrary
    /// provider type/config/credential, independent of the library registry - used by the
    /// migration wizard to talk to a target that a library isn't actually registered under yet.
    /// Also caches the credential (see ICloudCredentialCache) under <paramref name="libraryId"/>,
    /// so it's already available once that library's registry entry is switched to match.</summary>
    IStorageProvider CreateForProvider(
        string libraryId, string providerType, IReadOnlyDictionary<string, string> providerConfig, string credential);
}
