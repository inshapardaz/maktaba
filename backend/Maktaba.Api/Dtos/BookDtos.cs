namespace Maktaba.Api.Dtos;

// Every id below is a sqids.org-encoded string (see Maktaba.Core.Ids.IdCodec), not the database's
// internal integer primary key - encoding/decoding at this API boundary is what all the "sqid"-named
// helper params in Endpoints/ are for.

public record BookSummaryDto(
    string Id,
    string Title,
    string SortTitle,
    string[] Authors,
    // Same author names as Authors, but with id + photo presence (issue #28) - lets the Home view's
    // recently-added shelf/grid rows show an author avatar without a separate request per book.
    AuthorRefDto[] AuthorRefs,
    int Rating,
    DateTime DateAdded,
    bool HasCover,
    string ReadingStatus,
    // Null unless the book belongs to a series / has ever had reading progress saved - lets the
    // frontend offer "series order" and "last read" as sort keys without a second request per book
    // (see App.tsx's sortBooks and FilterBar.tsx's SortKey).
    double? SeriesIndex,
    DateTime? LastReadAt,
    // Distinct formats this book has a file for (e.g. ["Epub", "Pdf"]) - lets BookGrid/BookList show
    // a split "Read" button and BookList show format badges without a per-row detail fetch, since
    // the actual per-file AbsolutePath is only needed once a specific format is chosen to open.
    string[] Formats,
    // Null unless this book is an issue of a Periodical (see Periodical.cs) - lets the frontend
    // render issue badges (volume/number/date) without a second request per book, same rationale
    // as SeriesIndex above.
    string? PeriodicalId,
    string? PeriodicalName,
    double? IssueNumber,
    int? VolumeNumber,
    DateOnly? IssueDate
);

// Powers the Home view's "continue reading" hero + "currently reading" list - one row per book
// that has ever had reading progress saved (see Maktaba.Core.Entities.ReadingProgress), regardless
// of its current ReadingStatus, ordered by UpdatedAt desc so the most recently read book is first.
public record ContinueReadingBookDto(
    string Id,
    string Title,
    string[] Authors,
    // Same rationale as BookSummaryDto.AuthorRefs - lets the Home view's continue-reading hero and
    // currently-reading rows show an author avatar without a separate request per book.
    AuthorRefDto[] AuthorRefs,
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

// Same author names as BookDetailDto.Authors, but with id + photo presence too (issue #28) - lets
// BookDetailPanel render each author as a pill with their photo, without a separate request per
// author. Kept as a second field (AuthorRefs) rather than changing Authors' shape, so
// BookSummaryDto/every list view that only needs plain names is untouched.
public record AuthorRefDto(string Id, string Name, bool HasImage);

public record BookFileDto(string Id, string Format, long FileSizeBytes, string AbsolutePath);

public record RenameBookFileRequestDto(string FileName);

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
    AuthorRefDto[] AuthorRefs,
    string? SeriesName,
    double? SeriesIndex,
    string[] Tags,
    IdentifierDto[] Identifiers,
    BookFileDto[] Files,
    bool HasCover,
    string ReadingStatus,
    BookCollectionDto[] Collections,
    string? PeriodicalId,
    string? PeriodicalName,
    double? IssueNumber,
    int? VolumeNumber,
    DateOnly? IssueDate,
    // Issue #23: actual time spent reading this book, plus a self-calibrated total/remaining
    // estimate (null until enough progress exists to extrapolate from - see ReadingTimeEstimator).
    int SecondsRead,
    int? ExpectedTotalSeconds,
    int? RemainingSeconds
);

/// <summary>DuplicateAction: null (ask) | "skip" | "keep-both" | "merge".</summary>
public record ImportBookRequest(string FilePath, string? DuplicateAction = null);

// BookDetailPanel's "add another file" action - attaches an extra format to an already-existing
// book, distinct from ImportBookRequest above which always considers creating a brand new book.
public record AddBookFileRequest(string FilePath);

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
    string[] CollectionIds,
    string? PeriodicalId = null,
    double? IssueNumber = null,
    int? VolumeNumber = null,
    DateOnly? IssueDate = null
);

public record UpdateBookStatusRequestDto(string ReadingStatus);

public record ConvertBookRequestDto(string TargetFormat);

public record SystemCapabilitiesDto(bool CalibreAvailable);

public record OpenLibraryRequest(string Path);

public record LibraryDto(string Path, string Id, string Name, bool PeriodicalsEnabled);

public record LibraryEntryDto(string Id, string Name, string Path, bool IsActive, bool PeriodicalsEnabled);

public record RenameLibraryRequestDto(string Name);

public record RelocateLibraryRequestDto(string Path);

public record SetPeriodicalsEnabledRequestDto(bool Enabled);

public record RescanProgressDto(bool IsRunning, int Processed, int Total, string? CurrentBook);

public record BrowseGroupDto(string Id, string Name, int BookCount, bool HasImage = false);

public record CreateCollectionRequestDto(string Name);

public record ReadingStatusCountDto(string Status, int Count);

public record RenameAuthorRequestDto(string Name);

public record RenameTagRequestDto(string Name);

public record RenameSeriesRequestDto(string Name);

public record PeriodicalDto(
    string Id,
    string Name,
    string? Description,
    string Frequency,
    string? Language,
    string? Publisher,
    string? Editor,
    string[] Tags,
    int IssueCount,
    bool HasCover
);

public record CreatePeriodicalRequestDto(
    string Name,
    string Frequency,
    string? Description,
    string? Language = null,
    string? Publisher = null,
    string? Editor = null,
    string[]? Tags = null
);

public record UpdatePeriodicalRequestDto(
    string Name,
    string Frequency,
    string? Description,
    string? Language,
    string? Publisher,
    string? Editor,
    string[] Tags
);

public record MetadataSearchResultDto(
    string Key, string Title, string[] Authors, int? FirstPublishYear, string? CoverUrl, string? Isbn);

public record MetadataDetailsDto(
    string Title, string[] Authors, string? Description, string? Publisher, DateOnly? PublishedDate, string? Isbn);

public record RecordReadingActivityRequestDto(int Seconds);

public record AnalyticsBookDto(
    string Id,
    string Title,
    string ReadingStatus,
    int SecondsRead,
    double Percentage,
    int? ExpectedTotalSeconds,
    int? RemainingSeconds
);

public record AnalyticsSummaryDto(
    int TotalSecondsRead,
    int UnreadCount,
    int UnreadExpectedSecondsTotal,
    int ReadingCount,
    int ReadingSecondsSpent,
    int ReadingSecondsRemaining,
    int FinishedCount,
    AnalyticsBookDto[] Books
);

// Issue #23 follow-up: "how much did I read, and when" - Daily/Weekly/Monthly are zero-filled,
// most-recent-last time series (Date/WeekStart are "yyyy-MM-dd", Month is "yyyy-MM"); ByDayOfWeek
// and ByHour are always all 7 / all 24 buckets in DayOfWeek(0=Sunday)/hour-of-day order regardless
// of which days/hours actually have data, so the frontend never has to fill gaps itself.
public record ReadingTimePointDto(string Date, int Seconds);

public record ReadingTimeWeekDto(string WeekStart, int Seconds);

public record ReadingTimeMonthDto(string Month, int Seconds);

public record ReadingTimeDayOfWeekDto(int DayOfWeek, int Seconds);

public record ReadingTimeHourDto(int Hour, int Seconds);

public record ReadingTimeReportDto(
    ReadingTimePointDto[] Daily,
    ReadingTimeWeekDto[] Weekly,
    ReadingTimeMonthDto[] Monthly,
    ReadingTimeDayOfWeekDto[] ByDayOfWeek,
    ReadingTimeHourDto[] ByHour,
    // Null only when there's no reading activity tracked at all yet.
    int? MostActiveDayOfWeek,
    int? MostActiveHour
);
