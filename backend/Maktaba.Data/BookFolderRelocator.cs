using Maktaba.Core.Entities;
using Maktaba.Core.Naming;
using Maktaba.Core.Services;

namespace Maktaba.Data;

/// <summary>
/// Shared on-disk folder-move logic for the "{AuthorSortName}/{Title} ({BookId})" layout. Used both
/// by single-book edits (BookEditService) and library-wide author renames (AuthorRenameService) - a
/// book's folder needs to move the same way regardless of which operation changed its title or
/// primary author's sort name.
/// </summary>
internal static class BookFolderRelocator
{
    public readonly record struct FolderMove(string OldRelative, string NewRelative);

    /// <summary>
    /// Renames/moves the book's on-disk folder (and its files) to match its current Title and
    /// primary author's SortName - or, for a book that's an issue of a Periodical (PeriodicalId
    /// set), its periodical's folder instead of an author folder. No-op if the folder already
    /// matches. Mutates book.FolderPath and each file's FilePath in place; does not save changes.
    /// Callers must have .Include(b => b.Periodical) whenever a book might have PeriodicalId set.
    /// </summary>
    public static async Task<FolderMove?> RelocateIfNeededAsync(
        Book book, string oldFolderRelative, IStorageProvider storage, CancellationToken ct)
    {
        var newFolderRelative = book.Periodical is { } periodical
            ? LibraryPathBuilder.IssueFolderPath(periodical.Name, periodical.Id, book.Title, book.Id)
            : LibraryPathBuilder.BookFolderPath(
                book.BookAuthors.OrderBy(ba => ba.Order).Select(ba => ba.Author.SortName).FirstOrDefault(),
                book.Title, book.Id);

        if (string.Equals(newFolderRelative, oldFolderRelative, StringComparison.Ordinal))
        {
            return null;
        }

        await storage.MoveAsync(oldFolderRelative, newFolderRelative, ct);
        book.FolderPath = newFolderRelative;

        // Best-effort only: a cloud-synced library folder (OneDrive/Dropbox/etc.) can hold a brief
        // lock on a directory it still considers "empty" from .NET's point of view, making a delete
        // throw even though nothing is actually left in it. This step is pure cosmetic cleanup
        // (removing a now-empty leftover author folder) - not required for correctness, since the
        // book's own folder has already been moved above - so a failure here must not abort the
        // whole rename/edit and leave DB and disk out of sync (this method wouldn't return its
        // FolderMove, and the caller's rollback tracking would miss a move that in fact already
        // succeeded). The empty folder is simply left behind for the user (or a later sync/retry) to
        // clean up.
        var oldParentRelative = Path.GetDirectoryName(oldFolderRelative) ?? "";
        try
        {
            var hasEntries = false;
            await foreach (var _ in storage.EnumerateAsync(oldParentRelative, ct))
            {
                hasEntries = true;
                break;
            }

            if (!hasEntries && await storage.ExistsAsync(oldParentRelative, ct))
            {
                await storage.DeleteAsync(oldParentRelative, recursive: false, ct);
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

        var newFolderAbsolute = await storage.GetLocalPathAsync(newFolderRelative, ct);
        foreach (var file in book.Files)
        {
            var oldFileName = Path.GetFileName(file.FilePath);
            // Issue #27: a user-renamed file keeps its chosen name across folder moves instead of
            // being silently renamed back to the title-derived name on the next title/author edit.
            var newFileName = file.IsCustomNamed
                ? oldFileName
                : FileNaming.SanitizePathSegment(book.Title) + Path.GetExtension(file.FilePath);

            if (string.Equals(oldFileName, newFileName, StringComparison.Ordinal))
            {
                file.FilePath = Path.Combine(newFolderRelative, oldFileName);
                continue;
            }

            // The file already physically moved along with the folder above - this second move just
            // renames it in place to match the book's new title.
            var oldFileRelative = Path.Combine(newFolderRelative, oldFileName);
            var newFileAbsolute = EbookFileHelpers.GetUniqueFilePath(newFolderAbsolute, newFileName);
            var newFileRelative = Path.Combine(newFolderRelative, Path.GetFileName(newFileAbsolute));
            await storage.MoveAsync(oldFileRelative, newFileRelative, ct);
            file.FilePath = newFileRelative;
        }

        return new FolderMove(oldFolderRelative, newFolderRelative);
    }
}
