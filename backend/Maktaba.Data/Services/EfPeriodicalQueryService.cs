using Maktaba.Core.Entities;
using Maktaba.Core.Services;
using Microsoft.EntityFrameworkCore;

namespace Maktaba.Data.Services;

/// <summary>EF/SQLite implementation of <see cref="IPeriodicalQueryService"/> - a literal move of
/// PeriodicalEndpoints.cs's previously-inline list/get queries. Returns the Periodical entity
/// itself (Issues/PeriodicalTags eager-loaded) rather than the endpoint's old anonymous-type
/// projection - functionally identical (Issues.Count on a loaded collection gives the same number
/// the old p.Issues.Count SQL-side projection did), and matches the "return domain entities" shape
/// <see cref="IBookQueryService"/> and <see cref="IPeriodicalQueryService"/> both use.</summary>
public class EfPeriodicalQueryService(MaktabaDbContext db) : IPeriodicalQueryService
{
    public async Task<IReadOnlyList<Periodical>> ListAsync(CancellationToken ct = default) =>
        await db.Periodicals
            .Include(p => p.Issues)
            .Include(p => p.PeriodicalTags).ThenInclude(pt => pt.Tag)
            .AsNoTracking()
            .OrderBy(p => p.SortName)
            .ToListAsync(ct);

    public Task<Periodical?> GetByIdAsync(int periodicalId, CancellationToken ct = default) =>
        db.Periodicals
            .Include(p => p.Issues)
            .Include(p => p.PeriodicalTags).ThenInclude(pt => pt.Tag)
            .AsNoTracking()
            .FirstOrDefaultAsync(p => p.Id == periodicalId, ct);
}
