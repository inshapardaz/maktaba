using Maktaba.Core.Entities;
using Maktaba.Core.Services;
using Maktaba.Nawishta.Generated;
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
///
/// Covers are eagerly cached here, not lazily on first request like content (NawishtaStorageProvider).
/// Every caller of "does this book have a cover" (BookEndpoints.cs's GET ""/{id}/{id}/recently-added/
/// continue-reading) uses CoverLocator.Find - a synchronous, disk-only check with no way to trigger a
/// download itself. Without pre-caching here, HasCover would stay false forever (nothing would ever
/// populate the cache), so the frontend would never even attempt to load the image - the actual
/// symptom reported (book covers never shown). EnsureCoverCachedAsync costs one extra download per
/// book that has a cover and isn't already cached, bounded by whatever page size/limit the caller
/// already asked for.
/// </summary>
public class NawishtaBookQueryService(
    NawishtaRawApiClient api, int remoteLibraryId, NawishtaShadowDbContext shadow,
    ICloudCacheManager cacheManager, string libraryId) : IBookQueryService
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

            await EnsureCoverCachedAsync(view, ct);
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
        await EnsureCoverCachedAsync(view, ct);
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

            await EnsureCoverCachedAsync(view, ct);
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
            await EnsureCoverCachedAsync(view, ct);
            books.Add(NawishtaEntityMapper.ToBook(view, state));
        }

        return books;
    }

    // Best-effort - a failed cover fetch (network blip, Nawishta's own file-serving bug - see
    // issue inshapardaz/api#50) degrades to "no cover shown" for this one book, not a failed
    // request for the whole list.
    private async Task EnsureCoverCachedAsync(BookView view, CancellationToken ct)
    {
        if (view.Id is not { } bookId || view.Links?.Any(l => l.Rel == "image") != true)
        {
            return;
        }

        if (cacheManager.Exists(libraryId, $"{bookId}/cover.jpg"))
        {
            return;
        }

        await DownloadAndCacheCoverAsync(bookId, ct);
    }

    private async Task DownloadAndCacheCoverAsync(int bookId, CancellationToken ct)
    {
        try
        {
            var cover = await api.DownloadBookCoverAsync(remoteLibraryId, bookId, ct);
            if (cover is null)
            {
                return;
            }

            using var stream = new MemoryStream(cover.Value.Bytes);
            await cacheManager.WriteAsync(libraryId, $"{bookId}/cover.jpg", stream, ct);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            // Swallowed on purpose - see EnsureCoverCachedAsync/RefreshCoversAsync's own doc
            // comments for why a failed fetch degrades rather than propagating.
        }
    }

    /// <summary>Issue #115's "Sync now" for a Nawishta library - re-downloads every book's cover
    /// unconditionally, unlike EnsureCoverCachedAsync above (which only fills in a *missing* one).
    /// A cover changed on the Nawishta server after this device already cached the old one would
    /// otherwise never be noticed: WriteAsync overwrites happily, but nothing re-triggers it, since
    /// cacheManager.Exists is a presence-only check that can't tell "stale" from "still fine".
    /// CoverLocator.GetVersion (BookEndpoints.cs) reads the cached file's own last-write time, so
    /// overwriting it here is what actually busts the frontend's cache-aware &lt;img&gt; src - no
    /// separate "cover version" bookkeeping needed. Walks every page rather than assuming the whole
    /// library fits in one call, same as GetAuthorsAsync's own ?pageSize convention elsewhere.</summary>
    public async Task RefreshCoversAsync(CancellationToken ct = default)
    {
        const int pageSize = 100;
        var page = 1;
        while (true)
        {
            var result = await api.GetBooksAsync(remoteLibraryId, null, page, pageSize, null, null, null, ct);
            var books = result.Data ?? [];
            if (books.Count == 0)
            {
                break;
            }

            foreach (var view in books)
            {
                if (view.Id is { } bookId && view.Links?.Any(l => l.Rel == "image") == true)
                {
                    await DownloadAndCacheCoverAsync(bookId, ct);
                }
            }

            if (books.Count < pageSize)
            {
                break;
            }

            page++;
        }
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
