namespace Maktaba.Core.Services;

public record LibraryInfo(string Path);

/// <summary>A library the user has opened at least once, kept in the app-wide registry (see
/// LibraryService) regardless of whether it's the one currently active.</summary>
public record LibraryRegistryEntry(string Id, string Name, string Path, bool PeriodicalsEnabled = true);

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

    /// <summary>Switches to an already-registered library by id. Returns null if no such library is registered.</summary>
    Task<LibraryInfo?> OpenLibraryByIdAsync(string id, CancellationToken ct = default);

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
