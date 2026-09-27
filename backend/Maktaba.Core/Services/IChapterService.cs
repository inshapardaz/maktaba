namespace Maktaba.Core.Services;

/// <summary>
/// Chapter CRUD for a book being digitized (epic #162, Phase 4) - reads/writes digitization.json
/// via IDigitizationJsonStore, the same "durable file, DB is a rebuildable cache" shape
/// IDigitizationService's page methods already use. Chapter/page ids here are always the
/// digitization.json string ids ("c1", "p1", ...), never the internal DB int primary key - matches
/// every IDigitizationService page method's own convention (see DigitizationJsonPage/
/// DigitizationJsonChapter), corrected from Phase 0's original int-based scaffolding since nothing
/// called it yet.
/// </summary>
public interface IChapterService
{
    Task<DigitizationState> CreateAsync(int bookId, string title, CancellationToken ct = default);

    Task<DigitizationState> RenameAsync(int bookId, string chapterId, string title, CancellationToken ct = default);

    Task<DigitizationState> ReorderAsync(int bookId, IReadOnlyList<string> chapterIdsInOrder, CancellationToken ct = default);

    /// <summary>Deletes the chapter; every page that referenced it has its ChapterId cleared
    /// (unassigned), not deleted.</summary>
    Task<DigitizationState> DeleteAsync(int bookId, string chapterId, CancellationToken ct = default);

    /// <summary>Sets a chapter's first page, then autofills every following page (by page order, up
    /// to the next chapter's own first page, or the end of the book) into this chapter - the "first
    /// page of chapter" shortcut from the epic's design doc. Pages *before* this chapter's first
    /// page are left untouched, even if they had no chapter before.</summary>
    Task<DigitizationState> SetFirstPageAsync(int bookId, string chapterId, string pageId, CancellationToken ct = default);
}
