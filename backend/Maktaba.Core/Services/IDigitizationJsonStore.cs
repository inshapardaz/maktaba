namespace Maktaba.Core.Services;

/// <summary>One page entry in digitization.json (see IDigitizationJsonStore's own doc comment).
/// <paramref name="Image"/>/<paramref name="Text"/> are always "pages/{0000}.jpg"/"pages/{0000}.md",
/// derived from <paramref name="Order"/> at write time - never a free-form path (see the epic's
/// "page number is the filename" amendment).</summary>
public record DigitizationJsonPage(
    string Id,
    int Order,
    string Image,
    string? Text,
    string EditStatus,
    string? ChapterId,
    int? SourcePdfPage,
    string? SourceSpreadSide,
    int Rotation);

/// <summary>One chapter entry in digitization.json.</summary>
public record DigitizationJsonChapter(
    string Id,
    string Title,
    int Order,
    string? FirstPageId);

/// <summary>The full contents of a book's digitization.json - see the epic's design doc for the
/// on-disk shape this mirrors exactly (property names/casing match the checked-in JSON, since this
/// record is serialized/deserialized directly, with no separate DTO translation layer).</summary>
public record DigitizationState(
    int Version,
    string SourcePdf,
    bool IsRightToLeft,
    string Status,
    List<DigitizationJsonPage> Pages,
    List<DigitizationJsonChapter> Chapters)
{
    public const int CurrentVersion = 1;
}

/// <summary>
/// Reads/writes a book's digitization.json - the durable source of truth for its pages/chapters
/// (see the epic's "Hard requirement: zero impact on books that are never digitized" and "On-disk
/// layout addition" sections). MaktabaDbContext's DigitizationPage/Chapter
/// rows are a rebuildable cache over this file, the same way Book rows are a rebuildable cache over
/// the library's on-disk folder layout - see DigitizationRescanService, the thing that rebuilds
/// them from what this store reads.
///
/// Every method takes the book's own absolute folder path (not a bookId) since this store has no
/// dependency on MaktabaDbContext or IStorageProviderFactory at all - v1 is local-library-only (see
/// the epic's non-goals), so plain System.IO against that folder is all that's needed, matching
/// every other local-only shortcut this codebase already takes (see LibraryPathBuilder's callers).
/// </summary>
public interface IDigitizationJsonStore
{
    /// <summary>File name of digitization.json, relative to the book's own folder.</summary>
    const string FileName = "digitization.json";

    /// <summary>Null if the book's folder has no digitization.json at all - i.e. it's never been
    /// digitized (see the epic's zero-impact requirement). A malformed file is treated as absent
    /// rather than throwing, since a rescan should degrade gracefully, not fail the whole library.</summary>
    Task<DigitizationState?> ReadAsync(string absoluteBookFolderPath, CancellationToken ct = default);

    /// <summary>Writes digitization.json, creating the book's folder if somehow missing (it always
    /// exists already in practice - a book's folder is created at import time - but this mirrors
    /// the defensive Directory.CreateDirectory every other sidecar-file writer in this codebase uses,
    /// e.g. LibraryService's own config.json).</summary>
    Task WriteAsync(string absoluteBookFolderPath, DigitizationState state, CancellationToken ct = default);
}
