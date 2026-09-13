using Maktaba.Core.Services;
using Microsoft.Extensions.Logging;

namespace Maktaba.Data.Services;

/// <inheritdoc cref="ILibraryMigrationService"/>
public class LibraryMigrationService(
    IStorageProviderFactory storageFactory, ILibraryService libraryService, ILogger<LibraryMigrationService> logger)
    : ILibraryMigrationService
{
    // Never treated as migratable "book content" - metadata.db itself is migrated separately via
    // Pull/PushDatabaseAsync (so it always goes through a provider's own "this is the database"
    // handling rather than being copied as an opaque blob), and a lock marker isn't book content at
    // all (Cloud: Phase 6).
    private static readonly HashSet<string> ExcludedFileNames =
        new(StringComparer.OrdinalIgnoreCase) { "metadata.db", "metadata.db-wal", "metadata.db-shm", ".maktaba-lock" };

    private readonly object _gate = new();
    private MigrationProgressSnapshot _snapshot = MigrationProgressSnapshot.Idle;
    private CancellationTokenSource? _cts;
    private IStorageProvider? _verifiedTarget;
    private MigrationTarget? _verifiedTargetInfo;

    public MigrationProgressSnapshot Snapshot
    {
        get
        {
            lock (_gate)
            {
                return _snapshot;
            }
        }
    }

    public void Start(MigrationTarget target)
    {
        if (libraryService.CurrentLibraryId is null)
        {
            throw new InvalidOperationException("No library is open.");
        }

        CancellationTokenSource cts;
        lock (_gate)
        {
            if (_snapshot.State is MigrationState.Copying or MigrationState.VerifyingCopy)
            {
                throw new InvalidOperationException("A migration is already in progress.");
            }

            _snapshot = new MigrationProgressSnapshot(MigrationState.Copying, 0, 0, null, null);
            _verifiedTarget = null;
            _verifiedTargetInfo = null;
            cts = new CancellationTokenSource();
            _cts = cts;
        }

        _ = Task.Run(() => RunAsync(target, cts.Token));
    }

    public void Cancel()
    {
        lock (_gate)
        {
            _cts?.Cancel();
        }
    }

    public async Task<bool> CompleteAsync(bool deleteSource, CancellationToken ct = default)
    {
        IStorageProvider target;
        MigrationTarget targetInfo;
        lock (_gate)
        {
            if (_snapshot.State != MigrationState.Verified || _verifiedTarget is null || _verifiedTargetInfo is null)
            {
                return false;
            }

            target = _verifiedTarget;
            targetInfo = _verifiedTargetInfo;
        }

        var libraryId = libraryService.CurrentLibraryId
            ?? throw new InvalidOperationException("No library is open.");
        var sourceEntry = libraryService.Libraries.First(l => l.Id == libraryId);
        var sourceWasLocal = sourceEntry.ProviderType == "local";
        var sourcePath = sourceEntry.Path;

        await libraryService.SwitchProviderAsync(libraryId, targetInfo.ProviderType, targetInfo.ProviderConfig, targetInfo.Credential, ct);

        if (deleteSource && sourceWasLocal && Directory.Exists(sourcePath))
        {
            try
            {
                Directory.Delete(sourcePath, recursive: true);
            }
            catch (Exception ex)
            {
                // The migration itself already succeeded and the registry already points at the new
                // provider by this point - failing to clean up the old local folder (permissions, a
                // file still open in another program, ...) shouldn't be reported as the migration
                // having failed. The user still has the old folder sitting there, which is at worst
                // a bit of wasted disk space, not a data-loss risk.
                logger.LogWarning(ex, "Could not delete the original local library folder {Path} after migration.", sourcePath);
            }
        }

        lock (_gate)
        {
            _snapshot = MigrationProgressSnapshot.Idle;
            _verifiedTarget = null;
            _verifiedTargetInfo = null;
        }

        return true;
    }

    private async Task RunAsync(MigrationTarget targetInfo, CancellationToken ct)
    {
        try
        {
            var source = storageFactory.Current;
            var libraryId = libraryService.CurrentLibraryId!;
            var target = storageFactory.CreateForProvider(libraryId, targetInfo.ProviderType, targetInfo.ProviderConfig, targetInfo.Credential);

            var files = await EnumerateAllFilesAsync(source, ct);
            Report(MigrationState.Copying, 0, files.Count, null);

            for (var i = 0; i < files.Count; i++)
            {
                ct.ThrowIfCancellationRequested();
                var relativePath = files[i];
                await CopyFileIfNeededAsync(source, target, relativePath, ct);
                Report(MigrationState.Copying, i + 1, files.Count, relativePath);
            }

            Report(MigrationState.Copying, files.Count, files.Count, "metadata.db");
            await MigrateDatabaseAsync(source, target, ct);

            Report(MigrationState.VerifyingCopy, files.Count, files.Count, null);
            var targetFiles = await EnumerateAllFilesAsync(target, ct);
            if (targetFiles.Count < files.Count)
            {
                throw new InvalidOperationException(
                    $"Verification failed: the source has {files.Count} file(s) but the target only has {targetFiles.Count}.");
            }

            lock (_gate)
            {
                _snapshot = new MigrationProgressSnapshot(MigrationState.Verified, files.Count, files.Count, null, null);
                _verifiedTarget = target;
                _verifiedTargetInfo = targetInfo;
            }
        }
        catch (OperationCanceledException)
        {
            lock (_gate)
            {
                _snapshot = _snapshot with { State = MigrationState.Cancelled };
            }
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "Library migration failed.");
            lock (_gate)
            {
                _snapshot = _snapshot with { State = MigrationState.Failed, ErrorMessage = ex.Message };
            }
        }
    }

    private static async Task MigrateDatabaseAsync(IStorageProvider source, IStorageProvider target, CancellationToken ct)
    {
        var sourceDbPath = await source.PullDatabaseAsync(ct);
        var targetDbPath = await target.PullDatabaseAsync(ct);

        if (!PathsEqual(sourceDbPath, targetDbPath))
        {
            Directory.CreateDirectory(Path.GetDirectoryName(targetDbPath)!);
            File.Copy(sourceDbPath, targetDbPath, overwrite: true);
        }

        await target.PushDatabaseAsync(ct);
    }

    private static async Task CopyFileIfNeededAsync(IStorageProvider source, IStorageProvider target, string relativePath, CancellationToken ct)
    {
        if (await target.ExistsAsync(relativePath, ct))
        {
            // Already migrated in a previous attempt - this is what makes a retried migration
            // resumable instead of starting over from nothing.
            return;
        }

        var sourceLocalPath = await source.GetLocalPathAsync(relativePath, ct);
        var targetLocalPath = await target.GetLocalPathAsync(relativePath, ct);

        if (!PathsEqual(sourceLocalPath, targetLocalPath))
        {
            Directory.CreateDirectory(Path.GetDirectoryName(targetLocalPath)!);
            File.Copy(sourceLocalPath, targetLocalPath, overwrite: true);
        }

        await target.NotifyWrittenAsync(relativePath, ct);
    }

    private static bool PathsEqual(string a, string b) =>
        string.Equals(Path.GetFullPath(a), Path.GetFullPath(b), StringComparison.OrdinalIgnoreCase);

    private static async Task<List<string>> EnumerateAllFilesAsync(IStorageProvider provider, CancellationToken ct)
    {
        var result = new List<string>();
        var pending = new Stack<string>();
        pending.Push("");

        while (pending.Count > 0)
        {
            ct.ThrowIfCancellationRequested();
            var current = pending.Pop();

            await foreach (var entry in provider.EnumerateAsync(current, ct))
            {
                if (entry.IsDirectory)
                {
                    pending.Push(entry.RelativePath);
                }
                else if (!ExcludedFileNames.Contains(Path.GetFileName(entry.RelativePath)))
                {
                    result.Add(entry.RelativePath);
                }
            }
        }

        return result;
    }

    private void Report(MigrationState state, int processed, int total, string? currentFile)
    {
        lock (_gate)
        {
            _snapshot = new MigrationProgressSnapshot(state, processed, total, currentFile, null);
        }
    }
}
