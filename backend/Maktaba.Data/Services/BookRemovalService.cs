using Maktaba.Core.Services;
using Microsoft.EntityFrameworkCore;

namespace Maktaba.Data.Services;

public class BookRemovalService(MaktabaDbContext db, IStorageProviderFactory storageFactory) : IBookRemovalService
{
    public async Task<BookRemovalResult?> RemoveAsync(int bookId, CancellationToken ct = default)
    {
        var book = await db.Books.FirstOrDefaultAsync(b => b.Id == bookId, ct);
        if (book is null)
        {
            return null;
        }

        var absoluteFolderPath = await storageFactory.Current.GetLocalPathAsync(book.FolderPath, ct);

        // BookAuthor/BookSeries/BookTag/BookFile/Identifier rows cascade-delete via their required FK to Book.
        db.Books.Remove(book);
        await db.SaveChangesAsync(ct);

        return new BookRemovalResult(absoluteFolderPath);
    }
}
