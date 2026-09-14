using Maktaba.Core.Services;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;

namespace Maktaba.Data.Services;

public class BookRemovalService(
    MaktabaDbContext db, IStorageProviderFactory storageFactory, ILogger<BookRemovalService> logger) : IBookRemovalService
{
    public async Task<BookRemovalResult?> RemoveAsync(int bookId, CancellationToken ct = default)
    {
        var book = await db.Books.FirstOrDefaultAsync(b => b.Id == bookId, ct);
        if (book is null)
        {
            return null;
        }

        var storage = storageFactory.Current;
        var absoluteFolderPath = await storage.GetLocalPathAsync(book.FolderPath, ct);

        // A cloud-backed library has no OS trash to defer to the way a local one does - without
        // this, the book's files (and the ones of every issue nested under it, for a periodical)
        // stayed orphaned in the remote store forever, since removing only the DB row (below) never
        // touched them and the frontend's window.maktaba.trashPath is a pure local-disk operation
        // with no cloud awareness at all. Best-effort: a failed remote delete shouldn't block
        // removing the book from the library (network hiccups happen), so this only logs rather
        // than blocking db.SaveChangesAsync below - same "don't let a background cloud operation
        // block the user" philosophy as PushCurrentLibraryIfCloudAsync's own swallowed exceptions.
        var requiresLocalTrash = storage.ProviderType == "local";

        // A plain book's parent folder is its author folder ("{Author Sort Name}/{Book Title}
        // (sqid)", see LibraryPathBuilder) - purely a derived grouping with no identity of its own,
        // so it's safe to prune once nothing files under it anymore. A periodical issue's parent is
        // its periodical's own folder instead, which does have an independent identity (a
        // Periodical DB row that still exists after this one issue is gone) - never prune that here.
        var parentRelativePath = book.PeriodicalId is null ? Path.GetDirectoryName(book.FolderPath) : null;

        if (!requiresLocalTrash)
        {
            try
            {
                await storage.DeleteAsync(book.FolderPath, recursive: true, ct);
                await DeleteIfEmptyAsync(storage, parentRelativePath, ct);
            }
            catch (Exception ex)
            {
                logger.LogWarning(ex, "Failed to delete book folder \"{FolderPath}\" from the cloud provider.", book.FolderPath);
            }
        }

        // BookAuthor/BookSeries/BookTag/BookFile/Identifier rows cascade-delete via their required FK to Book.
        db.Books.Remove(book);
        await db.SaveChangesAsync(ct);

        // Local: the caller (Electron) does the actual trashing, so it - not this method - is the
        // one in a position to check whether the author folder is actually empty once that's done;
        // this only hands back the path to check, never trashes anything itself for a local library.
        var localParentFolderPath = requiresLocalTrash && parentRelativePath is not null
            ? await storage.GetLocalPathAsync(parentRelativePath, ct)
            : null;

        return new BookRemovalResult(absoluteFolderPath, requiresLocalTrash, localParentFolderPath);
    }

    // Best-effort, same reasoning as the book folder's own delete above - never blocks removing the
    // book from the library on a failed/partial remote listing or delete.
    private static async Task DeleteIfEmptyAsync(IStorageProvider storage, string? relativePath, CancellationToken ct)
    {
        if (string.IsNullOrEmpty(relativePath))
        {
            return;
        }

        await foreach (var _ in storage.EnumerateAsync(relativePath, ct))
        {
            return;
        }

        await storage.DeleteAsync(relativePath, recursive: true, ct);
    }
}
