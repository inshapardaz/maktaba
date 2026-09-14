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
        if (!requiresLocalTrash)
        {
            try
            {
                await storage.DeleteAsync(book.FolderPath, recursive: true, ct);
            }
            catch (Exception ex)
            {
                logger.LogWarning(ex, "Failed to delete book folder \"{FolderPath}\" from the cloud provider.", book.FolderPath);
            }
        }

        // BookAuthor/BookSeries/BookTag/BookFile/Identifier rows cascade-delete via their required FK to Book.
        db.Books.Remove(book);
        await db.SaveChangesAsync(ct);

        return new BookRemovalResult(absoluteFolderPath, requiresLocalTrash);
    }
}
