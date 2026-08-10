namespace Maktaba.Core.Entities;

public class BookCollection
{
    public int BookId { get; set; }
    public Book Book { get; set; } = null!;

    public int CollectionId { get; set; }
    public Collection Collection { get; set; } = null!;
}
