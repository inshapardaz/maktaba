using Maktaba.Core.Services;
using Microsoft.EntityFrameworkCore;

namespace Maktaba.Nawishta;

/// <summary>
/// Nawishta-backed implementation of <see cref="ICollectionQueryService"/> (issue #110/#112,
/// redesigned for #140). A collection's existence, name, and book count now come straight from
/// Nawishta's own real Bookshelves API (GET .../bookshelves) rather than a local shadow table - only
/// nesting (parent/child, which Nawishta has no concept of at all) still reads from the shadow db.
/// Any real bookshelf with no corresponding shadow row (created directly on Nawishta, or on a
/// different device/client) simply reads as top-level, the same default a missing row already means.
/// </summary>
public class NawishtaCollectionQueryService(NawishtaRawApiClient api, int remoteLibraryId, NawishtaShadowDbContext shadow) : ICollectionQueryService
{
    public async Task<IReadOnlyList<EntityGroupCount>> ListAsync(CancellationToken ct = default)
    {
        var shelves = await api.GetBookShelvesAsync(remoteLibraryId, ct);
        var parentById = await shadow.Collections.ToDictionaryAsync(c => c.Id, c => c.ParentCollectionId, ct);

        return shelves
            .Where(s => s.Id.HasValue)
            .Select(s => new EntityGroupCount(s.Id!.Value, s.Name, s.BookCount ?? 0, parentById.GetValueOrDefault(s.Id!.Value)))
            .OrderBy(g => g.Name, StringComparer.OrdinalIgnoreCase)
            .ToList();
    }
}
