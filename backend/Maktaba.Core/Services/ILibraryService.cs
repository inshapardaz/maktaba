namespace Maktaba.Core.Services;

public record LibraryInfo(string Path);

/// <summary>A library the user has opened at least once, kept in the app-wide registry (see
/// LibraryService) regardless of whether it's the one currently active.</summary>
/// <param name="ProviderType">"local" | "s3" | "onedrive" | "googledrive" | "nawishta". Defaults to
/// "local" so an entry loaded from a pre-cloud-support config.json (missing the field entirely)
/// deserializes exactly as it always has - see the cloud storage epic's non-breaking-changes
/// requirement.</param>
/// <param name="ProviderConfig">Provider-specific, non-secret settings only (e.g. S3's bucket/
/// region/prefix, Nawishta's server URL/remote library id) - never a secret. Null for "local".</param>
/// <param name="CredentialRef">Opaque key into the OS-backed credential store (see the Cloud Sync
/// Core credential-store task) - never the secret itself. Null for "local".</param>
public record LibraryRegistryEntry(
    string Id,
    string Name,
    string Path,
    bool PeriodicalsEnabled = true,
    string ProviderType = "local",
    IReadOnlyDictionary<string, string>? ProviderConfig = null,
    string? CredentialRef = null);

public interface ILibraryService
{
    /// <summary>Absolute path to the currently open library's root folder, or null if none is open.</summary>
    string? LibraryRootPath { get; }

    /// <summary>Id of the currently open library within <see cref="Libraries"/>, or null if none is open.</summary>
    string? CurrentLibraryId { get; }

    /// <summary>Every library the user has ever opened, most-recently-added last. Only one is active
    /// at a time (<see cref="CurrentLibraryId"/>) - the rest just sit registered until switched to.</summary>
    IReadOnlyList<LibraryRegistryEntry> Libraries { get; }

    /// <summary>
    /// Opens the library at <paramref name="path"/>, creating it (folder + database) if it doesn't
    /// already exist, and registering it if it isn't already known. Persists it as the last-opened
    /// library for future app launches.
    /// </summary>
    Task<LibraryInfo> OpenAsync(string path, CancellationToken ct = default);

    /// <summary>Switches to an already-registered library by id. Returns null if no such library is
    /// registered. <paramref name="credential"/> is required the first time a cloud-backed library is
    /// opened in this process session (and any time it needs refreshing) - see ICloudCredentialCache;
    /// omit it to reuse whatever credential (if any) is already cached for this library id.</summary>
    Task<LibraryInfo?> OpenLibraryByIdAsync(string id, string? credential = null, CancellationToken ct = default);

    /// <summary>
    /// Registers and activates a brand-new cloud-backed library - the "connect a cloud library" flow
    /// (S3/OneDrive/Google Drive/Nawishta), as opposed to <see cref="OpenAsync"/>'s "pick a local
    /// folder" flow. <paramref name="credential"/> is cached (see ICloudCredentialCache) before
    /// activation so the provider can pull its existing remote metadata.db, if any.
    /// </summary>
    Task<LibraryInfo> OpenCloudLibraryAsync(
        string name,
        string providerType,
        IReadOnlyDictionary<string, string> providerConfig,
        string credential,
        CancellationToken ct = default);

    /// <summary>Renames a registered library's display name (does not touch its folder). Returns null if not found.</summary>
    Task<LibraryRegistryEntry?> RenameAsync(string id, string name, CancellationToken ct = default);

    /// <summary>Re-points a registered library at a different folder (e.g. after it was moved on disk),
    /// re-activating it in place if it's the currently open one. Returns null if not found.</summary>
    Task<LibraryRegistryEntry?> RelocateAsync(string id, string newPath, CancellationToken ct = default);

    /// <summary>Toggles the Periodicals feature's visibility for one registered library - a pure UI
    /// preference stored alongside the registry entry, not something that touches that library's own
    /// metadata.db. Returns null if not found.</summary>
    Task<LibraryRegistryEntry?> SetPeriodicalsEnabledAsync(string id, bool enabled, CancellationToken ct = default);

    /// <summary>Un-registers a library (its files on disk are left untouched). If it was the active
    /// library, switches to another registered one if any remain, otherwise leaves none open.
    /// Returns false if no such library was registered.</summary>
    Task<bool> RemoveAsync(string id, CancellationToken ct = default);
}

/// <summary>
/// Read-only view of the current library's location, consumed by the data layer to build
/// per-library database connections without Maktaba.Core depending on Maktaba.Data.
/// </summary>
public interface ILibraryPathProvider
{
    string? LibraryRootPath { get; }
    string? DatabasePath { get; }
}
