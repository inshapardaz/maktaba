using Maktaba.Core.Entities;
using Maktaba.Core.Services;
using Microsoft.EntityFrameworkCore;

namespace Maktaba.Nawishta;

/// <summary>
/// Nawishta-backed implementation of <see cref="IBrowseQueryService"/> (issue #110). Authors/Series
/// come straight from Nawishta's own GET /authors and /series (already return a bookCount per
/// entry, so no separate aggregation is needed). Tags have <b>no dedicated list endpoint on
/// Nawishta</b> - they only ever appear embedded per-book - so ListTagsAsync fetches one page of
/// books (up to 500) and aggregates tag counts from that; a library with more books than that will
/// under-count. Publishers/languages/reading-status counts have no Nawishta-side aggregation either
/// and use the same page-and-aggregate approach. <b>Known limitation</b>, flagged rather than hidden:
/// none of these are cheap or exact the way EfBrowseQueryService's SQL GROUP BY is - acceptable for
/// now given Nawishta libraries are expected to be modest in size, revisit if that's not true in
/// practice.
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
        var books = await FetchBooksForAggregationAsync(ct);
        return books
            .SelectMany(b => b.Tags ?? [])
            .Where(t => t.Id is not null)
            .GroupBy(t => (Id: t.Id!.Value, t.Name))
            .Select(g => new EntityGroupCount(g.Key.Id, g.Key.Name ?? "", g.Count()))
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
