using System.Text.Json;
using Maktaba.Core.Services;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;

namespace Maktaba.Data.Services;

public class LibraryService : ILibraryService, ILibraryPathProvider
{
    private const string DatabaseFileName = "metadata.db";

    private readonly string _configFilePath;
    private bool _schemaVerified;

    public string? LibraryRootPath { get; private set; }

    public string? DatabasePath =>
        LibraryRootPath is null ? null : Path.Combine(LibraryRootPath, DatabaseFileName);

    public LibraryService()
    {
        var appDataDir = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
            "Maktaba");
        Directory.CreateDirectory(appDataDir);
        _configFilePath = Path.Combine(appDataDir, "config.json");

        TryLoadLastOpenedLibrary();
    }

    private void TryLoadLastOpenedLibrary()
    {
        if (!File.Exists(_configFilePath))
        {
            return;
        }

        try
        {
            var json = File.ReadAllText(_configFilePath);
            var config = JsonSerializer.Deserialize<AppConfig>(json);
            if (config?.LastLibraryPath is { Length: > 0 } path &&
                Directory.Exists(path) &&
                File.Exists(Path.Combine(path, DatabaseFileName)))
            {
                LibraryRootPath = path;
            }
        }
        catch (Exception ex) when (ex is IOException or JsonException)
        {
            // Corrupt or unreadable config: fall through with no library open;
            // the user will be prompted to open one again.
        }
    }

    public async Task<LibraryInfo> OpenAsync(string path, CancellationToken ct = default)
    {
        var fullPath = Path.GetFullPath(path);
        Directory.CreateDirectory(fullPath);

        LibraryRootPath = fullPath;
        _schemaVerified = false;

        using var db = MaktabaDbContextFactory.Create(this);
        await db.Database.EnsureCreatedAsync(ct);

        SaveLastOpenedLibrary(fullPath);

        return new LibraryInfo(fullPath);
    }

    /// <summary>
    /// Verifies the current library's metadata.db matches today's EF model, and transparently rebuilds
    /// it if not - covers both an explicit open (<see cref="OpenAsync"/>) and the constructor's
    /// auto-reopen of the last-used library, since neither path alone can distinguish "database
    /// predates a breaking schema change" from "database is fine" (EnsureCreatedAsync only creates a
    /// *missing* file; it doesn't migrate an existing one - see README "Known issues" for the schema
    /// changes shipped so far). metadata.db is documented as a rebuildable cache over the on-disk
    /// layout (docs/SPEC.md §4), so wiping and rebuilding it is exactly the intended recovery, not data
    /// loss beyond what a stale schema already made inaccessible. Checked once per opened library
    /// (cached via <c>_schemaVerified</c>) so this doesn't add overhead to every request.
    /// Returns true if the database was rebuilt (empty schema, no rows) and needs a rescan to
    /// repopulate it from the on-disk book folders.
    /// </summary>
    public async Task<bool> EnsureCurrentSchemaAsync(CancellationToken ct = default)
    {
        if (_schemaVerified || LibraryRootPath is null)
        {
            return false;
        }

        using var db = MaktabaDbContextFactory.Create(this);
        await db.Database.EnsureCreatedAsync(ct);

        var rebuilt = false;
        if (!await IsCurrentSchemaAsync(db, ct))
        {
            await db.Database.EnsureDeletedAsync(ct);
            using var recreated = MaktabaDbContextFactory.Create(this);
            await recreated.Database.EnsureCreatedAsync(ct);
            rebuilt = true;
        }

        _schemaVerified = true;
        return rebuilt;
    }

    // Probes the newest columns/tables added by a schema-breaking change (currently: M6's
    // ReadingStatus/Collections) - a cheap, representative stand-in for "is this database current"
    // without needing full EF Core migrations, which this project deliberately doesn't use.
    private static async Task<bool> IsCurrentSchemaAsync(MaktabaDbContext db, CancellationToken ct)
    {
        try
        {
            await db.Books.Select(b => b.ReadingStatus).Take(1).ToListAsync(ct);
            await db.Collections.Select(c => c.Id).Take(1).ToListAsync(ct);
            return true;
        }
        catch (SqliteException)
        {
            return false;
        }
    }

    private void SaveLastOpenedLibrary(string path)
    {
        var json = JsonSerializer.Serialize(new AppConfig(path));
        File.WriteAllText(_configFilePath, json);
    }

    private record AppConfig(string? LastLibraryPath);
}
