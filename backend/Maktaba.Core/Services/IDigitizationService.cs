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

    /// <summary>Phase 3 (Page Image Editing) - not in the epic's original interface list, added
    /// here since crop/rotate/re-split are simple per-page operations on this same service. All
    /// three bake the transform directly into the page's jpg (destructive) rather than persisting a
    /// crop-rect/rotation to reapply later - see DigitizationService's own doc comment on why.
    /// Rotates by an arbitrary angle (not just 90° multiples), expanding the canvas so nothing is
    /// clipped.</summary>
    Task RotatePageAsync(int bookId, string pageId, double degrees, CancellationToken ct = default);

    /// <summary>Phase 3. Crops to the given fraction (0..1) of the page's *current* image (after
    /// any prior rotate/crop already applied).</summary>
    Task CropPageAsync(int bookId, string pageId, double x, double y, double width, double height, CancellationToken ct = default);

    /// <summary>Phase 3. Splits a single page's current image into two at <paramref
    /// name="splitRatio"/> (0..1, the left portion's width share), inserting the new right-hand page
    /// immediately after and renumbering every following page - covers "auto-detect said this
    /// wasn't a spread but it was" (issue #180). The reverse ("undo an incorrect split" - merging
    /// two already-separate pages back into one before re-splitting) isn't implemented; see the
    /// implementation's own doc comment.</summary>
    Task<DigitizationState> SplitPageAsync(int bookId, string pageId, double splitRatio, CancellationToken ct = default);

    /// <summary>Phase 5. Writes a page's Markdown text file and updates its cached DB copy.</summary>
    Task SavePageTextAsync(int bookId, string pageId, string text, CancellationToken ct = default);

    /// <summary>Phase 6. Runs Google Vision OCR against a page's image, overwriting any existing
    /// text on that page (no confirmation - see the epic's "already decided" appendix), and returns
    /// the recognized text.</summary>
    Task<string> RunOcrAsync(int bookId, string pageId, CancellationToken ct = default);

    /// <summary>Phase 7 (Merge Pages into Chapters, issue #192) - the "Merge into chapters" action's
    /// gate: throws InvalidOperationException (with a human-readable reason) unless every page has
    /// a chapter assigned and every page's EditStatus is Complete. On success, sets
    /// BookDigitizationStatus to ChapterProofRead (see that enum's own doc comment on what each
    /// transition means) - the actual merged Markdown is computed on demand by
    /// IChapterMergeService, not stored here.</summary>
    Task<DigitizationState> ConfirmChapterMergeAsync(int bookId, CancellationToken ct = default);
}
