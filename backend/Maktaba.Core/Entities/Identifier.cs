namespace Maktaba.Core.Entities;

public class Identifier
{
    public int Id { get; set; }

    public int BookId { get; set; }
    public Book Book { get; set; } = null!;

    /// <summary>e.g. "isbn", "asin", "doi".</summary>
    public string Scheme { get; set; } = string.Empty;

    public string Value { get; set; } = string.Empty;
}
