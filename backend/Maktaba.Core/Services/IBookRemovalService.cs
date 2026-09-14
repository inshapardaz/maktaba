namespace Maktaba.Core.Services;

/// <param name="AbsoluteFolderPath">The book's local cache path - meaningful to actually show/trash
/// on disk only when <paramref name="RequiresLocalTrash"/> is true.</param>
/// <param name="RequiresLocalTrash">True only for a local library - the caller (Electron, which has
/// cross-platform OS-trash support via shell.trashItem) is responsible for trashing
/// <paramref name="AbsoluteFolderPath"/> itself in that case. False for a cloud-backed library:
/// <see cref="IBookRemovalService.RemoveAsync"/> already deleted the folder from the remote store
/// (and its local cache mirror) itself before returning, since there's no OS-trash-able local
/// folder to hand back for a remote object the way there is for a real local file - AbsoluteFolderPath
/// is only the (now-deleted) cache path here, not something the caller should act on.</param>
/// <param name="ParentFolderPath">The removed book's parent folder (its author folder -
/// "{Author Sort Name}/{Book Title} (sqid)" is the on-disk layout, see LibraryPathBuilder), only
/// when <see cref="RequiresLocalTrash"/> is true and the book wasn't a periodical issue (an issue's
/// parent is its periodical's own folder, which has an independent identity - a Periodical DB row
/// that still exists - unlike a plain author folder, which is purely a derived grouping with no
/// identity of its own once nothing files under it anymore). Null whenever pruning an empty parent
/// wouldn't be safe/meaningful: a cloud library (RemoveAsync already handled this remotely itself,
/// see below), or a periodical issue. The caller should trash this folder too, but only if it's
/// actually empty by the time the book's own folder has actually been trashed - never unconditionally.</param>
public record BookRemovalResult(string AbsoluteFolderPath, bool RequiresLocalTrash, string? ParentFolderPath = null);

/// <summary>
/// Removes a book's database records, and - only for a cloud-backed library, where there's no OS
/// trash to defer to - the underlying files too (see BookRemovalResult.RequiresLocalTrash). For a
/// local library, the filesystem is untouched here; the caller (Electron, which has cross-platform
/// OS-trash support via shell.trashItem) is responsible for trashing the returned folder itself.
/// </summary>
public interface IBookRemovalService
{
    Task<BookRemovalResult?> RemoveAsync(int bookId, CancellationToken ct = default);
}
