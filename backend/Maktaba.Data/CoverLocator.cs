namespace Maktaba.Data;

public static class CoverLocator
{
    private static readonly (string FileName, string ContentType)[] CoverCandidates =
    [
        ("cover.jpg", "image/jpeg"),
        ("cover.jpeg", "image/jpeg"),
        ("cover.png", "image/png"),
    ];

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
}
