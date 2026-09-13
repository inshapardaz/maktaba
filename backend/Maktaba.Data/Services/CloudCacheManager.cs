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
        await using var fileStream = File.Create(path);
        await content.CopyToAsync(fileStream, ct);
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
