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
public record BookRemovalResult(string AbsoluteFolderPath, bool RequiresLocalTrash);

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
