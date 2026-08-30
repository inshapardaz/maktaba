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
}
