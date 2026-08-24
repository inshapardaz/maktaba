using Maktaba.Core.Entities;

namespace Maktaba.Core.Services;

public enum PeriodicalDeleteOutcome
{
    Deleted,
    NotFound,
    HasIssues,
}

public interface IPeriodicalService
{
    Task<Periodical> CreateAsync(string name, PeriodicalFrequency frequency, string? description, CancellationToken ct = default);

    Task<Periodical?> UpdateAsync(
        int periodicalId, string name, PeriodicalFrequency frequency, string? description, CancellationToken ct = default);

    Task<PeriodicalDeleteOutcome> DeleteAsync(int periodicalId, CancellationToken ct = default);

    Task<Periodical?> SaveCoverAsync(int periodicalId, Stream content, string contentType, CancellationToken ct = default);
}
