using Maktaba.Core.Services;

namespace Maktaba.Data.Services;

/// <summary>
/// Plain in-memory implementation of <see cref="IRescanProgressTracker"/> - registered as a
/// singleton (see Program.cs), so it outlives the per-request scoped services (like
/// MaktabaDbContext) that the rescan itself uses.
/// </summary>
public sealed class RescanProgressTracker : IRescanProgressTracker
{
    private readonly object gate = new();
    private RescanProgressSnapshot snapshot = RescanProgressSnapshot.Idle;

    public RescanProgressSnapshot Snapshot
    {
        get
        {
            lock (gate)
            {
                return snapshot;
            }
        }
    }

    public void Start(int total)
    {
        lock (gate)
        {
            snapshot = new RescanProgressSnapshot(true, 0, total, null);
        }
    }

    public void Report(int processed, string? currentBook)
    {
        lock (gate)
        {
            snapshot = snapshot with { Processed = processed, CurrentBook = currentBook };
        }
    }

    public void Complete()
    {
        lock (gate)
        {
            snapshot = snapshot with { IsRunning = false, CurrentBook = null };
        }
    }
}
