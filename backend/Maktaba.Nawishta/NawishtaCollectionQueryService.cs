using Maktaba.Core.Services;
using Microsoft.EntityFrameworkCore;

namespace Maktaba.Nawishta;

/// <summary>
/// Nawishta-backed implementation of <see cref="ICollectionQueryService"/> (issue #110/#112).
/// Entirely shadow-table-backed, never Nawishta's own "categories" - the design addendum on issue
/// #69 explicitly scopes Collections as Maktaba-local, user-managed state Nawishta has no equivalent
/// concept for (unlike categories, which are more of a public taxonomy on Nawishta's side).
/// </summary>
public class NawishtaCollectionQueryService(NawishtaShadowDbContext shadow) : ICollectionQueryService
{
    public async Task<IReadOnlyList<EntityGroupCount>> ListAsync(CancellationToken ct = default)
    {
        var collections = await shadow.Collections.ToListAsync(ct);
        var counts = await shadow.BookCollectionLinks
            .GroupBy(l => l.CollectionId)
            .Select(g => new { CollectionId = g.Key, Count = g.Count() })
            .ToListAsync(ct);
        var countById = counts.ToDictionary(c => c.CollectionId, c => c.Count);

        return collections
            .Select(c => new EntityGroupCount(c.Id, c.Name, countById.GetValueOrDefault(c.Id)))
            .OrderBy(g => g.Name, StringComparer.OrdinalIgnoreCase)
            .ToList();
    }
}
