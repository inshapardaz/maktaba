using Maktaba.Core.Entities;
using Maktaba.Core.Ids;
using Maktaba.Core.Naming;

namespace Maktaba.Data;

/// <summary>
/// Shared on-disk folder-move logic for the "{AuthorSortName}/{Title} ({BookId})" layout. Used both
/// by single-book edits (BookEditService) and library-wide author renames (AuthorRenameService) - a
/// book's folder needs to move the same way regardless of which operation changed its title or
/// primary author's sort name.
/// </summary>
internal static class BookFolderRelocator
{
    public readonly record struct FolderMove(string OldAbsolute, string NewAbsolute);

    /// <summary>
    /// Renames/moves the book's on-disk folder (and its files) to match its current Title and
    /// primary author's SortName. No-op if the folder already matches. Mutates book.FolderPath and
    /// each file's FilePath in place; does not save changes.
    /// </summary>
    public static FolderMove? RelocateIfNeeded(Book book, string oldFolderRelative, string libraryRoot)
    {
        var newAuthorSortName = book.BookAuthors
            .OrderBy(ba => ba.Order)
            .Select(ba => ba.Author.SortName)
            .FirstOrDefault() ?? "Unknown Author";

        var newFolderRelative = Path.Combine(
            FileNaming.SanitizePathSegment(newAuthorSortName),
            FileNaming.SanitizePathSegment($"{book.Title} ({IdCodec.Encode(book.Id)})"));

        if (string.Equals(newFolderRelative, oldFolderRelative, StringComparison.Ordinal))
        {
            return null;
        }

        var oldAbsolute = Path.Combine(libraryRoot, oldFolderRelative);
        var newAbsolute = Path.Combine(libraryRoot, newFolderRelative);

        Directory.CreateDirectory(Path.GetDirectoryName(newAbsolute)!);
        Directory.Move(oldAbsolute, newAbsolute);
        book.FolderPath = newFolderRelative;

        // Best-effort only: a cloud-synced library folder (OneDrive/Dropbox/etc.) can hold a brief
        // lock on a directory it still considers "empty" from .NET's point of view, making
        // Directory.Delete throw even though nothing is actually left in it. This step is pure
        // cosmetic cleanup (removing a now-empty leftover author folder) - not required for
        // correctness, since the book's own folder has already been moved above - so a failure here
        // must not abort the whole rename/edit and leave DB and disk out of sync (this method
        // wouldn't return its FolderMove, and the caller's rollback tracking would miss a move that
        // in fact already succeeded). The empty folder is simply left behind for the user (or a
        // later sync/retry) to clean up.
        var oldAuthorFolder = Path.GetDirectoryName(oldAbsolute)!;
        try
        {
            if (Directory.Exists(oldAuthorFolder) && Directory.EnumerateFileSystemEntries(oldAuthorFolder).Any() == false)
            {
                Directory.Delete(oldAuthorFolder);
            }
        }
        catch (IOException)
        {
            // Ignored - see comment above.
        }
        catch (UnauthorizedAccessException)
        {
            // Ignored - see comment above.
        }

        foreach (var file in book.Files)
        {
            var oldFileName = Path.GetFileName(file.FilePath);
            var newFileName = FileNaming.SanitizePathSegment(book.Title) + Path.GetExtension(file.FilePath);

            if (string.Equals(oldFileName, newFileName, StringComparison.Ordinal))
            {
                file.FilePath = Path.Combine(newFolderRelative, oldFileName);
                continue;
            }

            var oldFileAbsolute = Path.Combine(newAbsolute, oldFileName);
            var newFileAbsolute = EbookFileHelpers.GetUniqueFilePath(newAbsolute, newFileName);
            File.Move(oldFileAbsolute, newFileAbsolute);
            file.FilePath = Path.Combine(newFolderRelative, Path.GetFileName(newFileAbsolute));
        }

        return new FolderMove(oldAbsolute, newAbsolute);
    }
}
