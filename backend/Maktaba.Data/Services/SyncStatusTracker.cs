using Maktaba.Core.Services;

namespace Maktaba.Data.Services;

/// <summary>Plain in-memory implementation of <see cref="ISyncStatusTracker"/> - same shape as
/// RescanProgressTracker, registered as a singleton (see Program.cs).</summary>
public sealed class SyncStatusTracker : ISyncStatusTracker
{
    private readonly object gate = new();
    private SyncStatusSnapshot snapshot = SyncStatusSnapshot.Idle;

    public SyncStatusSnapshot Snapshot
    {
        get
        {
            lock (gate)
            {
                return snapshot;
            }
        }
    }

    public void Syncing()
    {
        lock (gate)
        {
            snapshot = snapshot with { State = SyncState.Syncing, ErrorMessage = null };
        }
    }

    public void Synced()
    {
        lock (gate)
        {
            snapshot = new SyncStatusSnapshot(SyncState.Idle, DateTimeOffset.UtcNow, null);
        }
    }

    public void Failed(string message)
    {
        lock (gate)
        {
            snapshot = snapshot with { State = SyncState.Error, ErrorMessage = message };
        }
    }
}
