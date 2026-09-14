using Maktaba.Core.Entities;
using Maktaba.Core.Services;
using Microsoft.EntityFrameworkCore;

namespace Maktaba.Data.Services;

/// <summary>
/// EF/SQLite implementation of <see cref="IBookQueryService"/> - a literal move of BookEndpoints.cs's
/// previously-inline queries (list/continue-reading/recently-added/get-by-id), not a rewrite. See
/// that interface's own doc comment for why cover/DTO-building logic stays in the endpoint layer
/// instead of moving here too.
/// </summary>
public class EfBookQueryService(MaktabaDbContext db) : IBookQueryService
{
    // Mirrors what the frontend's own sortBooks/compareBooks (App.tsx) used to do client-side over
    // the *entire* matching set before pagination moved server-side - moved here unchanged from
    // BookEndpoints.cs. SQL-side ORDER BY can't easily express "primary author's own display name"
    // or "series index, treating null as last" without pulling every row's related author/series
    // anyway, so this still sorts the already-materialized in-memory list, exactly as before.
    private const int DefaultPageSize = 60;

    private static int CompareBooksForSort(Book a, Book b, string? sortKey, IReadOnlyDictionary<int, DateTime> lastReadByBookId) =>
        sortKey switch
        {
            "author" => string.Compare(
                a.BookAuthors.OrderBy(ba => ba.Order).FirstOrDefault()?.Author.Name ?? "",
                b.BookAuthors.OrderBy(ba => ba.Order).FirstOrDefault()?.Author.Name ?? "",
                StringComparison.OrdinalIgnoreCase),
            "dateAdded" => a.DateAdded.CompareTo(b.DateAdded),
            "rating" => a.Rating.CompareTo(b.Rating),
            "seriesIndex" => (a.BookSeries.FirstOrDefault()?.SeriesIndex ?? double.PositiveInfinity)
                .CompareTo(b.BookSeries.FirstOrDefault()?.SeriesIndex ?? double.PositiveInfinity),
            "lastRead" => Nullable.Compare<DateTime>(
                lastReadByBookId.TryGetValue(a.Id, out var aLastRead) ? aLastRead : null,
                lastReadByBookId.TryGetValue(b.Id, out var bLastRead) ? bLastRead : null),
            _ => string.Compare(a.SortTitle, b.SortTitle, StringComparison.OrdinalIgnoreCase),
        };

    public async Task<BookListResult> ListAsync(BookQueryFilters filters, CancellationToken ct = default)
    {
        var query = db.Books
            .Include(b => b.BookAuthors).ThenInclude(ba => ba.Author)
            .Include(b => b.BookSeries).ThenInclude(bs => bs.Series)
            .Include(b => b.BookTags).ThenInclude(bt => bt.Tag)
            .Include(b => b.BookCollections).ThenInclude(bc => bc.Collection)
            .Include(b => b.Files)
            .Include(b => b.Periodical)
            .AsNoTracking()
            .AsQueryable();

        // "unknown" is a sentinel (not a real author id) matching books with no author at all - see
        // BrowseEndpoints.cs's /api/authors. A caller-supplied AuthorId that failed to decode is left
        // applied with no matching rows (-1) below rather than treated as "no filter" - a malformed/
        // stale id should yield an empty result, not silently ignore the filter (see BookEndpoints.cs).
        if (filters.AuthorIsUnknown)
        {
            query = query.Where(b => !b.BookAuthors.Any());
        }
        else if (filters.AuthorId is { } authorId)
        {
            query = query.Where(b => b.BookAuthors.Any(ba => ba.AuthorId == authorId));
        }

        if (filters.SeriesId is { } seriesId)
        {
            query = query.Where(b => b.BookSeries.Any(bs => bs.SeriesId == seriesId));
        }

        if (filters.TagId is { } tagId)
        {
            query = query.Where(b => b.BookTags.Any(bt => bt.TagId == tagId));
        }

        if (filters.CollectionId is { } collectionId)
        {
            query = query.Where(b => b.BookCollections.Any(bc => bc.CollectionId == collectionId));
        }

        // Issues are hidden from the main library view by default (a daily/weekly periodical would
        // otherwise flood it) - see periodicalSettings.ts's localStorage-backed toggle on the
        // frontend. Browsing a specific periodical always shows its own issues regardless.
        if (filters.PeriodicalId is { } periodicalId)
        {
            query = query.Where(b => b.PeriodicalId == periodicalId);
        }
        else if (!filters.IncludeIssues)
        {
            query = query.Where(b => b.PeriodicalId == null);
        }

        if (!string.IsNullOrEmpty(filters.Publisher))
        {
            query = query.Where(b => b.Publisher == filters.Publisher);
        }

        if (!string.IsNullOrEmpty(filters.Language))
        {
            query = query.Where(b => b.Language == filters.Language);
        }

        if (filters.ReadingStatus is { } readingStatus)
        {
            query = query.Where(b => b.ReadingStatus == readingStatus);
        }

        if (filters.MinRating is { } minRating)
        {
            query = query.Where(b => b.Rating >= minRating);
        }

        if (filters.Format is { } format)
        {
            query = query.Where(b => b.Files.Any(f => f.Format == format));
        }

        var books = await query.ToListAsync(ct);

        // Free-text search runs against the already-materialized list: EF Core can't translate the
        // StringComparison overload of Contains to SQL, and this dataset is small enough (v1: single
        // local library) that in-memory filtering after the SQL-side filters above is simplest.
        if (!string.IsNullOrWhiteSpace(filters.Search))
        {
            var term = filters.Search.Trim();
            books = books.Where(b =>
                b.Title.Contains(term, StringComparison.OrdinalIgnoreCase) ||
                b.BookAuthors.Any(ba => ba.Author.Name.Contains(term, StringComparison.OrdinalIgnoreCase)) ||
                b.BookSeries.Any(bs => bs.Series.Name.Contains(term, StringComparison.OrdinalIgnoreCase)) ||
                b.BookTags.Any(bt => bt.Tag.Name.Contains(term, StringComparison.OrdinalIgnoreCase))
            ).ToList();
        }

        // A second small lookup rather than an Include+join above - keeps the main query (with its
        // several optional filters) untouched, and most books never have a progress row.
        var bookIds = books.Select(b => b.Id).ToList();
        var lastReadByBookId = await db.ReadingProgress
            .Where(rp => bookIds.Contains(rp.BookId))
            .ToDictionaryAsync(rp => rp.BookId, rp => rp.UpdatedAt, ct);

        var totalCount = books.Count;

        var direction = string.Equals(filters.SortDirection, "desc", StringComparison.OrdinalIgnoreCase) ? -1 : 1;
        books.Sort((a, b) => direction * CompareBooksForSort(a, b, filters.SortKey, lastReadByBookId));

        // Pagination is opt-in via Page - a caller that omits it (LibrarySpotlight's search,
        // PeriodicalDetailView's "every issue of this periodical") gets the full sorted set.
        IReadOnlyList<Book> paged = books;
        if (filters.Page is > 0)
        {
            var effectivePageSize = filters.PageSize is > 0 ? filters.PageSize.Value : DefaultPageSize;
            paged = books.Skip((filters.Page.Value - 1) * effectivePageSize).Take(effectivePageSize).ToList();
        }

        return new BookListResult(paged, totalCount, lastReadByBookId);
    }

    public Task<Book?> GetByIdAsync(int bookId, CancellationToken ct = default) =>
        db.Books
            .Include(b => b.BookAuthors).ThenInclude(ba => ba.Author)
            .Include(b => b.BookSeries).ThenInclude(bs => bs.Series)
            .Include(b => b.BookTags).ThenInclude(bt => bt.Tag)
            .Include(b => b.BookCollections).ThenInclude(bc => bc.Collection)
            .Include(b => b.Files)
            .Include(b => b.Identifiers)
            .Include(b => b.Periodical)
            .AsNoTracking()
            .FirstOrDefaultAsync(b => b.Id == bookId, ct);

    public async Task<IReadOnlyList<ContinueReadingEntry>> ListContinueReadingAsync(
        int? limit, bool includeIssues, CancellationToken ct = default)
    {
        var query = db.Books
            .Where(b => b.ReadingStatus == ReadingStatus.Reading)
            .Include(b => b.BookAuthors).ThenInclude(ba => ba.Author)
            .Include(b => b.Files)
            .AsNoTracking()
            .AsQueryable();

        if (!includeIssues)
        {
            query = query.Where(b => b.PeriodicalId == null);
        }

        var books = await query.ToListAsync(ct);
        var bookIds = books.Select(b => b.Id).ToList();
        var progressByBookId = await db.ReadingProgress
            .Where(rp => bookIds.Contains(rp.BookId))
            .ToDictionaryAsync(rp => rp.BookId, ct);

        var candidates = books
            .OrderByDescending(book => progressByBookId.GetValueOrDefault(book.Id)?.UpdatedAt ?? book.DateAdded)
            .Take(limit is > 0 ? limit.Value : 20)
            .ToList();

        var result = new List<ContinueReadingEntry>();
        foreach (var book in candidates)
        {
            var progress = progressByBookId.GetValueOrDefault(book.Id);
            // Same "prefer Epub" rule BookDetailPanel/openReader uses on the frontend.
            var file = book.Files.FirstOrDefault(f => f.Format == BookFormat.Epub) ?? book.Files.FirstOrDefault();
            result.Add(new ContinueReadingEntry(book, file, progress?.Percentage ?? 0, progress?.UpdatedAt ?? book.DateAdded));
        }

        return result;
    }

    public async Task<IReadOnlyList<Book>> ListRecentlyAddedAsync(int? limit, bool includeIssues, CancellationToken ct = default)
    {
        var query = db.Books
            .Include(b => b.BookAuthors).ThenInclude(ba => ba.Author)
            .Include(b => b.BookSeries).ThenInclude(bs => bs.Series)
            .Include(b => b.BookTags).ThenInclude(bt => bt.Tag)
            .Include(b => b.BookCollections).ThenInclude(bc => bc.Collection)
            .Include(b => b.Files)
            .Include(b => b.Periodical)
            .AsNoTracking()
            .AsQueryable();

        if (!includeIssues)
        {
            query = query.Where(b => b.PeriodicalId == null);
        }

        return await query
            .OrderByDescending(b => b.DateAdded)
            .Take(limit is > 0 ? limit.Value : 12)
            .ToListAsync(ct);
    }

    public async Task<(int SecondsRead, double? Percentage)> GetReadingStatsAsync(int bookId, CancellationToken ct = default)
    {
        var secondsRead = await db.ReadingActivities
            .Where(ra => ra.BookId == bookId)
            .SumAsync(ra => (int?)ra.DurationSeconds, ct) ?? 0;
        var percentage = await db.ReadingProgress
            .Where(rp => rp.BookId == bookId)
            .Select(rp => (double?)rp.Percentage)
            .FirstOrDefaultAsync(ct);
        return (secondsRead, percentage);
    }
}
