namespace Maktaba.Core.Entities;

public class Bookmark
{
    public int Id { get; set; }

    public int BookId { get; set; }
    public Book Book { get; set; } = null!;

    /// <summary>The reader's own client-generated id (crypto.randomUUID()) - the identity qari's
    /// bookmarkAdapter save/remove calls operate on, distinct from our internal auto-increment Id.</summary>
    public string ClientId { get; set; } = string.Empty;

    public string ChapterId { get; set; } = string.Empty;
    public double Position { get; set; }
    public string Name { get; set; } = string.Empty;
    public DateTime CreatedAt { get; set; }
    public DateTime? UpdatedAt { get; set; }
}
