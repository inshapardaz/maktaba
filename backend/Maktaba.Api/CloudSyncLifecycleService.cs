using Maktaba.Core.Services;

namespace Maktaba.Api;

/// <summary>
/// Best-effort DB push when the host shuts down - Cloud Sync Core's "push on exit". A no-op today
/// (LocalFileSystemProvider.PushDatabaseAsync does nothing), ready for a real cloud provider to
/// plug into once one exists. Deliberately best-effort: shutdown must not hang or fail waiting on a
/// slow/unreachable remote store, and the periodic heartbeat push (a separate task) is the real
/// safety net against a push that never gets to run at all - a killed process, a crash, or (per
/// CLAUDE.md) the app.process.kill() this app's own sidecar shutdown uses, whose signal delivery
/// isn't reliably graceful on every platform.
/// </summary>
public class CloudSyncLifecycleService(IStorageProviderFactory storageFactory, ILogger<CloudSyncLifecycleService> logger)
    : IHostedService
{
    public Task StartAsync(CancellationToken cancellationToken) => Task.CompletedTask;

    public async Task StopAsync(CancellationToken cancellationToken)
    {
        try
        {
            await storageFactory.Current.PushDatabaseAsync(cancellationToken);
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "Failed to push metadata.db to the cloud provider on shutdown.");
        }
    }
}
