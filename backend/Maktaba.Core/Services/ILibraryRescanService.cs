namespace Maktaba.Core.Services;

/// <summary>
/// Rebuilds metadata.db from the on-disk library folder, per the "the DB is a rebuildable index"
/// design (see docs/SPEC.md §4). Only recognizes folders following Maktaba's own
/// "{Author}/{Title} ({BookId})" layout; files dropped into the library outside that convention are
/// not picked up. Metadata is re-derived from each file's embedded metadata, so any DB-only edits
/// (rating, tags, series, or a title/author correction that isn't reflected in the file itself) are
/// lost - this is an intentional tradeoff of treating the DB purely as a rebuildable cache.
/// </summary>
public interface ILibraryRescanService
{
    Task<int> RescanAsync(CancellationToken ct = default);
}
