namespace Maktaba.Api.Dtos;

// Bookmark/note ids here are the reader's own client-generated ids (qari's crypto.randomUUID()),
// not sqid-encoded database primary keys - see Maktaba.Core.Entities.Bookmark/Note's ClientId.

public record BookmarkDto(
    string Id,
    string ChapterId,
    double Position,
    string Name,
    DateTime CreatedAt,
    DateTime? UpdatedAt
);

public record SaveBookmarkRequestDto(
    string ChapterId,
    double Position,
    string Name,
    DateTime CreatedAt,
    DateTime? UpdatedAt
);

public record NoteDto(
    string Id,
    string ChapterId,
    int StartOffset,
    int EndOffset,
    string Text,
    string? Comment,
    DateTime CreatedAt,
    DateTime? UpdatedAt
);

public record SaveNoteRequestDto(
    string ChapterId,
    int StartOffset,
    int EndOffset,
    string Text,
    string? Comment,
    DateTime CreatedAt,
    DateTime? UpdatedAt
);

// CurrentChapter/TotalChapters/CurrentPage/TotalPages/ChapterTitle/Percentage are the
// display-friendly snapshot (fed by the reader's onProgressChange, shown in BookDetailPanel).
// ChapterId/Position are the reader's own resume anchor (fed by its progressAdapter, opaque to
// us - qari resolves them back to a page on its own when it reopens the book). Both live on the
// same one-row-per-book record but are written independently, so both DTOs below are nullable and
// PUT is a partial merge - see ReaderDataEndpoints.MapReaderDataEndpoints's /progress handler.
public record ReadingProgressDto(
    int CurrentChapter,
    int TotalChapters,
    int CurrentPage,
    int TotalPages,
    string? ChapterTitle,
    double Percentage,
    string? ChapterId,
    double? Position,
    DateTime UpdatedAt
);

public record SaveReadingProgressRequestDto(
    int? CurrentChapter,
    int? TotalChapters,
    int? CurrentPage,
    int? TotalPages,
    string? ChapterTitle,
    double? Percentage,
    string? ChapterId,
    double? Position
);
