using Maktaba.Core.Entities;
using Maktaba.Core.Services;

namespace Maktaba.Nawishta;

/// <summary>
/// Nawishta actually has its own native Periodical/Issue/Article hierarchy (Periodical/Issue/
/// IssueArticle/IssuePage in the generated client), but it's structured very differently from
/// Maktaba's own "an Issue is just a Book with PeriodicalId set" model (see Book.cs's doc comment) -
/// mapping between the two needs its own design pass, not a corner of this PR. Periodicals are
/// unsupported for a Nawishta-backed library for now: always an empty list, never an error, so the
/// rest of the app (which already treats "a library has no periodicals" as a normal, common state -
/// PeriodicalsEnabled can be turned off for any library) degrades gracefully rather than breaking.
/// </summary>
public class NawishtaPeriodicalQueryService : IPeriodicalQueryService
{
    public Task<IReadOnlyList<Periodical>> ListAsync(CancellationToken ct = default) =>
        Task.FromResult<IReadOnlyList<Periodical>>([]);

    public Task<Periodical?> GetByIdAsync(int periodicalId, CancellationToken ct = default) =>
        Task.FromResult<Periodical?>(null);
}
