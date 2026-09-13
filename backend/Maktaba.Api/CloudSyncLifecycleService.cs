using Maktaba.Core.Services;

namespace Maktaba.Api;

/// <summary>
/// Cloud Sync Core's periodic heartbeat push (crash safety net between explicit syncs) and
/// push-on-exit, both routed through <see cref="ISyncStatusTracker"/> so the frontend can poll
/// "syncing/synced/error" the same way it already polls rescan progress. Skips entirely for a
/// local library (IStorageProvider.ProviderType == "local") - PushDatabaseAsync is a no-op there
/// anyway, and this must never report sync activity for a library that isn't syncing anywhere,
/// per the cloud storage epic's "no new behaviour for local libraries" requirement.
/// </summary>
public class CloudSyncLifecycleService(
    IStorageProviderFactory storageFactory,
    ISyncStatusTracker statusTracker,
    ILogger<CloudSyncLifecycleService> logger) : BackgroundService
{
    private static readonly TimeSpan HeartbeatInterval = TimeSpan.FromMinutes(5);

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        using var timer = new PeriodicTimer(HeartbeatInterval);
        while (await timer.WaitForNextTickAsync(stoppingToken))
        {
            await PushAsync(stoppingToken);
        }
    }

    public override async Task StopAsync(CancellationToken cancellationToken)
    {
        // Best-effort: shutdown must not hang or fail waiting on a slow/unreachable remote store -
        // the heartbeat above is the real safety net against a push that never gets to run at all
        // (a killed process, a crash, or unreliable signal delivery on some platforms).
        await PushAsync(cancellationToken);
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
}
