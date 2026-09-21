using Maktaba.Core.Entities;
using Maktaba.Core.Services;
using Microsoft.EntityFrameworkCore;

namespace Maktaba.Nawishta;

/// <summary>
/// Nawishta-backed implementation of <see cref="IBrowseQueryService"/> (issue #110). Authors/Series
/// come straight from Nawishta's own GET /authors and /series (already return a bookCount per
/// entry, so no separate aggregation is needed). ListTagsAsync is backed by Nawishta's own
/// GET /libraries/{id}/categories (via <see cref="NawishtaRawApiClient.GetCategoriesAsync"/>), same
/// as authors/series - <b>not</b> BookView's own "tags" field, which Nawishta's API never actually
/// populates (confirmed live: empty on every book, both from the list endpoint and the single-book
/// detail endpoint) despite the schema declaring it - Category is the taxonomy concept Nawishta
/// actually maintains real data for (its own reference editor and CategoryClient's full CRUD
/// support back this up), so <see cref="NawishtaEntityMapper.ToBook"/> maps a book's
/// <c>BookTags</c> from <c>view.Categories</c> to match. Publishers/languages/reading-status counts
/// still have no Nawishta-side aggregation and use a page-and-aggregate approach over one page of
/// books (up to 500) - a library with more books than that will under-count for those three.
/// <b>Known limitation</b>, flagged rather than hidden: none of these three are cheap or exact the
/// way EfBrowseQueryService's SQL GROUP BY is - acceptable for now given Nawishta libraries are
/// expected to be modest in size, revisit if that's not true in practice.
/// </summary>
public class NawishtaBrowseQueryService(NawishtaRawApiClient api, int remoteLibraryId, NawishtaShadowDbContext shadow) : IBrowseQueryService
{
    // Nawishta's own hard/soft page-size cap is unknown - 500 is a conservative single-request
    // upper bound for the page-and-aggregate approach the doc comment above describes.
    private const int AggregationPageSize = 500;

    public async Task<IReadOnlyList<EntityGroupCount>> ListAuthorsAsync(CancellationToken ct = default)
    {
        var page = await api.GetAuthorsAsync(remoteLibraryId, ct);
        return (page.Data ?? [])
            .Where(a => a.Id is not null && (a.BookCount ?? 0) > 0)
            .Select(a => new EntityGroupCount(a.Id!.Value, a.Name ?? "", a.BookCount ?? 0))
            .OrderBy(g => g.Name, StringComparer.OrdinalIgnoreCase)
            .ToList();
    }

    // Nawishta always attaches at least one author to a book on its own side (unlike Maktaba's
    // local import, which falls back to "Unknown Author" only for the on-disk folder name - see
    // BrowseEndpoints.cs's own doc comment on this sentinel) - always 0 for a Nawishta library.
    public Task<int> CountBooksWithoutAuthorAsync(CancellationToken ct = default) => Task.FromResult(0);

    public async Task<IReadOnlyList<EntityGroupCount>> ListSeriesAsync(CancellationToken ct = default)
    {
        var page = await api.GetSeriesAsync(remoteLibraryId, ct);
        return (page.Data ?? [])
            .Where(s => s.Id is not null && (s.BookCount ?? 0) > 0)
            .Select(s => new EntityGroupCount(s.Id!.Value, s.Name ?? "", s.BookCount ?? 0))
            .OrderBy(g => g.Name, StringComparer.OrdinalIgnoreCase)
            .ToList();
    }

    public async Task<IReadOnlyList<EntityGroupCount>> ListTagsAsync(CancellationToken ct = default)
    {
        var page = await api.GetCategoriesAsync(remoteLibraryId, ct);
        return (page.Data ?? [])
            .Where(c => c.Id is not null && (c.BookCount ?? 0) > 0)
            .Select(c => new EntityGroupCount(c.Id!.Value, c.Name ?? "", c.BookCount ?? 0))
            .OrderBy(g => g.Name, StringComparer.OrdinalIgnoreCase)
            .ToList();
    }

    public async Task<IReadOnlyList<string>> ListPublishersAsync(CancellationToken ct = default)
    {
        var books = await FetchBooksForAggregationAsync(ct);
        return books
            .Select(b => b.Publisher)
            .Where(p => !string.IsNullOrEmpty(p))
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .OrderBy(p => p, StringComparer.OrdinalIgnoreCase)
            .ToList()!;
    }

    public async Task<IReadOnlyList<NamedGroupCount>> ListPublishersGroupedAsync(CancellationToken ct = default)
    {
        var books = await FetchBooksForAggregationAsync(ct);
        return books
            .Where(b => !string.IsNullOrEmpty(b.Publisher))
            .GroupBy(b => b.Publisher!, StringComparer.OrdinalIgnoreCase)
            .Select(g => new NamedGroupCount(g.Key, g.Count()))
            .OrderBy(g => g.Name, StringComparer.OrdinalIgnoreCase)
            .ToList();
    }

    public async Task<IReadOnlyList<NamedGroupCount>> ListLanguagesGroupedAsync(CancellationToken ct = default)
    {
        var books = await FetchBooksForAggregationAsync(ct);
        return books
            .Where(b => !string.IsNullOrEmpty(b.Language))
            .GroupBy(b => b.Language!, StringComparer.OrdinalIgnoreCase)
            .Select(g => new NamedGroupCount(g.Key, g.Count()))
            .OrderBy(g => g.Name, StringComparer.OrdinalIgnoreCase)
            .ToList();
    }

    public async Task<IReadOnlyDictionary<ReadingStatus, int>> GetReadingStatusCountsAsync(CancellationToken ct = default)
    {
        // ReadingStatus is shadow-table-only (see NawishtaBookQueryService's doc comment) - counting
        // straight from the shadow table is exact, unlike the aggregations above.
        var states = await shadow.BookStates.ToListAsync(ct);
        return states.GroupBy(s => s.ReadingStatus).ToDictionary(g => g.Key, g => g.Count());
    }

    private async Task<List<Generated.BookView>> FetchBooksForAggregationAsync(CancellationToken ct)
    {
        var page = await api.GetBooksAsync(remoteLibraryId, null, 1, AggregationPageSize, null, null, null, ct);
        return page.Data ?? [];
    }
}
