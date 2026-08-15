namespace Maktaba.Api.Dtos;

// Every id below is a sqids.org-encoded string (see Maktaba.Core.Ids.IdCodec), not the database's
// internal integer primary key - encoding/decoding at this API boundary is what all the "sqid"-named
// helper params in Endpoints/ are for.

public record BookSummaryDto(
    string Id,
    string Title,
    string SortTitle,
    string[] Authors,
    int Rating,
    DateTime DateAdded,
    bool HasCover,
    string ReadingStatus,
    // Null unless the book belongs to a series / has ever had reading progress saved - lets the
    // frontend offer "series order" and "last read" as sort keys without a second request per book
    // (see App.tsx's sortBooks and FilterBar.tsx's SortKey).
    double? SeriesIndex,
    DateTime? LastReadAt
);

// Powers the Home view's "continue reading" hero + "currently reading" list - one row per book
// that has ever had reading progress saved (see Maktaba.Core.Entities.ReadingProgress), regardless
// of its current ReadingStatus, ordered by UpdatedAt desc so the most recently read book is first.
public record ContinueReadingBookDto(
    string Id,
    string Title,
    string[] Authors,
    bool HasCover,
    string ReadingStatus,
    string Format,
    // Lets the frontend's "open with external app" reader-engine setting bypass the in-app reader
    // entirely from the Home view too, not just from BookDetailPanel's files list.
    string AbsolutePath,
    double Percentage,
    DateTime UpdatedAt
);

public record IdentifierDto(string Scheme, string Value);

public record BookFileDto(string Format, long FileSizeBytes, string AbsolutePath);

public record BookCollectionDto(string Id, string Name);

public record BookDetailDto(
    string Id,
    string Title,
    string SortTitle,
    string? Description,
    string? Language,
    string? Publisher,
    DateOnly? DatePublished,
    int Rating,
    DateTime DateAdded,
    string[] Authors,
    string? SeriesName,
    double? SeriesIndex,
    string[] Tags,
    IdentifierDto[] Identifiers,
    BookFileDto[] Files,
    bool HasCover,
    string ReadingStatus,
    BookCollectionDto[] Collections
);

/// <summary>DuplicateAction: null (ask) | "skip" | "keep-both" | "merge".</summary>
public record ImportBookRequest(string FilePath, string? DuplicateAction = null);

public record DuplicateBookDto(string ExistingBookId, string ExistingTitle, string[] ExistingAuthors, bool SameContentHash);

public record BookEditRequestDto(
    string Title,
    string[] Authors,
    string? Language,
    string? Publisher,
    DateOnly? PublishedDate,
    string? Description,
    int Rating,
    string? SeriesName,
    double? SeriesIndex,
    string[] Tags,
    string[] CollectionIds
);

public record UpdateBookStatusRequestDto(string ReadingStatus);

public record ConvertBookRequestDto(string TargetFormat);

public record SystemCapabilitiesDto(bool CalibreAvailable);

public record OpenLibraryRequest(string Path);

public record LibraryDto(string Path);

public record LibraryEntryDto(string Id, string Name, string Path, bool IsActive);

public record RenameLibraryRequestDto(string Name);

public record RelocateLibraryRequestDto(string Path);

public record RescanProgressDto(bool IsRunning, int Processed, int Total, string? CurrentBook);

public record BrowseGroupDto(string Id, string Name, int BookCount);

public record CreateCollectionRequestDto(string Name);

public record ReadingStatusCountDto(string Status, int Count);

public record RenameAuthorRequestDto(string Name);

public record RenameTagRequestDto(string Name);

public record RenameSeriesRequestDto(string Name);
