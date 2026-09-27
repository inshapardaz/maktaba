using Maktaba.Core.Entities;

namespace Maktaba.Core.Services;

/// <summary>
/// The write-side entry point for a book's digitization workflow (epic #162) - reads/writes
/// digitization.json via IDigitizationJsonStore and keeps the DigitizationPage/Chapter cache rows
/// in sync, the same "durable file + rebuildable DB cache" relationship LibraryRescanService has to
/// Book rows. Only <see cref="StartAsync"/>/<see cref="GetStateAsync"/> are implemented in Phase 0
/// (the "Digitize" entry point's own needs) - the rest are scaffolded here so later phases (1-7) can
/// implement them without changing this interface, per the epic's own phase breakdown.
/// </summary>
public interface IDigitizationService
{
    /// <summary>Starts digitizing <paramref name="bookId"/>: creates digitization.json (if one
    /// doesn't already exist) with no pages yet and <see cref="Entities.BookDigitizationStatus.Pending"/>,
    /// and rebuilds its DigitizationPage/Chapter rows (none, on a fresh start). Actual PDF
    /// rasterization into pages/ is Phase 1's job (<c>IDigitizationService.StartAsync</c>'s
    /// caller-visible contract here is just "digitization.json now exists"), invoked separately once
    /// this returns. Re-starting an already-in-progress digitization is idempotent: the existing
    /// digitization.json's <paramref name="isRightToLeft"/> is left untouched (see the entry point's
    /// own confirm-before-restart UX) rather than reset.</summary>
    Task<DigitizationState> StartAsync(int bookId, bool isRightToLeft, CancellationToken ct = default);

    /// <summary>Null if the book has no digitization.json (never started).</summary>
    Task<DigitizationState?> GetStateAsync(int bookId, CancellationToken ct = default);

    /// <summary>Phase 2. Renumbers pages (and renames their image/text files to match, per the
    /// epic's "page number is the filename" amendment) to the order given.</summary>
    Task ReorderPagesAsync(int bookId, IReadOnlyList<string> pageIdsInOrder, CancellationToken ct = default);

    /// <summary>Phase 2.</summary>
    Task BulkSetStatusAsync(int bookId, IReadOnlyList<string> pageIds, PageEditStatus status, CancellationToken ct = default);

    /// <summary>Phase 2/4.</summary>
    Task BulkSetChapterAsync(int bookId, IReadOnlyList<string> pageIds, string? chapterId, CancellationToken ct = default);

    /// <summary>Phase 2.</summary>
    Task DeletePagesAsync(int bookId, IReadOnlyList<string> pageIds, CancellationToken ct = default);

    /// <summary>Phase 5. Writes a page's Markdown text file and updates its cached DB copy.</summary>
    Task SavePageTextAsync(int bookId, string pageId, string text, CancellationToken ct = default);

    /// <summary>Phase 6. Runs Google Vision OCR against a page's image, overwriting any existing
    /// text on that page (no confirmation - see the epic's "already decided" appendix), and returns
    /// the recognized text.</summary>
    Task<string> RunOcrAsync(int bookId, string pageId, CancellationToken ct = default);
}
