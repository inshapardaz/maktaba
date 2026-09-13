using Maktaba.Core.Ids;
using Maktaba.Core.Services;

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

    // Deliberately synchronous and takes a raw local root rather than IStorageProvider - it's called
    // per-author inside synchronous list projections across several endpoints (BookEndpoints,
    // BrowseEndpoints), and for a cloud-backed library it only reports true for an image that's
    // already present in the local cache mirror. Making list views cloud-accurate would need a
    // DB-backed "has image" flag instead of a filesystem probe - out of scope for this pass; see the
    // matching note on CoverLocator.
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

    public static async Task SaveAsync(
        IStorageProvider storage, int authorId, string contentType, Stream content, CancellationToken ct)
    {
        await storage.CreateDirectoryAsync(FolderName, ct);

        // Remove any existing image of a different extension first, same reasoning as
        // PeriodicalService.SaveCoverAsync - otherwise a jpg->png re-upload leaves both behind.
        var sqid = IdCodec.Encode(authorId);
        await foreach (var entry in storage.EnumerateAsync(FolderName, ct))
        {
            if (!entry.IsDirectory && Path.GetFileNameWithoutExtension(entry.RelativePath) == sqid)
            {
                await storage.DeleteAsync(entry.RelativePath, recursive: false, ct);
            }
        }

        var extension = contentType == "image/png" ? ".png" : ".jpg";
        var relative = Path.Combine(FolderName, sqid + extension);
        var absolute = await storage.GetLocalPathAsync(relative, ct);
        await using (var fileStream = File.Create(absolute))
        {
            await content.CopyToAsync(fileStream, ct);
        }

        await storage.NotifyWrittenAsync(relative, ct);
    }

    public static async Task DeleteAsync(IStorageProvider storage, int authorId, CancellationToken ct)
    {
        if (!await storage.ExistsAsync(FolderName, ct))
        {
            return;
        }

        var sqid = IdCodec.Encode(authorId);
        await foreach (var entry in storage.EnumerateAsync(FolderName, ct))
        {
            if (!entry.IsDirectory && Path.GetFileNameWithoutExtension(entry.RelativePath) == sqid)
            {
                await storage.DeleteAsync(entry.RelativePath, recursive: false, ct);
            }
        }
    }
}
