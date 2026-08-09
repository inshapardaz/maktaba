namespace Maktaba.Core.Entities;

public class Identifier
{
    public Guid Id { get; set; } = Guid.NewGuid();

    public Guid BookId { get; set; }
    public Book Book { get; set; } = null!;

    /// <summary>e.g. "isbn", "asin", "doi".</summary>
    public string Scheme { get; set; } = string.Empty;

    public string Value { get; set; } = string.Empty;
}
