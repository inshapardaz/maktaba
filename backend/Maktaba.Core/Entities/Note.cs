namespace Maktaba.Core.Entities;

public class Note
{
    public int Id { get; set; }

    public int BookId { get; set; }
    public Book Book { get; set; } = null!;

    /// <summary>The reader's own client-generated id (crypto.randomUUID()) - the identity qari's
    /// noteAdapter save/remove calls operate on, distinct from our internal auto-increment Id.</summary>
    public string ClientId { get; set; } = string.Empty;

    public string ChapterId { get; set; } = string.Empty;
    public int StartOffset { get; set; }
    public int EndOffset { get; set; }

    /// <summary>The highlighted excerpt of book text this note anchors to.</summary>
    public string Text { get; set; } = string.Empty;
    public string? Comment { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime? UpdatedAt { get; set; }
}
