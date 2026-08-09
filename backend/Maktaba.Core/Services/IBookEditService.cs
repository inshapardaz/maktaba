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
    IReadOnlyList<string> Tags
);

/// <summary>
/// Updates a book's editable metadata (v1: DB only - does not rename/move the on-disk folder, which
/// is tracked as an M3 feature since it needs to interact with duplicate-detection and file moves).
/// </summary>
public interface IBookEditService
{
    Task<Book?> UpdateAsync(int bookId, BookEditRequest request, CancellationToken ct = default);
}
