namespace Maktaba.Core.Services;

public enum SyncState { Idle, Syncing, Error }

/// <summary>Point-in-time snapshot of the current library's cloud DB sync state.</summary>
public sealed record SyncStatusSnapshot(SyncState State, DateTimeOffset? LastSyncedAtUtc, string? ErrorMessage)
{
    public static readonly SyncStatusSnapshot Idle = new(SyncState.Idle, null, null);
}

/// <summary>
/// Process-wide (singleton) holder for the current library's cloud-sync status, polled by the
/// frontend the same way rescan progress is polled today via IRescanProgressTracker. Only ever
/// reports non-Idle for a cloud-backed library - nothing calls into this for a local one, since
/// LocalFileSystemProvider's Pull/PushDatabaseAsync are no-ops and there's nothing to report.
/// </summary>
public interface ISyncStatusTracker
{
    SyncStatusSnapshot Snapshot { get; }

    void Syncing();

    void Synced();

    void Failed(string message);
}
