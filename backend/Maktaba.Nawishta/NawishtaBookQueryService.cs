using Maktaba.Core.Entities;
using Maktaba.Core.Services;
using Microsoft.EntityFrameworkCore;

namespace Maktaba.Nawishta;

/// <summary>
/// Nawishta-backed implementation of <see cref="IBookQueryService"/> (issue #110). Search/author/
/// series filtering and paging are pushed down to Nawishta's own GET /libraries/{id}/books (it
/// supports all three server-side); Tag/Collection/Publisher/Language/ReadingStatus/MinRating/
/// Format/sort are applied client-side on top of whatever page Nawishta already returned, since
/// Nawishta's list endpoint doesn't support most of them - <b>known limitation</b>: combining one of
/// those filters with paging can under-report TotalCount/miss matches on a later page, the same
/// trade-off EfBookQueryService doesn't have to make (it can filter before paging, in SQL). ReadingStatus/
/// Rating/reading-progress always come from the local shadow table (NawishtaShadowDbContext), never
/// from Nawishta itself - see the design addendum on issue #69.
/// </summary>
public class NawishtaBookQueryService(NawishtaRawApiClient api, int remoteLibraryId, NawishtaShadowDbContext shadow) : IBookQueryService
{
    public async Task<BookListResult> ListAsync(BookQueryFilters filters, CancellationToken ct = default)
    {
        var page = filters.Page ?? 1;
        var pageSize = filters.PageSize ?? 60;
        var authorId = filters.AuthorIsUnknown ? null : filters.AuthorId;

        var result = await api.GetBooksAsync(remoteLibraryId, filters.Search, page, pageSize, authorId, filters.SeriesId, null, ct);
        var books = new List<Book>();
        var lastRead = new Dictionary<int, DateTime>();

        foreach (var view in result.Data ?? [])
        {
            if (view.Id is not { } bookId)
            {
                continue;
            }

            var state = await shadow.BookStates.FindAsync([bookId], ct);
            var book = NawishtaEntityMapper.ToBook(view, state);

            if (!MatchesClientSideFilters(book, filters, state))
            {
                continue;
            }

            books.Add(book);
            if (state?.LastReadAt is { } lastReadAt)
            {
                lastRead[bookId] = lastReadAt;
            }
        }

        return new BookListResult(books, (int)(result.TotalCount ?? books.Count), lastRead);
    }

    public async Task<Book?> GetByIdAsync(int bookId, CancellationToken ct = default)
    {
        var view = await api.GetBookByIdAsync(remoteLibraryId, bookId, ct);
        if (view is null)
        {
            return null;
        }

        var state = await shadow.BookStates.FindAsync([bookId], ct);
        return NawishtaEntityMapper.ToBook(view, state);
    }

    public async Task<IReadOnlyList<ContinueReadingEntry>> ListContinueReadingAsync(int? limit, bool includeIssues, CancellationToken ct = default)
    {
        // Periodicals/issues aren't supported for a Nawishta-backed library yet (see
        // NawishtaPeriodicalQueryService) - includeIssues is a no-op here.
        var inProgress = await shadow.BookStates
            .Where(s => s.LastReadAt != null)
            .OrderByDescending(s => s.LastReadAt)
            .Take(limit ?? 20)
            .ToListAsync(ct);

        var entries = new List<ContinueReadingEntry>();
        foreach (var state in inProgress)
        {
            var view = await api.GetBookByIdAsync(remoteLibraryId, state.RemoteBookId, ct);
            if (view is null)
            {
                continue;
            }

            var book = NawishtaEntityMapper.ToBook(view, state);
            var file = book.Files.FirstOrDefault(f => f.Format == BookFormat.Epub) ?? book.Files.FirstOrDefault();
            entries.Add(new ContinueReadingEntry(book, file, state.Percentage, state.LastReadAt ?? DateTime.UtcNow));
        }

        return entries;
    }

    public async Task<IReadOnlyList<Book>> ListRecentlyAddedAsync(int? limit, bool includeIssues, CancellationToken ct = default)
    {
        var result = await api.GetBooksAsync(remoteLibraryId, null, 1, limit ?? 12, null, null, null, ct);
        var books = new List<Book>();
        foreach (var view in result.Data ?? [])
        {
            if (view.Id is not { } bookId)
            {
                continue;
            }

            var state = await shadow.BookStates.FindAsync([bookId], ct);
            books.Add(NawishtaEntityMapper.ToBook(view, state));
        }

        return books;
    }

    public async Task<(int SecondsRead, double? Percentage)> GetReadingStatsAsync(int bookId, CancellationToken ct = default)
    {
        var state = await shadow.BookStates.FindAsync([bookId], ct);
        return (state?.SecondsRead ?? 0, state?.Percentage);
    }

    private bool MatchesClientSideFilters(Book book, BookQueryFilters filters, NawishtaBookState? state)
    {
        if (filters.TagId is { } tagId && !book.BookTags.Any(bt => bt.TagId == tagId))
        {
            return false;
        }

        if (filters.Publisher is { Length: > 0 } publisher && !string.Equals(book.Publisher, publisher, StringComparison.OrdinalIgnoreCase))
        {
            return false;
        }

        if (filters.Language is { Length: > 0 } language && !string.Equals(book.Language, language, StringComparison.OrdinalIgnoreCase))
        {
            return false;
        }

        if (filters.ReadingStatus is { } readingStatus && book.ReadingStatus != readingStatus)
        {
            return false;
        }

        if (filters.MinRating is { } minRating && book.Rating < minRating)
        {
            return false;
        }

        if (filters.Format is { } format && !book.Files.Any(f => f.Format == format))
        {
            return false;
        }

        if (filters.CollectionId is { } collectionId)
        {
            var isMember = shadow.BookCollectionLinks.Any(l => l.RemoteBookId == book.Id && l.CollectionId == collectionId);
            if (!isMember)
            {
                return false;
            }
        }

        // Periodicals aren't supported for Nawishta yet - a PeriodicalId filter can never match.
        if (filters.PeriodicalId is not null)
        {
            return false;
        }

        return true;
    }
}
