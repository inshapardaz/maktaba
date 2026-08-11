using System.Text.Json;
using Maktaba.Core.Services;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;

namespace Maktaba.Data.Services;

public class LibraryService : ILibraryService, ILibraryPathProvider
{
    private const string DatabaseFileName = "metadata.db";

    private readonly string _configFilePath;
    private readonly List<LibraryRegistryEntry> _libraries = [];
    private bool _schemaVerified;

    public string? LibraryRootPath { get; private set; }

    public string? CurrentLibraryId { get; private set; }

    public IReadOnlyList<LibraryRegistryEntry> Libraries => _libraries;

    public string? DatabasePath =>
        LibraryRootPath is null ? null : Path.Combine(LibraryRootPath, DatabaseFileName);

    public LibraryService()
    {
        var appDataDir = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
            "Maktaba");
        Directory.CreateDirectory(appDataDir);
        _configFilePath = Path.Combine(appDataDir, "config.json");

        LoadConfig();
    }

    private void LoadConfig()
    {
        if (!File.Exists(_configFilePath))
        {
            return;
        }

        try
        {
            var json = File.ReadAllText(_configFilePath);
            var config = JsonSerializer.Deserialize<AppConfig>(json);
            if (config is null)
            {
                return;
            }

            _libraries.Clear();
            if (config.Libraries is { Count: > 0 } libraries)
            {
                _libraries.AddRange(libraries);
            }

            // Migrates a pre-multi-library config.json (which only ever recorded a single
            // LastLibraryPath) into a one-entry registry the first time it's loaded under the new
            // format - existing installs shouldn't lose their library just because this shipped.
            var lastLibraryId = config.LastLibraryId;
            if (_libraries.Count == 0 && config.LastLibraryPath is { Length: > 0 } legacyPath && Directory.Exists(legacyPath))
            {
                var migrated = new LibraryRegistryEntry(Guid.NewGuid().ToString("N"), new DirectoryInfo(legacyPath).Name, legacyPath);
                _libraries.Add(migrated);
                lastLibraryId = migrated.Id;
            }

            var entryToOpen = _libraries.FirstOrDefault(l => l.Id == lastLibraryId) ?? _libraries.FirstOrDefault();
            if (entryToOpen is not null &&
                Directory.Exists(entryToOpen.Path) &&
                File.Exists(Path.Combine(entryToOpen.Path, DatabaseFileName)))
            {
                LibraryRootPath = entryToOpen.Path;
                CurrentLibraryId = entryToOpen.Id;
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

        var existing = _libraries.FirstOrDefault(l =>
            string.Equals(Path.GetFullPath(l.Path), fullPath, StringComparison.OrdinalIgnoreCase));
        var entry = existing ?? new LibraryRegistryEntry(Guid.NewGuid().ToString("N"), new DirectoryInfo(fullPath).Name, fullPath);
        if (existing is null)
        {
            _libraries.Add(entry);
        }

        await ActivateAsync(entry, ct);
        return new LibraryInfo(fullPath);
    }

    public async Task<LibraryInfo?> OpenLibraryByIdAsync(string id, CancellationToken ct = default)
    {
        var entry = _libraries.FirstOrDefault(l => l.Id == id);
        if (entry is null)
        {
            return null;
        }

        await ActivateAsync(entry, ct);
        return new LibraryInfo(entry.Path);
    }

    public Task<LibraryRegistryEntry?> RenameAsync(string id, string name, CancellationToken ct = default)
    {
        var index = _libraries.FindIndex(l => l.Id == id);
        if (index < 0)
        {
            return Task.FromResult<LibraryRegistryEntry?>(null);
        }

        var updated = _libraries[index] with { Name = name };
        _libraries[index] = updated;
        SaveConfig();
        return Task.FromResult<LibraryRegistryEntry?>(updated);
    }

    public async Task<LibraryRegistryEntry?> RelocateAsync(string id, string newPath, CancellationToken ct = default)
    {
        var index = _libraries.FindIndex(l => l.Id == id);
        if (index < 0)
        {
            return null;
        }

        var fullPath = Path.GetFullPath(newPath);
        var updated = _libraries[index] with { Path = fullPath };
        _libraries[index] = updated;

        if (CurrentLibraryId == id)
        {
            // The active library just moved out from under itself - re-activate in place so
            // LibraryRootPath/DatabasePath (and the schema-verified flag) track the new location.
            await ActivateAsync(updated, ct);
        }
        else
        {
            SaveConfig();
        }

        return updated;
    }

    public async Task<bool> RemoveAsync(string id, CancellationToken ct = default)
    {
        var index = _libraries.FindIndex(l => l.Id == id);
        if (index < 0)
        {
            return false;
        }

        _libraries.RemoveAt(index);

        if (CurrentLibraryId == id)
        {
            LibraryRootPath = null;
            CurrentLibraryId = null;
            _schemaVerified = false;

            var next = _libraries.FirstOrDefault();
            if (next is not null)
            {
                await ActivateAsync(next, ct);
                return true;
            }
        }

        SaveConfig();
        return true;
    }

    private async Task ActivateAsync(LibraryRegistryEntry entry, CancellationToken ct)
    {
        Directory.CreateDirectory(entry.Path);

        LibraryRootPath = entry.Path;
        CurrentLibraryId = entry.Id;
        _schemaVerified = false;

        using var db = MaktabaDbContextFactory.Create(this);
        await db.Database.EnsureCreatedAsync(ct);

        SaveConfig();
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

    private void SaveConfig()
    {
        var json = JsonSerializer.Serialize(new AppConfig(_libraries, CurrentLibraryId, null));
        File.WriteAllText(_configFilePath, json);
    }

    private record AppConfig(List<LibraryRegistryEntry>? Libraries, string? LastLibraryId, string? LastLibraryPath);
}
