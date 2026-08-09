namespace Maktaba.Core.Entities;

public class BookAuthor
{
    public Guid BookId { get; set; }
    public Book Book { get; set; } = null!;

    public Guid AuthorId { get; set; }
    public Author Author { get; set; } = null!;

    /// <summary>Author credit order on the book (0 = first-listed).</summary>
    public int Order { get; set; }
}
