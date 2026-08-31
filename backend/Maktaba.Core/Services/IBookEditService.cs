using Maktaba.Core.Entities;

namespace Maktaba.Core.Services;

public record BookEditRequest(
    string Title,
    IReadOnlyList<string> Authors,
    string? Language,
    string? Publisher,
    DateOnly? PublishedDate,
    string? Description,
    int Rating,
    string? SeriesName,
    double? SeriesIndex,
    IReadOnlyList<string> Tags,
    IReadOnlyList<int> CollectionIds,
    int? PeriodicalId = null,
    double? IssueNumber = null,
    int? VolumeNumber = null,
    DateOnly? IssueDate = null
);

/// <summary>
/// Updates a book's editable metadata (v1: DB only - does not rename/move the on-disk folder, which
/// is tracked as an M3 feature since it needs to interact with duplicate-detection and file moves).
/// </summary>
public interface IBookEditService
{
    Task<Book?> UpdateAsync(int bookId, BookEditRequest request, CancellationToken ct = default);

    /// <summary>Renames a single attached file's on-disk name (issue #27). Returns null if the book
    /// or file (scoped to that book) doesn't exist.</summary>
    Task<BookFile?> RenameFileAsync(int bookId, int fileId, string newName, CancellationToken ct = default);

    /// <summary>Deletes a single attached file, both the DB row and the on-disk file. Returns null if
    /// the book or file (scoped to that book) doesn't exist. Throws <see cref="InvalidOperationException"/>
    /// if it's the book's only file - a book must always have at least one attached format.</summary>
    Task<bool?> DeleteFileAsync(int bookId, int fileId, CancellationToken ct = default);

    /// <summary>Issue #49: merges <paramref name="sourceBookId"/> into <paramref name="targetBookId"/> -
    /// every source file the target doesn't already have (by content hash) is moved into the target's
    /// own folder and attached to it; the target's own metadata (title, authors, rating, etc.) is left
    /// completely untouched. Does not delete the now-empty source book itself - the caller does that
    /// separately (the same way a book is normally removed), once the files have been moved off it.
    /// Returns null if either book doesn't exist, or throws <see cref="InvalidOperationException"/> if
    /// both ids refer to the same book.</summary>
    Task<Book?> MergeAsync(int targetBookId, int sourceBookId, CancellationToken ct = default);
}
