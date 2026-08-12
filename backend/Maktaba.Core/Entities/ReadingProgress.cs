namespace Maktaba.Core.Entities;

/// <summary>One row per book - genuinely 1:1, so BookId is the primary key directly rather than a
/// separate auto-increment Id.</summary>
public class ReadingProgress
{
    public int BookId { get; set; }
    public Book Book { get; set; } = null!;

    public int CurrentChapter { get; set; }
    public int TotalChapters { get; set; }
    public int CurrentPage { get; set; }
    public int TotalPages { get; set; }
    public string? ChapterTitle { get; set; }
    public double Percentage { get; set; }

    /// <summary>The reader's own resume anchor (qari's chapterId + a within-chapter character
    /// offset) - distinct from CurrentChapter/CurrentPage above, which are display-only numbers
    /// derived separately. Null until the reader's progressAdapter has saved at least once.</summary>
    public string? ChapterId { get; set; }
    public double? Position { get; set; }

    public DateTime UpdatedAt { get; set; }
}
