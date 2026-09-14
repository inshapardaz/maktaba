using Maktaba.Core.Services;
using Microsoft.EntityFrameworkCore;

namespace Maktaba.Data.Services;

/// <summary>EF/SQLite implementation of <see cref="ICollectionQueryService"/> - a literal move of
/// CollectionEndpoints.cs's previously-inline list query.</summary>
public class EfCollectionQueryService(MaktabaDbContext db) : ICollectionQueryService
{
    public async Task<IReadOnlyList<EntityGroupCount>> ListAsync(CancellationToken ct = default) =>
        await db.Collections
            .OrderBy(c => c.Name)
            .Select(c => new EntityGroupCount(c.Id, c.Name, c.BookCollections.Count))
            .ToListAsync(ct);
}
