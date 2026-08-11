namespace Maktaba.Core.Services;

/// <summary>Point-in-time snapshot of an in-progress (or just-finished) library rescan.</summary>
public sealed record RescanProgressSnapshot(bool IsRunning, int Processed, int Total, string? CurrentBook)
{
    public static readonly RescanProgressSnapshot Idle = new(false, 0, 0, null);
}

/// <summary>
/// Process-wide (singleton) holder for the current rescan's progress, so a separate polling request
/// (GET /api/libraries/rescan/progress) can observe it while the rescan's own POST request is still
/// in flight on another thread. Deliberately not persisted anywhere - it only describes "right now."
/// </summary>
public interface IRescanProgressTracker
{
    RescanProgressSnapshot Snapshot { get; }

    void Start(int total);

    void Report(int processed, string? currentBook);

    void Complete();
}
