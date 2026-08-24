using Maktaba.Core.Entities;

namespace Maktaba.Core.Services;

public enum PeriodicalDeleteOutcome
{
    Deleted,
    NotFound,
    HasIssues,
}

public record PeriodicalEditRequest(
    string Name,
    PeriodicalFrequency Frequency,
    string? Description,
    string? Language,
    string? Publisher,
    string? Editor,
    IReadOnlyList<string> Tags
);

public interface IPeriodicalService
{
    Task<Periodical> CreateAsync(PeriodicalEditRequest request, CancellationToken ct = default);

    Task<Periodical?> UpdateAsync(int periodicalId, PeriodicalEditRequest request, CancellationToken ct = default);

    Task<PeriodicalDeleteOutcome> DeleteAsync(int periodicalId, CancellationToken ct = default);

    Task<Periodical?> SaveCoverAsync(int periodicalId, Stream content, string contentType, CancellationToken ct = default);
}
