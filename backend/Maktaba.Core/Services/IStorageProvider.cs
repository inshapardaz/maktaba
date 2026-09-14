using Maktaba.Core.Sync;

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

    /// <summary>The remote store's last-modified time for metadata.db, or null if no remote copy
    /// exists yet (a library never pushed to before) or for a provider with no such concept
    /// (<see cref="LocalFileSystemProvider"/>, which always returns null). Lets
    /// <c>LibraryService.ActivateAsync</c> tell "the remote copy is actually newer than what's
    /// cached locally, safe to pull" apart from "the local cache mirror already has the latest (or
    /// even newer, unpushed) changes" before blindly overwriting - single-writer/last-write-wins
    /// still applies (this isn't a real merge), but it stops a plain re-open/switch from silently
    /// discarding local edits that were never pushed, which unconditionally pulling on every
    /// activation used to do.</summary>
    Task<DateTimeOffset?> GetRemoteDatabaseLastModifiedAsync(CancellationToken ct = default);

    /// <summary>Reads the library's ".maktaba-lock" marker straight from the remote store - never
    /// trusting a locally cached copy, since the whole point is detecting a lock a *different*
    /// device just wrote. Returns null if no marker exists. Always null for
    /// <see cref="LocalFileSystemProvider"/> (a local library has no concept of a remote lock). See
    /// <see cref="LibraryLockInfo"/> for the marker's format and staleness rules -
    /// <c>LibraryService.ActivateAsync</c> is what actually enforces the single-writer check this
    /// method's result feeds into.</summary>
    Task<LibraryLockInfo?> ReadLockAsync(CancellationToken ct = default);

    /// <summary>Writes <paramref name="lockInfo"/> as the library's ".maktaba-lock" marker,
    /// overwriting whatever was there. Callers are responsible for checking
    /// <see cref="ReadLockAsync"/> first per the single-writer model this implements - this method
    /// itself doesn't compare-and-swap against a concurrent writer (an unlikely race given the
    /// staleness window, and last-write-wins is the documented concurrency model everywhere else in
    /// this app too). A no-op for <see cref="LocalFileSystemProvider"/>.</summary>
    Task WriteLockAsync(LibraryLockInfo lockInfo, CancellationToken ct = default);

    /// <summary>Deletes the ".maktaba-lock" marker, if any - called on a clean switch-away/close so
    /// another device doesn't have to wait out the full staleness window before it can open this
    /// library. A no-op for <see cref="LocalFileSystemProvider"/>.</summary>
    Task DeleteLockAsync(CancellationToken ct = default);

    /// <summary>A web URL to view this file directly in the provider's own UI (e.g. Google Drive's
    /// file viewer), purely as a "View in {Provider}" convenience link for the frontend - never
    /// used for any actual file I/O. Null if the provider has no such concept (a local library, or
    /// S3 - no single console URL works across every S3-compatible provider this app supports, from
    /// AWS itself to a self-hosted MinIO with no web console at all) or the file doesn't exist
    /// remotely.</summary>
    Task<string?> GetWebViewUrlAsync(string relativePath, CancellationToken ct = default);
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
