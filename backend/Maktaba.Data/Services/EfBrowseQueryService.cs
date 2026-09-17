using Maktaba.Core.Entities;
using Maktaba.Core.Services;
using Microsoft.EntityFrameworkCore;

namespace Maktaba.Data.Services;

/// <summary>
/// EF/SQLite implementation of <see cref="IBrowseQueryService"/> - a literal move of
/// BrowseEndpoints.cs's previously-inline queries, not a rewrite.
/// </summary>
public class EfBrowseQueryService(MaktabaDbContext db) : IBrowseQueryService
{
    public async Task<IReadOnlyList<EntityGroupCount>> ListAuthorsAsync(CancellationToken ct = default)
    {
        // IdCodec.Encode can't be translated to SQL, so the raw int id is projected here and
        // encoded afterwards, by the endpoint (an Api-layer concern - see IBookQueryService's doc
        // comment for the same reasoning applied to id-decoding on the way in).
        var authors = await db.Authors
            .Where(a => a.BookAuthors.Count > 0)
            .OrderBy(a => a.Name)
            // Explicit null (not the default) - EF Core can't translate a constructor call that
            // relies on an optional-argument default inside an expression tree (CS0854).
            .Select(a => new EntityGroupCount(a.Id, a.Name, a.BookAuthors.Count, null))
            .ToListAsync(ct);
        return authors;
    }

    public Task<int> CountBooksWithoutAuthorAsync(CancellationToken ct = default) =>
        db.Books.CountAsync(b => !b.BookAuthors.Any(), ct);

    public async Task<IReadOnlyList<EntityGroupCount>> ListSeriesAsync(CancellationToken ct = default) =>
        await db.Series
            .Where(s => s.BookSeries.Count > 0)
            .OrderBy(s => s.Name)
            .Select(s => new EntityGroupCount(s.Id, s.Name, s.BookSeries.Count, null))
            .ToListAsync(ct);

    public async Task<IReadOnlyList<EntityGroupCount>> ListTagsAsync(CancellationToken ct = default) =>
        await db.Tags
            .Where(t => t.BookTags.Count > 0)
            .OrderBy(t => t.Name)
            .Select(t => new EntityGroupCount(t.Id, t.Name, t.BookTags.Count, null))
            .ToListAsync(ct);

    public async Task<IReadOnlyList<string>> ListPublishersAsync(CancellationToken ct = default) =>
        await db.Books
            .Where(b => b.Publisher != null && b.Publisher != "")
            .Select(b => b.Publisher!)
            .Distinct()
            .OrderBy(p => p)
            .ToListAsync(ct);

    public async Task<IReadOnlyList<NamedGroupCount>> ListPublishersGroupedAsync(CancellationToken ct = default)
    {
        // EF Core can't translate a GroupBy().Select(g => new NamedGroupCount(...)) projecting
        // straight into a record constructor here - project to an anonymous type (which does
        // translate) and map to the record client-side instead.
        var groups = await db.Books
            .Where(b => b.Publisher != null && b.Publisher != "")
            .GroupBy(b => b.Publisher!)
            .Select(g => new { Name = g.Key, Count = g.Count() })
            .OrderBy(p => p.Name)
            .ToListAsync(ct);
        return groups.Select(g => new NamedGroupCount(g.Name, g.Count)).ToList();
    }

    public async Task<IReadOnlyList<NamedGroupCount>> ListLanguagesGroupedAsync(CancellationToken ct = default)
    {
        var groups = await db.Books
            .Where(b => b.Language != null && b.Language != "")
            .GroupBy(b => b.Language!)
            .Select(g => new { Name = g.Key, Count = g.Count() })
            .OrderBy(l => l.Name)
            .ToListAsync(ct);
        return groups.Select(g => new NamedGroupCount(g.Name, g.Count)).ToList();
    }

    public async Task<IReadOnlyDictionary<ReadingStatus, int>> GetReadingStatusCountsAsync(CancellationToken ct = default)
    {
        var counts = await db.Books
            .GroupBy(b => b.ReadingStatus)
            .Select(g => new { Status = g.Key, Count = g.Count() })
            .ToListAsync(ct);
        return counts.ToDictionary(c => c.Status, c => c.Count);
    }
}
