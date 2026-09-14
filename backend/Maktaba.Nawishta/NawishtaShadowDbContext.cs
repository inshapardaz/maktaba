using Maktaba.Core.Entities;
using Microsoft.EntityFrameworkCore;

namespace Maktaba.Nawishta;

/// <summary>
/// A Nawishta-backed library has no metadata.db at all - Nawishta's own server is the source of
/// truth for everything a local library's EF-backed metadata.db would otherwise hold. The one thing
/// Nawishta has no equivalent concept for is *per-Maktaba-user* state: ReadingStatus/Rating/reading
/// progress and Collection membership (see the design addendum on issue #69) - this tiny second
/// SQLite database, keyed by Nawishta's own int book id (never run through IdCodec - see
/// NawishtaProviderOptions.RemoteLibraryId's own doc comment for the same point about library ids),
/// holds just that. One file per Nawishta-backed library, at
/// %AppData%/Maktaba/NawishtaShadow/{libraryId}.db - mirrors CloudCacheManager's own
/// %AppData%/Maktaba/CloudCache/{libraryId}/ convention for per-library local state.
/// </summary>
public class NawishtaShadowDbContext(string dbPath) : DbContext
{
    public DbSet<NawishtaBookState> BookStates => Set<NawishtaBookState>();
    public DbSet<NawishtaShadowCollection> Collections => Set<NawishtaShadowCollection>();
    public DbSet<NawishtaBookCollectionLink> BookCollectionLinks => Set<NawishtaBookCollectionLink>();

    protected override void OnConfiguring(DbContextOptionsBuilder optionsBuilder) =>
        optionsBuilder.UseSqlite($"Data Source={dbPath}");

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<NawishtaBookState>().HasKey(s => s.RemoteBookId);
        modelBuilder.Entity<NawishtaBookCollectionLink>().HasKey(l => new { l.RemoteBookId, l.CollectionId });
    }

    public static string GetDbPath(string libraryId)
    {
        var appData = Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData);
        var dir = Path.Combine(appData, "Maktaba", "NawishtaShadow");
        Directory.CreateDirectory(dir);
        return Path.Combine(dir, $"{libraryId}.db");
    }
}

/// <summary>Per-book local-only state for a Nawishta-backed library - everything Maktaba tracks
/// that Nawishta itself has no concept of. RemoteBookId is Nawishta's own book id (int), reused
/// as-is as this row's key.</summary>
public class NawishtaBookState
{
    public int RemoteBookId { get; set; }
    public ReadingStatus ReadingStatus { get; set; } = ReadingStatus.Unread;
    public int Rating { get; set; }
    public DateTime? LastReadAt { get; set; }
    public int SecondsRead { get; set; }

    // Percentage through whichever content file was last read - same single-number simplification
    // BookFile-less callers elsewhere in this app already make (see ContinueReadingEntry.Percentage).
    public double Percentage { get; set; }
}

/// <summary>A user-created collection, scoped to this one Nawishta library - same "create is
/// user-driven, never auto-derived" semantics as Maktaba.Core.Entities.Collection (see
/// CollectionEndpoints.cs's doc comment), just persisted in the shadow DB instead of metadata.db
/// since a Nawishta library has no metadata.db.</summary>
public class NawishtaShadowCollection
{
    public int Id { get; set; }
    public string Name { get; set; } = string.Empty;
}

public class NawishtaBookCollectionLink
{
    public int RemoteBookId { get; set; }
    public int CollectionId { get; set; }
}
