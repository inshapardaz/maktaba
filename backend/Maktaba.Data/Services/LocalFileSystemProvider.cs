using System.Runtime.CompilerServices;
using Maktaba.Core.Services;
using Maktaba.Core.Sync;

namespace Maktaba.Data.Services;

/// <summary>
/// Default <see cref="IStorageProvider"/> - a thin pass-through onto the currently open library's
/// root folder, matching exactly how every service worked before this abstraction existed. No
/// caching, no remote sync: a library-relative path just resolves to
/// Path.Combine(LibraryRootPath, relativePath).
/// </summary>
public class LocalFileSystemProvider(ILibraryPathProvider libraryPath) : IStorageProvider
{
    public string ProviderType => "local";

    private string Root => libraryPath.LibraryRootPath!;

    public Task<string> GetLocalPathAsync(string relativePath, CancellationToken ct = default) =>
        Task.FromResult(Path.Combine(Root, relativePath));

    public Task NotifyWrittenAsync(string relativePath, CancellationToken ct = default) => Task.CompletedTask;

    public Task CreateDirectoryAsync(string relativePath, CancellationToken ct = default)
    {
        Directory.CreateDirectory(Path.Combine(Root, relativePath));
        return Task.CompletedTask;
    }

    public Task DeleteAsync(string relativePath, bool recursive = false, CancellationToken ct = default)
    {
        var absolute = Path.Combine(Root, relativePath);
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
        var fromAbsolute = Path.Combine(Root, fromRelativePath);
        var toAbsolute = Path.Combine(Root, toRelativePath);
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
        var absolute = Path.Combine(Root, relativePath);
        return Task.FromResult(File.Exists(absolute) || Directory.Exists(absolute));
    }

    public Task<bool> ExistsRemoteAsync(string relativePath, CancellationToken ct = default) => ExistsAsync(relativePath, ct);

    public async IAsyncEnumerable<StorageEntry> EnumerateAsync(
        string relativePath, [EnumeratorCancellation] CancellationToken ct = default)
    {
        var absolute = Path.Combine(Root, relativePath);
        if (!Directory.Exists(absolute))
        {
            yield break;
        }

        foreach (var entry in Directory.EnumerateFileSystemEntries(absolute))
        {
            ct.ThrowIfCancellationRequested();
            var entryRelative = Path.GetRelativePath(Root, entry);
            yield return new StorageEntry(entryRelative, Directory.Exists(entry));
        }

        await Task.CompletedTask;
    }

    public Task<string> PullDatabaseAsync(CancellationToken ct = default) =>
        Task.FromResult(libraryPath.DatabasePath!);

    public Task PushDatabaseAsync(CancellationToken ct = default) => Task.CompletedTask;

    public Task<DateTimeOffset?> GetRemoteDatabaseLastModifiedAsync(CancellationToken ct = default) =>
        Task.FromResult<DateTimeOffset?>(null);

    public Task<LibraryLockInfo?> ReadLockAsync(CancellationToken ct = default) => Task.FromResult<LibraryLockInfo?>(null);

    public Task WriteLockAsync(LibraryLockInfo lockInfo, CancellationToken ct = default) => Task.CompletedTask;

    public Task DeleteLockAsync(CancellationToken ct = default) => Task.CompletedTask;

    public Task<string?> GetWebViewUrlAsync(string relativePath, CancellationToken ct = default) =>
        Task.FromResult<string?>(null);
}
