namespace Maktaba.Core.Entities;

public class Book
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public string Title { get; set; } = string.Empty;
    public string SortTitle { get; set; } = string.Empty;
    public string? Description { get; set; }
    public string? Language { get; set; }
    public string? Publisher { get; set; }
    public DateOnly? DatePublished { get; set; }
    public DateTime DateAdded { get; set; } = DateTime.UtcNow;
    public int Rating { get; set; }

    /// <summary>Path to this book's folder, relative to the library root.</summary>
    public string FolderPath { get; set; } = string.Empty;

    public List<BookAuthor> BookAuthors { get; set; } = [];
    public List<BookSeries> BookSeries { get; set; } = [];
    public List<BookTag> BookTags { get; set; } = [];
    public List<BookFile> Files { get; set; } = [];
    public List<Identifier> Identifiers { get; set; } = [];
}
