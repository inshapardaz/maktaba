using Maktaba.Core.Entities;
using Maktaba.Core.Naming;
using Maktaba.Core.Services;
using Microsoft.EntityFrameworkCore;

namespace Maktaba.Data.Services;

public class BookEditService(MaktabaDbContext db) : IBookEditService
{
    public async Task<Book?> UpdateAsync(Guid bookId, BookEditRequest request, CancellationToken ct = default)
    {
        var book = await db.Books
            .Include(b => b.BookAuthors)
            .Include(b => b.BookSeries)
            .Include(b => b.BookTags)
            .FirstOrDefaultAsync(b => b.Id == bookId, ct);

        if (book is null)
        {
            return null;
        }

        book.Title = request.Title;
        book.SortTitle = TitleSorting.ComputeSortTitle(request.Title);
        book.Language = request.Language;
        book.Publisher = request.Publisher;
        book.DatePublished = request.PublishedDate;
        book.Description = request.Description;
        book.Rating = Math.Clamp(request.Rating, 0, 5);

        db.BookAuthors.RemoveRange(book.BookAuthors);
        book.BookAuthors.Clear();
        var authors = await EntityResolvers.ResolveAuthorsAsync(db, request.Authors, ct);
        for (var i = 0; i < authors.Count; i++)
        {
            book.BookAuthors.Add(new BookAuthor { BookId = book.Id, Author = authors[i], Order = i });
        }

        db.BookSeries.RemoveRange(book.BookSeries);
        book.BookSeries.Clear();
        var series = await EntityResolvers.ResolveSeriesAsync(db, request.SeriesName, ct);
        if (series is not null)
        {
            book.BookSeries.Add(new BookSeries
            {
                BookId = book.Id,
                Series = series,
                SeriesIndex = request.SeriesIndex ?? 0,
            });
        }

        db.BookTags.RemoveRange(book.BookTags);
        book.BookTags.Clear();
        var tags = await EntityResolvers.ResolveTagsAsync(db, request.Tags, ct);
        foreach (var tag in tags)
        {
            book.BookTags.Add(new BookTag { BookId = book.Id, Tag = tag });
        }

        await db.SaveChangesAsync(ct);

        return book;
    }
}
