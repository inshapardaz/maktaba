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
