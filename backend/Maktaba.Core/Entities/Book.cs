namespace Maktaba.Core.Entities;

public enum ReadingStatus
{
    Unread,
    Reading,
    Finished,
}

public class Book
{
    public int Id { get; set; }
    public string Title { get; set; } = string.Empty;
    public string SortTitle { get; set; } = string.Empty;
    public string? Description { get; set; }
    public string? Language { get; set; }
    public string? Publisher { get; set; }
    public DateOnly? DatePublished { get; set; }
    public DateTime DateAdded { get; set; } = DateTime.UtcNow;
    public int Rating { get; set; }
    public ReadingStatus ReadingStatus { get; set; } = ReadingStatus.Unread;

    // Issue #67: exact for PDF (PdfPig's NumberOfPages); an estimate for EPUB (no true page concept
    // in a reflowable format - see EpubMetadataExtractor's word-count heuristic). Null if extraction
    // couldn't determine one. Set once, at import/new-book-rescan time only - see LibraryRescanService's
    // PreviousBookState, which preserves it across rescans like every other file-derived field.
    public int? PageCount { get; set; }

    /// <summary>Path to this book's folder, relative to the library root.</summary>
    public string FolderPath { get; set; } = string.Empty;

    // An "Issue" is just a Book with this set - see Periodical.cs and BookFolderRelocator, which
    // branches on PeriodicalId to organize on-disk by periodical instead of by author.
    public int? PeriodicalId { get; set; }
    public Periodical? Periodical { get; set; }
    public double? IssueNumber { get; set; }
    public int? VolumeNumber { get; set; }
    public DateOnly? IssueDate { get; set; }

    public List<BookAuthor> BookAuthors { get; set; } = [];
    public List<BookSeries> BookSeries { get; set; } = [];
    public List<BookTag> BookTags { get; set; } = [];
    public List<BookCollection> BookCollections { get; set; } = [];
    public List<BookFile> Files { get; set; } = [];
    public List<Identifier> Identifiers { get; set; } = [];
}
