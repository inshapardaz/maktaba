using Maktaba.Core.Entities;

namespace Maktaba.Core.Services;

public enum PeriodicalDeleteOutcome
{
    Deleted,
    NotFound,
    HasIssues,
}

// AbsoluteFolderPath is set only for Deleted - the periodical's own folder, which already contains
// every issue's subfolder (issues physically live nested inside it). For a local library, the
// caller trashes that one path itself (RequiresLocalTrash true) to remove everything at once
// instead of the DB rows' file content lingering on disk; for a cloud-backed library
// (RequiresLocalTrash false) DeleteAsync already deleted it from the remote store (and its local
// cache mirror) before returning - see BookRemovalResult's identical split for a single book.
public record PeriodicalDeleteResult(
    PeriodicalDeleteOutcome Outcome, string? AbsoluteFolderPath = null, bool RequiresLocalTrash = false);

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

    // deleteIssues must be true to actually delete a periodical that still has issues - otherwise
    // this returns HasIssues without touching anything, so the frontend can show a confirmation
    // (with the issue count) before the caller opts back in with deleteIssues: true.
    Task<PeriodicalDeleteResult> DeleteAsync(int periodicalId, bool deleteIssues, CancellationToken ct = default);

    Task<Periodical?> SaveCoverAsync(int periodicalId, Stream content, string contentType, CancellationToken ct = default);
}
