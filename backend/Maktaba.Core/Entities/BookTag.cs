namespace Maktaba.Core.Entities;

public class BookTag
{
    public Guid BookId { get; set; }
    public Book Book { get; set; } = null!;

    public Guid TagId { get; set; }
    public Tag Tag { get; set; } = null!;
}
