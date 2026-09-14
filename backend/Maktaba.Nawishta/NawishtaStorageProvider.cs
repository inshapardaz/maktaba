using Maktaba.Core.Services;
using Maktaba.Core.Sync;

namespace Maktaba.Nawishta;

/// <summary>
/// Issue #113 - lets a Nawishta-backed library's book content flow through the exact same
/// GetLocalPathAsync/CoverLocator/cover+file-serving endpoints every other provider already uses
/// (BookEndpoints.cs's GET ""/{id}/cover//{id}/file, etc.), rather than needing each of those
/// endpoints individually rewritten to know about Nawishta - the same "resolve to a plain local
/// path, callers never see a remote stream" contract IStorageProvider already promises, just backed
/// by Nawishta's own content-download endpoint instead of S3/Drive/Graph. Reuses
/// <see cref="ICloudCacheManager"/> (Cloud: Phase 1's local cache mirror) rather than a second cache
/// mechanism - a book's local path is <c>{cacheRoot}/{bookId}/{contentId}{extension}</c>, downloaded
/// once and reused on subsequent reads (offline reading of an already-opened book keeps working the
/// same way it does for S3/Google Drive/OneDrive).
///
/// A Nawishta library isn't a *complete* IStorageProvider the way those three are, though - it has
/// no metadata.db (Nawishta's own server is the source of truth - see NawishtaShadowDbContext's doc
/// comment), no folder/move/enumerate concept, and no cloud lock (Nawishta's own server already
/// serializes concurrent writers, unlike S3/Drive/Graph's plain object stores). Every method this
/// class doesn't meaningfully implement is either a safe no-op (matching LocalFileSystemProvider's
/// own "no-op for local" convention where an operation genuinely doesn't apply) or throws
/// NotSupportedException with a clear message (where silently doing nothing would hide a real bug -
/// e.g. a future EnumerateAsync/MoveAsync call from code that assumes full file-management support,
/// which nothing in this app is wired to attempt for a Nawishta library yet - see BookEndpoints.cs's
/// IsNawishtaLibrary branches, which route metadata edit/status/delete through
/// NawishtaBookMutationService instead of ever reaching this provider for those operations).
/// </summary>
public class NawishtaStorageProvider(
    string libraryId, int remoteLibraryId, NawishtaRawApiClient api, ICloudCacheManager cacheManager) : IStorageProvider
{
    public string ProviderType => "nawishta";

    public async Task<string> GetLocalPathAsync(string relativePath, CancellationToken ct = default)
    {
        if (string.IsNullOrEmpty(relativePath))
        {
            return cacheManager.GetCacheRoot(libraryId);
        }

        if (cacheManager.Exists(libraryId, relativePath))
        {
            return cacheManager.GetLocalPath(libraryId, relativePath);
        }

        var (bookId, contentId) = ParseContentPath(relativePath);
        var (bytes, _, _) = await api.DownloadContentAsync(remoteLibraryId, bookId, contentId, ct);
        using var stream = new MemoryStream(bytes);
        await cacheManager.WriteAsync(libraryId, relativePath, stream, ct);
        return cacheManager.GetLocalPath(libraryId, relativePath);
    }

    // relativePath is always "{bookId}/{contentId}{extension}" - see NawishtaEntityMapper.ToBook,
    // the only place BookFile.FilePath is ever set for a Nawishta-backed library.
    private static (int BookId, long ContentId) ParseContentPath(string relativePath)
    {
        var withoutExtension = Path.ChangeExtension(relativePath, null).Replace('\\', '/');
        var parts = withoutExtension.Split('/', 2);
        if (parts.Length != 2 || !int.TryParse(parts[0], out var bookId) || !long.TryParse(parts[1], out var contentId))
        {
            throw new InvalidOperationException($"Not a recognized Nawishta content path: \"{relativePath}\".");
        }

        return (bookId, contentId);
    }

    public Task NotifyWrittenAsync(string relativePath, CancellationToken ct = default) =>
        throw new NotSupportedException("Writing a file directly isn't supported for a Nawishta-backed library yet - see issue #111.");

    public Task CreateDirectoryAsync(string relativePath, CancellationToken ct = default) => Task.CompletedTask;

    public Task DeleteAsync(string relativePath, bool recursive = false, CancellationToken ct = default) =>
        throw new NotSupportedException("Deleting a file/folder directly isn't supported for a Nawishta-backed library yet - see issue #111.");

    public Task MoveAsync(string fromRelativePath, string toRelativePath, CancellationToken ct = default) =>
        throw new NotSupportedException("Moving a file isn't supported for a Nawishta-backed library.");

    public Task<bool> ExistsAsync(string relativePath, CancellationToken ct = default) =>
        Task.FromResult(cacheManager.Exists(libraryId, relativePath));

    public Task<bool> ExistsRemoteAsync(string relativePath, CancellationToken ct = default) =>
        Task.FromResult(false);

    public async IAsyncEnumerable<StorageEntry> EnumerateAsync(
        string relativePath, [System.Runtime.CompilerServices.EnumeratorCancellation] CancellationToken ct = default)
    {
        // No folder/move concept for a Nawishta library (see this class's own doc comment) - the
        // migration wizard is the only real caller of EnumerateAsync, and Nawishta isn't offered as
        // a migration source/target (MigrationWizard.tsx's Target step only lists S3/Google Drive).
        await Task.CompletedTask;
        yield break;
    }

    // metadata.db doesn't exist for a Nawishta library (see this class's own doc comment) - these
    // are never actually called (LibraryService.ActivateAsync/CloudSyncLifecycleService both branch
    // away from IStorageProviderFactory entirely for "nawishta" before reaching them), but return
    // safe no-op values rather than throwing in case a future caller reaches them anyway.
    public Task<string> PullDatabaseAsync(CancellationToken ct = default) => Task.FromResult(cacheManager.GetCacheRoot(libraryId));

    public Task PushDatabaseAsync(CancellationToken ct = default) => Task.CompletedTask;

    public Task<DateTimeOffset?> GetRemoteDatabaseLastModifiedAsync(CancellationToken ct = default) => Task.FromResult<DateTimeOffset?>(null);

    // Nawishta's own server already serializes concurrent writers (unlike S3/Drive/Graph's plain
    // object stores, which is why they need this app-level advisory lock at all) - no equivalent
    // concept here, same as LocalFileSystemProvider.
    public Task<LibraryLockInfo?> ReadLockAsync(CancellationToken ct = default) => Task.FromResult<LibraryLockInfo?>(null);

    public Task WriteLockAsync(LibraryLockInfo lockInfo, CancellationToken ct = default) => Task.CompletedTask;

    public Task DeleteLockAsync(CancellationToken ct = default) => Task.CompletedTask;

    // No confirmed public book-viewer URL scheme on Nawishta's own side yet - same "return null,
    // don't guess" convention S3 already uses (see IStorageProvider.GetWebViewUrlAsync's own doc
    // comment).
    public Task<string?> GetWebViewUrlAsync(string relativePath, CancellationToken ct = default) => Task.FromResult<string?>(null);
}
