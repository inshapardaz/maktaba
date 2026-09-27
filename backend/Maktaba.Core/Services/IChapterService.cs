using Maktaba.Core.Entities;

namespace Maktaba.Core.Services;

/// <summary>
/// Chapter CRUD for a book being digitized (epic #162, Phase 4) - scaffolded in Phase 0 alongside
/// IDigitizationService so the interface exists before its implementation does; every method
/// throws NotImplementedException until Phase 4 lands.
/// </summary>
public interface IChapterService
{
    Task<Chapter> CreateAsync(int bookId, string title, CancellationToken ct = default);

    Task RenameAsync(int bookId, int chapterId, string title, CancellationToken ct = default);

    Task ReorderAsync(int bookId, IReadOnlyList<int> chapterIdsInOrder, CancellationToken ct = default);

    Task DeleteAsync(int bookId, int chapterId, CancellationToken ct = default);

    /// <summary>Sets a chapter's first page, then autofills every following page (up to the next
    /// chapter's first page, or the end of the book) into this chapter - the "first page of
    /// chapter" shortcut from the epic's design doc.</summary>
    Task SetFirstPageAsync(int bookId, int chapterId, int pageId, CancellationToken ct = default);
}
