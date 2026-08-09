using Maktaba.Core.Services;
using Microsoft.EntityFrameworkCore;

namespace Maktaba.Data.Services;

public class BookRemovalService(MaktabaDbContext db, ILibraryPathProvider libraryPath) : IBookRemovalService
{
    public async Task<BookRemovalResult?> RemoveAsync(int bookId, CancellationToken ct = default)
    {
        var book = await db.Books.FirstOrDefaultAsync(b => b.Id == bookId, ct);
        if (book is null)
        {
            return null;
        }

        var absoluteFolderPath = Path.Combine(libraryPath.LibraryRootPath!, book.FolderPath);

        // BookAuthor/BookSeries/BookTag/BookFile/Identifier rows cascade-delete via their required FK to Book.
        db.Books.Remove(book);
        await db.SaveChangesAsync(ct);

        return new BookRemovalResult(absoluteFolderPath);
    }
}
