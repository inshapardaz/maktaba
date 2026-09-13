namespace Maktaba.Core.Sync;

/// <summary>
/// Content of the ".maktaba-lock" marker a cloud-backed <see cref="Services.IStorageProvider"/>
/// writes to the remote store on library open (and refreshes periodically while open, see the
/// heartbeat task) to implement the single-writer/last-write-wins concurrency model described in
/// the cloud storage epic. Parsing/formatting only, shared across every future provider so S3/
/// OneDrive/Google Drive/Nawishta don't each reinvent the marker format - actually reading/writing
/// the marker file itself is each provider's own responsibility (it's just another small file in
/// whatever remote store that provider talks to).
/// </summary>
public record LibraryLockInfo(string DeviceName, string MachineId, DateTimeOffset AcquiredAtUtc)
{
    // How long a lock is trusted before it's treated as abandoned (a crash, a killed process) -
    // must be comfortably longer than the heartbeat refresh interval so a live session's lock never
    // goes stale between two heartbeats.
    private static readonly TimeSpan StaleAfter = TimeSpan.FromMinutes(2);

    public bool IsStale(DateTimeOffset now) => now - AcquiredAtUtc > StaleAfter;

    public bool IsThisDevice() => MachineId == CurrentMachineId();

    public string Serialize() => $"{DeviceName}\t{MachineId}\t{AcquiredAtUtc:O}";

    public static LibraryLockInfo? TryParse(string content)
    {
        var parts = content.Split('\t');
        if (parts.Length != 3 || !DateTimeOffset.TryParse(parts[2], out var acquiredAt))
        {
            return null;
        }

        return new LibraryLockInfo(parts[0], parts[1], acquiredAt);
    }

    public static LibraryLockInfo ForThisDevice() =>
        new(Environment.MachineName, CurrentMachineId(), DateTimeOffset.UtcNow);

    // A stable-enough per-install identifier for "is this the same device that holds the lock" -
    // doesn't need to be cryptographically unique, just distinct across the user's own machines.
    private static string CurrentMachineId() => $"{Environment.MachineName}:{Environment.UserName}";
}
