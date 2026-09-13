namespace Maktaba.Core.Services;

public enum MigrationState { Idle, Copying, VerifyingCopy, Verified, Failed, Cancelled }

/// <summary>Point-in-time snapshot of an in-progress (or just-finished) library migration - same
/// shape/reasoning as RescanProgressSnapshot, polled the same way.</summary>
public sealed record MigrationProgressSnapshot(
    MigrationState State, int Processed, int Total, string? CurrentFile, string? ErrorMessage)
{
    public static readonly MigrationProgressSnapshot Idle = new(MigrationState.Idle, 0, 0, null, null);
}

/// <summary>Everything needed to construct the target IStorageProvider for a migration - the same
/// shape the S3 connect form already collects (see ConnectCloudLibraryRequestDto).</summary>
public record MigrationTarget(string ProviderType, IReadOnlyDictionary<string, string> ProviderConfig, string Credential);

/// <summary>
/// Copies the active library's entire file tree (books, covers, author images, metadata.db) from
/// its current IStorageProvider to a target one, then verifies the copy - the migration wizard's
/// backend (Cloud: Phase 3). Deliberately never touches the library registry itself; on success it
/// just holds the verified target ready for <see cref="CompleteAsync"/> to pick up, so nothing about
/// the source library changes unless/until the user explicitly confirms.
///
/// Resumable in the same spirit as S3StorageProvider's own presence-only caching: a file already
/// present at the target (checked via IStorageProvider.ExistsAsync, which checks the remote store,
/// not just a local cache) is skipped, so re-running after a network failure or a cancelled attempt
/// picks up roughly where it left off rather than re-copying everything. Not persisted across a
/// backend restart, same as every other in-memory progress tracker in this app - a restart during a
/// migration just means calling Start again once the backend comes back.
/// </summary>
public interface ILibraryMigrationService
{
    MigrationProgressSnapshot Snapshot { get; }

    /// <summary>Starts copying the active library to <paramref name="target"/> in the background;
    /// returns immediately. Throws InvalidOperationException if a migration is already running or
    /// no library is open.</summary>
    void Start(MigrationTarget target);

    /// <summary>Signals the in-progress migration to stop as soon as it safely can. A no-op if none
    /// is running.</summary>
    void Cancel();

    /// <summary>
    /// After a successful (Verified) migration: switches the active library's registry entry to the
    /// new provider (see ILibraryService.SwitchProviderAsync), and - only when
    /// <paramref name="deleteSource"/> is true and the *source* provider was "local" - deletes the
    /// original local folder. Deleting a previous *cloud* source's remote objects is deliberately
    /// out of scope here (a "keep or delete" checkbox silently emptying a whole bucket is a bigger
    /// action than this wizard should take on the user's behalf); such a source is always left in
    /// place regardless of <paramref name="deleteSource"/>.
    /// Returns false if there's no verified migration pending to complete.
    /// </summary>
    Task<bool> CompleteAsync(bool deleteSource, CancellationToken ct = default);
}
