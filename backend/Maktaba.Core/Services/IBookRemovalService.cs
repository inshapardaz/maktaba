namespace Maktaba.Core.Services;

public record BookRemovalResult(string AbsoluteFolderPath);

/// <summary>
/// Removes a book's database records. Does not touch the filesystem - the caller (Electron, which has
/// cross-platform OS-trash support via shell.trashItem) is responsible for trashing the returned folder.
/// </summary>
public interface IBookRemovalService
{
    Task<BookRemovalResult?> RemoveAsync(int bookId, CancellationToken ct = default);
}
