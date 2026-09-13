using Maktaba.Core.Services;

namespace Maktaba.Data.Services;

/// <inheritdoc cref="ICloudCacheManager"/>
public class CloudCacheManager : ICloudCacheManager
{
    public string GetCacheRoot(string libraryId)
    {
        var appData = Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData);
        return Path.Combine(appData, "Maktaba", "CloudCache", libraryId);
    }

    public string GetLocalPath(string libraryId, string relativePath) =>
        Path.Combine(GetCacheRoot(libraryId), relativePath);

    public bool Exists(string libraryId, string relativePath)
    {
        var path = GetLocalPath(libraryId, relativePath);
        return File.Exists(path) || Directory.Exists(path);
    }

    public async Task WriteAsync(string libraryId, string relativePath, Stream content, CancellationToken ct = default)
    {
        var path = GetLocalPath(libraryId, relativePath);
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);

        // Written to a temp file and swapped in with File.Move(..., overwrite: true) rather than
        // File.Create-ing the real path directly, for two reasons: a failed/cancelled download
        // never leaves a partially-written, corrupt file at the real path, and the real path is
        // only briefly touched (the move itself) rather than held open for the whole download -
        // narrowing the window for a transient external lock (antivirus scanning a just-written
        // file, a not-yet-exited previous process, Explorer's thumbnail/preview handler, ...) to
        // collide with it. The move itself can still transiently fail the same way (Windows file
        // sharing is stricter than POSIX), so it gets a short retry - this is exactly what surfaced
        // as an unhandled 500 on library reconnect: the very first pull of an existing metadata.db.
        var tempPath = path + $".tmp-{Guid.NewGuid():N}";
        try
        {
            await using (var fileStream = File.Create(tempPath))
            {
                await content.CopyToAsync(fileStream, ct);
            }

            await MoveWithRetryAsync(tempPath, path, ct);
        }
        finally
        {
            if (File.Exists(tempPath))
            {
                File.Delete(tempPath);
            }
        }
    }

    private static async Task MoveWithRetryAsync(string tempPath, string destPath, CancellationToken ct)
    {
        const int maxAttempts = 5;
        for (var attempt = 1; ; attempt++)
        {
            try
            {
                File.Move(tempPath, destPath, overwrite: true);
                return;
            }
            catch (IOException) when (attempt < maxAttempts)
            {
                await Task.Delay(200 * attempt, ct);
            }
        }
    }

    public void Delete(string libraryId, string relativePath, bool recursive = false)
    {
        var path = GetLocalPath(libraryId, relativePath);
        if (Directory.Exists(path))
        {
            Directory.Delete(path, recursive);
        }
        else if (File.Exists(path))
        {
            File.Delete(path);
        }
    }

    public void Move(string libraryId, string fromRelativePath, string toRelativePath)
    {
        var from = GetLocalPath(libraryId, fromRelativePath);
        var to = GetLocalPath(libraryId, toRelativePath);
        Directory.CreateDirectory(Path.GetDirectoryName(to)!);

        if (Directory.Exists(from))
        {
            Directory.Move(from, to);
        }
        else
        {
            File.Move(from, to);
        }
    }

    public IEnumerable<CloudCacheEntry> Enumerate(string libraryId, string relativePath)
    {
        var absolute = GetLocalPath(libraryId, relativePath);
        if (!Directory.Exists(absolute))
        {
            yield break;
        }

        var root = GetCacheRoot(libraryId);
        foreach (var entry in Directory.EnumerateFileSystemEntries(absolute))
        {
            yield return new CloudCacheEntry(Path.GetRelativePath(root, entry), Directory.Exists(entry));
        }
    }
}
