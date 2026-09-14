using Maktaba.Core.Services;

namespace Maktaba.Data;

public static class CoverLocator
{
    private static readonly (string FileName, string ContentType)[] CoverCandidates =
    [
        ("cover.jpg", "image/jpeg"),
        ("cover.jpeg", "image/jpeg"),
        ("cover.png", "image/png"),
    ];

    public static readonly IReadOnlyList<string> CoverFileNames = CoverCandidates.Select(c => c.FileName).ToArray();

    // Deliberately synchronous and takes a raw local root rather than IStorageProvider - it's called
    // per-book inside synchronous list projections across several endpoints (BookEndpoints,
    // PeriodicalEndpoints), and for a cloud-backed library it only reports a cover as present if it's
    // already in the local cache mirror. Making list views cloud-accurate would need a DB-backed
    // "has cover" flag instead of a filesystem probe - out of scope for this pass; see the matching
    // note on AuthorImageLocator.
    /// <param name="bookFolderRelativePath">A <c>Book.FolderPath</c> value, relative to the library root.</param>
    public static (string FilePath, string ContentType)? Find(string libraryRoot, string bookFolderRelativePath)
    {
        var folder = Path.Combine(libraryRoot, bookFolderRelativePath);
        foreach (var (fileName, contentType) in CoverCandidates)
        {
            var path = Path.Combine(folder, fileName);
            if (File.Exists(path))
            {
                return (path, contentType);
            }
        }

        return null;
    }

    /// <summary>
    /// Storage-aware counterpart to <see cref="Find"/> for the actual cover-serving endpoints
    /// (as opposed to the synchronous "hasCover" list projections) - checks each candidate filename
    /// against <paramref name="storage"/> (which, for a cloud-backed provider, confirms against the
    /// remote store if it's not already in the local cache mirror) and, once a match is found,
    /// calls <see cref="IStorageProvider.GetLocalPathAsync"/> to actually download it into the cache
    /// if needed before returning a local path. This is what makes a cover actually load for a
    /// cloud library the first time it's requested, rather than only ever showing one that happened
    /// to already be cached locally for some other reason.
    /// </summary>
    /// <param name="bookFolderRelativePath">A <c>Book.FolderPath</c> value, relative to the library root.</param>
    public static async Task<(string FilePath, string ContentType)?> FindAsync(
        IStorageProvider storage, string bookFolderRelativePath, CancellationToken ct = default)
    {
        foreach (var (fileName, contentType) in CoverCandidates)
        {
            var relativePath = Path.Combine(bookFolderRelativePath, fileName);
            if (await storage.ExistsAsync(relativePath, ct))
            {
                var path = await storage.GetLocalPathAsync(relativePath, ct);
                return (path, contentType);
            }
        }

        return null;
    }

    /// <summary>
    /// Issue #66: the cover file's last-write time as Unix milliseconds, or null if there's no
    /// cover - lets the frontend put a value that only changes when the actual cover bytes change
    /// into the image URL's query string, so the browser's HTTP cache (and BookGrid/BookList/
    /// BookDetailPanel's plain &lt;img&gt; elements) reliably pick up a newly extracted/replaced
    /// cover instead of continuing to show whatever was cached under the same URL.
    /// </summary>
    public static long? GetVersion(string libraryRoot, string bookFolderRelativePath)
    {
        var found = Find(libraryRoot, bookFolderRelativePath);
        return found is { } cover ? new DateTimeOffset(File.GetLastWriteTimeUtc(cover.FilePath)).ToUnixTimeMilliseconds() : null;
    }
}
