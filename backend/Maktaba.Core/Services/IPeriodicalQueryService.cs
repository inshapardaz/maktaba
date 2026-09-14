using Maktaba.Core.Entities;

namespace Maktaba.Core.Services;

/// <summary>
/// Nawishta epic, Phase A - extracted from PeriodicalEndpoints.cs's previously-inline EF list/get
/// queries (its writes already went through <see cref="IPeriodicalService"/>, which this doesn't
/// replace). Cover lookups and DTO construction stay in the endpoint layer, same reasoning as
/// <see cref="IBookQueryService"/>'s own doc comment.
/// </summary>
public interface IPeriodicalQueryService
{
    Task<IReadOnlyList<Periodical>> ListAsync(CancellationToken ct = default);

    Task<Periodical?> GetByIdAsync(int periodicalId, CancellationToken ct = default);
}
