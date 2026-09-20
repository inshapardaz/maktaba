using System.Runtime.CompilerServices;
using Maktaba.Core.Services;
using Maktaba.Core.Sync;

namespace Maktaba.Data.Services;

/// <summary>
/// A local-filesystem <see cref="IStorageProvider"/> pointed at an explicit root folder, rather
/// than at whichever library <see cref="ILibraryPathProvider"/> currently considers active -
/// <see cref="LocalFileSystemProvider"/> can't be reused for this because it's registered as a
/// singleton bound to <see cref="ILibraryPathProvider.LibraryRootPath"/>, which only ever reflects
/// the *active* library (see <c>StorageProviderFactory.BuildProvider</c>'s <c>"local" => local</c>
/// branch - every local library, active or not, resolves to that one shared instance). A cross-
/// library transfer needs a second, independent local root at the same time the active library's
/// own <c>LocalFileSystemProvider</c> is still in use for the source - this is that second one,
/// used only by <see cref="BookLibraryTransferService"/> when the *target* library is local.
/// Otherwise identical to <see cref="LocalFileSystemProvider"/>.
/// </summary>
public class AdHocLocalStorageProvider(string root) : IStorageProvider
{
    public string ProviderType => "local";

    public Task<string> GetLocalPathAsync(string relativePath, CancellationToken ct = default) =>
        Task.FromResult(Path.Combine(root, relativePath));

    public Task NotifyWrittenAsync(string relativePath, CancellationToken ct = default) => Task.CompletedTask;

    public Task CreateDirectoryAsync(string relativePath, CancellationToken ct = default)
    {
        Directory.CreateDirectory(Path.Combine(root, relativePath));
        return Task.CompletedTask;
    }

    public Task DeleteAsync(string relativePath, bool recursive = false, CancellationToken ct = default)
    {
        var absolute = Path.Combine(root, relativePath);
        if (Directory.Exists(absolute))
        {
            Directory.Delete(absolute, recursive);
        }
        else if (File.Exists(absolute))
        {
            File.Delete(absolute);
        }

        return Task.CompletedTask;
    }

    public Task MoveAsync(string fromRelativePath, string toRelativePath, CancellationToken ct = default)
    {
        var fromAbsolute = Path.Combine(root, fromRelativePath);
        var toAbsolute = Path.Combine(root, toRelativePath);
        Directory.CreateDirectory(Path.GetDirectoryName(toAbsolute)!);

        if (Directory.Exists(fromAbsolute))
        {
            Directory.Move(fromAbsolute, toAbsolute);
        }
        else
        {
            File.Move(fromAbsolute, toAbsolute);
        }

        return Task.CompletedTask;
    }

    public Task<bool> ExistsAsync(string relativePath, CancellationToken ct = default)
    {
        var absolute = Path.Combine(root, relativePath);
        return Task.FromResult(File.Exists(absolute) || Directory.Exists(absolute));
    }

    public Task<bool> ExistsRemoteAsync(string relativePath, CancellationToken ct = default) => ExistsAsync(relativePath, ct);

    public async IAsyncEnumerable<StorageEntry> EnumerateAsync(
        string relativePath, [EnumeratorCancellation] CancellationToken ct = default)
    {
        var absolute = Path.Combine(root, relativePath);
        if (!Directory.Exists(absolute))
        {
            yield break;
        }

        foreach (var entry in Directory.EnumerateFileSystemEntries(absolute))
        {
            ct.ThrowIfCancellationRequested();
            var entryRelative = Path.GetRelativePath(root, entry);
            yield return new StorageEntry(entryRelative, Directory.Exists(entry));
        }

        await Task.CompletedTask;
    }

    public Task<string> PullDatabaseAsync(CancellationToken ct = default) =>
        Task.FromResult(Path.Combine(root, "metadata.db"));

    public Task PushDatabaseAsync(CancellationToken ct = default) => Task.CompletedTask;

    public Task<DateTimeOffset?> GetRemoteDatabaseLastModifiedAsync(CancellationToken ct = default) =>
        Task.FromResult<DateTimeOffset?>(null);

    public Task<LibraryLockInfo?> ReadLockAsync(CancellationToken ct = default) => Task.FromResult<LibraryLockInfo?>(null);

    public Task WriteLockAsync(LibraryLockInfo lockInfo, CancellationToken ct = default) => Task.CompletedTask;

    public Task DeleteLockAsync(CancellationToken ct = default) => Task.CompletedTask;

    public Task<string?> GetWebViewUrlAsync(string relativePath, CancellationToken ct = default) =>
        Task.FromResult<string?>(null);
}
