namespace Maktaba.Core.Services;

public record LibraryInfo(string Path);

public interface ILibraryService
{
    /// <summary>Absolute path to the currently open library's root folder, or null if none is open.</summary>
    string? LibraryRootPath { get; }

    /// <summary>
    /// Opens the library at <paramref name="path"/>, creating it (folder + database) if it doesn't
    /// already exist. Persists the path as the last-opened library for future app launches.
    /// </summary>
    Task<LibraryInfo> OpenAsync(string path, CancellationToken ct = default);
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
