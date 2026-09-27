namespace Maktaba.Core.Services;

/// <summary>Point-in-time snapshot of an in-progress (or just-finished) PDF-to-page-images
/// conversion (epic #162, Phase 1) - mirrors RescanProgressSnapshot's own shape/purpose exactly,
/// scoped to whichever book is currently being converted.</summary>
public sealed record ConversionProgressSnapshot(bool IsRunning, int Processed, int Total, string? BookId, string? Error)
{
    public static readonly ConversionProgressSnapshot Idle = new(false, 0, 0, null, null);
}

/// <summary>
/// Process-wide (singleton) holder for the current PDF-to-page-images conversion's progress, so a
/// separate polling request can observe it while the conversion's own POST request has already
/// returned (the conversion itself runs on a detached background task, same shape as
/// ILibraryMigrationService) - mirrors IRescanProgressTracker's own role for library rescans.
/// </summary>
public interface IConversionProgressTracker
{
    ConversionProgressSnapshot Snapshot { get; }

    void Start(string bookId, int total);

    void Report(int processed);

    void Fail(string error);

    void Complete();
}
