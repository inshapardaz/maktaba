namespace Maktaba.Core.Services;

/// <summary>
/// Rebuilds metadata.db from the on-disk library folder, per the "the DB is a rebuildable index"
/// design (see docs/SPEC.md §4). Only recognizes folders following Maktaba's own
/// "{Author}/{Title} ({BookId})" layout; files dropped into the library outside that convention are
/// not picked up. A rescan only adds books for folders with no matching existing book id, and
/// removes books whose folder is gone - for a book id that already exists, its row (both DB-only
/// fields like rating/tags/series and file-derived metadata like title/authors/description) is left
/// untouched rather than re-read from the file's embedded metadata, so edits made in the app always
/// survive a rescan (see LibraryRescanService's PreviousBookState / issue #15). Only a genuinely new
/// book has its metadata extracted from the file; BookFiles (format/size/hash) are still refreshed
/// for every book on every rescan, since that legitimately tracks whatever is on disk right now.
/// </summary>
public interface ILibraryRescanService
{
    Task<int> RescanAsync(CancellationToken ct = default);
}
