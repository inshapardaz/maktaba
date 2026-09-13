using System.Text.Json;
using Maktaba.Core.Services;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace Maktaba.Data.Services;

public class LibraryService : ILibraryService, ILibraryPathProvider
{
    private const string DatabaseFileName = "metadata.db";

    // Resolved lazily (not constructor-injected) to avoid a circular dependency:
    // IStorageProviderFactory itself depends on ILibraryService, which this class implements.
    private readonly IServiceProvider _serviceProvider;
    private readonly ICloudCacheManager _cloudCacheManager;
    private readonly ICloudCredentialCache _credentialCache;
    private readonly string _configFilePath;
    private readonly List<LibraryRegistryEntry> _libraries = [];
    private readonly SemaphoreSlim _schemaCheckLock = new(1, 1);
    private bool _schemaVerified;

    public string? LibraryRootPath { get; private set; }

    public string? CurrentLibraryId { get; private set; }

    public IReadOnlyList<LibraryRegistryEntry> Libraries => _libraries;

    // For a local library this is unchanged: Path.Combine(LibraryRootPath, "metadata.db"). For a
    // cloud-backed one, metadata.db lives in the local cache mirror instead - the same local path
    // that provider's own PullDatabaseAsync downloads it to (see ICloudCacheManager), not under
    // LibraryRootPath at all (which for a cloud library isn't a real local folder in the same sense).
    public string? DatabasePath
    {
        get
        {
            if (LibraryRootPath is null)
            {
                return null;
            }

            var entry = _libraries.FirstOrDefault(l => l.Id == CurrentLibraryId);
            return entry is null || entry.ProviderType == "local"
                ? Path.Combine(LibraryRootPath, DatabaseFileName)
                : _cloudCacheManager.GetLocalPath(entry.Id, DatabaseFileName);
        }
    }

    public LibraryService(IServiceProvider serviceProvider, ICloudCacheManager cloudCacheManager, ICloudCredentialCache credentialCache)
    {
        _serviceProvider = serviceProvider;
        _cloudCacheManager = cloudCacheManager;
        _credentialCache = credentialCache;

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

            // The local existence check below only makes sense for "local" - entryToOpen.Path is a
            // synthetic display string ("s3://...") for a cloud entry, never a real folder, so
            // Directory.Exists/File.Exists would always be false and silently leave *no* library
            // open at all (not even falling back to a different one) - this is exactly what made
            // every registered library appear to "vanish" after restarting with a cloud library
            // last active. A cloud entry is always considered valid to mark active here; whether it
            // can actually be *used* yet depends on its credential being re-supplied this session
            // (see ICloudCredentialCache) - the frontend does that right after startup, since this
            // constructor has no way to prompt for one itself.
            var entryToOpen = _libraries.FirstOrDefault(l => l.Id == lastLibraryId) ?? _libraries.FirstOrDefault();
            if (entryToOpen is not null && IsValidToAutoOpen(entryToOpen))
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

    private static bool IsValidToAutoOpen(LibraryRegistryEntry entry) =>
        entry.ProviderType != "local" ||
        (Directory.Exists(entry.Path) && File.Exists(Path.Combine(entry.Path, DatabaseFileName)));

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

    public async Task<LibraryInfo?> OpenLibraryByIdAsync(string id, string? credential = null, CancellationToken ct = default)
    {
        var entry = _libraries.FirstOrDefault(l => l.Id == id);
        if (entry is null)
        {
            return null;
        }

        if (credential is not null)
        {
            _credentialCache.Set(id, credential);
        }

        await ActivateAsync(entry, ct);
        return new LibraryInfo(entry.Path);
    }

    public async Task<LibraryInfo> OpenCloudLibraryAsync(
        string name, string providerType, IReadOnlyDictionary<string, string> providerConfig, string credential,
        CancellationToken ct = default)
    {
        var id = Guid.NewGuid().ToString("N");
        // CredentialRef is just this library's own id - simplest possible opaque key, and one the
        // frontend already has on hand (no separate id-generation step needed when it calls
        // window.maktaba.saveCloudCredential after a successful connect).
        var entry = new LibraryRegistryEntry(
            id, name, Path: $"{providerType}://{name}",
            ProviderType: providerType, ProviderConfig: providerConfig, CredentialRef: id);
        _libraries.Add(entry);

        _credentialCache.Set(entry.Id, credential);
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

    public Task<LibraryRegistryEntry?> SetPeriodicalsEnabledAsync(string id, bool enabled, CancellationToken ct = default)
    {
        var index = _libraries.FindIndex(l => l.Id == id);
        if (index < 0)
        {
            return Task.FromResult<LibraryRegistryEntry?>(null);
        }

        var updated = _libraries[index] with { PeriodicalsEnabled = enabled };
        _libraries[index] = updated;
        SaveConfig();
        return Task.FromResult<LibraryRegistryEntry?>(updated);
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
        // entry.Path is a real local folder only for "local" - a cloud entry's Path is a synthetic
        // display string (see OpenCloudLibraryAsync), never a filesystem path to create.
        if (entry.ProviderType == "local")
        {
            Directory.CreateDirectory(entry.Path);
        }

        LibraryRootPath = entry.Path;
        CurrentLibraryId = entry.Id;
        _schemaVerified = false;

        // Cloud Sync Core: pull the remote copy of metadata.db (if any) into the local cache before
        // EF ever opens it, so an existing cloud library's DB isn't shadowed by a freshly-created
        // empty one below. A no-op for a local library (LocalFileSystemProvider.PullDatabaseAsync
        // just returns DatabasePath) - CurrentLibraryId/LibraryRootPath are already set above, so
        // the factory resolves the right provider for the library being activated.
        var storage = _serviceProvider.GetRequiredService<IStorageProviderFactory>().Current;

        if (entry.ProviderType != "local")
        {
            // Microsoft.Data.Sqlite defaults to WAL mode, which keeps a memory-mapped
            // "{db}-shm" file (plus a "{db}-wal" journal) alongside metadata.db for as long as any
            // connection - even a pooled one left over from earlier in this same process, e.g. a
            // previous EnsureCurrentSchemaAsync probe - has it open. Overwriting metadata.db without
            // releasing that first is exactly what turned "Access to the path is denied" from a
            // transient, retryable failure (CloudCacheManager's own retry loop) into a persistent
            // one no amount of retrying fixed: the lock was never going to release on its own. Only
            // relevant for a cloud-backed library, whose PullDatabaseAsync is about to *replace* the
            // local cache copy - for "local", PullDatabaseAsync never touches the file at all, and
            // clearing pools/deleting WAL/SHM there would risk losing not-yet-checkpointed local
            // writes for no reason.
            SqliteConnection.ClearAllPools();
            if (DatabasePath is { } dbPath)
            {
                foreach (var suffix in new[] { "-wal", "-shm" })
                {
                    var sidecarPath = dbPath + suffix;
                    if (File.Exists(sidecarPath))
                    {
                        File.Delete(sidecarPath);
                    }
                }
            }
        }

        await storage.PullDatabaseAsync(ct);

        // SQLite needs the parent folder to already exist before it can create a new file there.
        // For "local" that's entry.Path itself (already created above). For a cloud library it's the
        // local cache mirror folder - PullDatabaseAsync only creates it when a remote metadata.db
        // actually exists to download; a brand-new library (nothing pushed yet) leaves it missing,
        // which made EnsureCreatedAsync below fail with "SQLite Error 14: unable to open database
        // file" the first time anyone connected to a fresh bucket/prefix.
        Directory.CreateDirectory(Path.GetDirectoryName(DatabasePath)!);

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
    ///
    /// Called from middleware on *every* request (see Program.cs), so right after a schema-breaking
    /// change ships, several requests can arrive before the first one finishes rebuilding - the
    /// frontend alone fires off a handful of independent queries in parallel on load. Without
    /// serializing this, each of those requests would see <c>_schemaVerified</c> still false and race
    /// to EnsureDeleted/EnsureCreated the same sqlite file concurrently, surfacing as "table already
    /// exists" (or a locked-file) error, and would each separately trigger a rescan on top of that.
    /// <c>_schemaCheckLock</c> plus the double-checked read of <c>_schemaVerified</c> after acquiring
    /// it makes sure only the first caller actually rebuilds; everyone else waits, then no-ops.
    /// </summary>
    public async Task<bool> EnsureCurrentSchemaAsync(CancellationToken ct = default)
    {
        if (_schemaVerified || LibraryRootPath is null)
        {
            return false;
        }

        await _schemaCheckLock.WaitAsync(ct);
        try
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
        finally
        {
            _schemaCheckLock.Release();
        }
    }

    // Probes the newest columns/tables added by a schema-breaking change (currently: M6's
    // ReadingStatus/Collections, the Bookmarks/Notes/ReadingProgress tables, ReadingProgress's
    // ChapterId/Position resume-anchor columns, issue #26's Periodicals table/Book.PeriodicalId
    // column, issue #23's ReadingActivities table (plus its later Hour column, for the
    // day-of-week/time-of-day reading report), issue #30's Periodical.Language column, and
    // Periodical's Publisher/Editor columns + PeriodicalTags table) - a cheap, representative
    // column, issue #27's BookFile.IsCustomNamed column, issue #30's Periodical.Language column,
    // Periodical's Publisher/Editor columns + PeriodicalTags table, and issue #67's Book.PageCount
    // column) - a cheap, representative stand-in for "is this database current" without needing
    // full EF Core migrations, which this project deliberately doesn't use. Every future schema-
    // breaking change needs its own probe added here, or an upgrading user's existing metadata.db
    // won't be recognized as stale and requests against the new column/table will throw instead of
    // transparently rebuilding.
    private static async Task<bool> IsCurrentSchemaAsync(MaktabaDbContext db, CancellationToken ct)
    {
        try
        {
            await db.Books.Select(b => b.ReadingStatus).Take(1).ToListAsync(ct);
            await db.Collections.Select(c => c.Id).Take(1).ToListAsync(ct);
            await db.ReadingProgress.Select(rp => new { rp.BookId, rp.ChapterId }).Take(1).ToListAsync(ct);
            await db.Periodicals.Select(p => p.Id).Take(1).ToListAsync(ct);
            await db.Books.Select(b => b.PeriodicalId).Take(1).ToListAsync(ct);
            await db.ReadingActivities.Select(ra => ra.Hour).Take(1).ToListAsync(ct);
            await db.BookFiles.Select(f => f.IsCustomNamed).Take(1).ToListAsync(ct);
            await db.Periodicals.Select(p => new { p.Language, p.Publisher, p.Editor }).Take(1).ToListAsync(ct);
            await db.PeriodicalTags.Select(pt => pt.PeriodicalId).Take(1).ToListAsync(ct);
            await db.Books.Select(b => b.PageCount).Take(1).ToListAsync(ct);
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
