using Maktaba.Core.Services;
using Maktaba.Core.Sync;

namespace Maktaba.Api;

/// <summary>
/// Cloud Sync Core's periodic heartbeat push (crash safety net between explicit syncs) and
/// push-on-exit, both routed through <see cref="ISyncStatusTracker"/> so the frontend can poll
/// "syncing/synced/error" the same way it already polls rescan progress. Also runs cloud library
/// locking's own, much shorter-interval heartbeat (refreshing the ".maktaba-lock" marker while this
/// library stays open here, releasing it on a clean shutdown) - see IStorageProvider's
/// Read/Write/DeleteLockAsync and LibraryLockInfo's staleness rules; LibraryService.ActivateAsync is
/// what actually enforces the lock on open/switch, this service is only what keeps an
/// already-acquired lock alive for as long as the process legitimately holds it. Skips entirely for
/// a local library (IStorageProvider.ProviderType == "local") - both PushDatabaseAsync and the
/// lock methods are no-ops there anyway, and this must never report sync activity for a library
/// that isn't syncing anywhere, per the cloud storage epic's "no new behaviour for local libraries"
/// requirement.
/// </summary>
public class CloudSyncLifecycleService(
    IStorageProviderFactory storageFactory,
    ISyncStatusTracker statusTracker,
    ILogger<CloudSyncLifecycleService> logger) : BackgroundService
{
    private static readonly TimeSpan HeartbeatInterval = TimeSpan.FromMinutes(5);

    // Must stay comfortably shorter than LibraryLockInfo.IsStale's own window (2 minutes) - see that
    // type's doc comment on why the margin matters (this refresh interval, not the DB push heartbeat
    // above, is what a live session's lock actually depends on to never go stale between ticks).
    private static readonly TimeSpan LockRefreshInterval = TimeSpan.FromSeconds(60);

    protected override async Task ExecuteAsync(CancellationToken stoppingToken) =>
        await Task.WhenAll(RunPushLoopAsync(stoppingToken), RunLockRefreshLoopAsync(stoppingToken));

    private async Task RunPushLoopAsync(CancellationToken stoppingToken)
    {
        using var timer = new PeriodicTimer(HeartbeatInterval);
        while (await timer.WaitForNextTickAsync(stoppingToken))
        {
            await PushAsync(stoppingToken);
        }
    }

    private async Task RunLockRefreshLoopAsync(CancellationToken stoppingToken)
    {
        using var timer = new PeriodicTimer(LockRefreshInterval);
        while (await timer.WaitForNextTickAsync(stoppingToken))
        {
            await RefreshLockAsync(stoppingToken);
        }
    }

    public override async Task StopAsync(CancellationToken cancellationToken)
    {
        // Best-effort: shutdown must not hang or fail waiting on a slow/unreachable remote store -
        // the heartbeat above is the real safety net against a push that never gets to run at all
        // (a killed process, a crash, or unreliable signal delivery on some platforms).
        await PushAsync(cancellationToken);
        await ReleaseLockAsync(cancellationToken);
        await base.StopAsync(cancellationToken);
    }

    private async Task PushAsync(CancellationToken ct)
    {
        var storage = storageFactory.Current;
        if (storage.ProviderType == "local")
        {
            return;
        }

        try
        {
            statusTracker.Syncing();
            await storage.PushDatabaseAsync(ct);
            statusTracker.Synced();
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "Failed to push metadata.db to the cloud provider.");
            statusTracker.Failed(ex.Message);
        }
    }

    private async Task RefreshLockAsync(CancellationToken ct)
    {
        var storage = storageFactory.Current;
        if (storage.ProviderType == "local")
        {
            return;
        }

        try
        {
            await storage.WriteLockAsync(LibraryLockInfo.ForThisDevice(), ct);
        }
        catch (Exception ex)
        {
            // Deliberately doesn't call statusTracker.Failed() the way PushAsync does - a missed
            // lock refresh isn't a sync failure the user needs to see (it'll just retry next tick),
            // and stealing the sync status icon's "error" state for this would be misleading.
            logger.LogWarning(ex, "Failed to refresh this library's cloud lock marker.");
        }
    }

    private async Task ReleaseLockAsync(CancellationToken ct)
    {
        var storage = storageFactory.Current;
        if (storage.ProviderType == "local")
        {
            return;
        }

        try
        {
            await storage.DeleteLockAsync(ct);
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "Failed to release this library's cloud lock marker on shutdown.");
        }
    }
}
