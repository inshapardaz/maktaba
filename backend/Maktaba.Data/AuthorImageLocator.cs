using Maktaba.Core.Ids;

namespace Maktaba.Data;

/// <summary>
/// Author photos are stored flat under a reserved "AuthorImages/{sqid}.{ext}" top-level folder
/// (see LibraryRescanService's reserved-folder exclusion) rather than per-author subfolders, since
/// an author has no other files of its own the way a Book/Periodical folder holds ebook files.
/// Existence is purely file-convention based - no DB column - same pattern as CoverLocator.
/// </summary>
public static class AuthorImageLocator
{
    private const string FolderName = "AuthorImages";

    private static readonly (string Extension, string ContentType)[] Candidates =
    [
        (".jpg", "image/jpeg"),
        (".jpeg", "image/jpeg"),
        (".png", "image/png"),
    ];

    public static (string FilePath, string ContentType)? Find(string libraryRoot, int authorId)
    {
        var sqid = IdCodec.Encode(authorId);
        foreach (var (extension, contentType) in Candidates)
        {
            var path = Path.Combine(libraryRoot, FolderName, sqid + extension);
            if (File.Exists(path))
            {
                return (path, contentType);
            }
        }

        return null;
    }

    public static string Save(string libraryRoot, int authorId, string contentType)
    {
        var folder = Path.Combine(libraryRoot, FolderName);
        Directory.CreateDirectory(folder);

        // Remove any existing image of a different extension first, same reasoning as
        // PeriodicalService.SaveCoverAsync - otherwise a jpg->png re-upload leaves both behind.
        var sqid = IdCodec.Encode(authorId);
        foreach (var file in Directory.EnumerateFiles(folder, $"{sqid}.*"))
        {
            File.Delete(file);
        }

        var extension = contentType == "image/png" ? ".png" : ".jpg";
        return Path.Combine(folder, sqid + extension);
    }

    public static void Delete(string libraryRoot, int authorId)
    {
        var folder = Path.Combine(libraryRoot, FolderName);
        if (!Directory.Exists(folder))
        {
            return;
        }

        var sqid = IdCodec.Encode(authorId);
        foreach (var file in Directory.EnumerateFiles(folder, $"{sqid}.*"))
        {
            File.Delete(file);
        }
    }
}
