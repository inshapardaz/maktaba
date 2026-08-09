namespace Maktaba.Core.Entities;

public enum BookFormat
{
    Epub,
    Pdf,
}

public class BookFile
{
    public int Id { get; set; }

    public int BookId { get; set; }
    public Book Book { get; set; } = null!;

    public BookFormat Format { get; set; }

    /// <summary>Path to this file, relative to the library root.</summary>
    public string FilePath { get; set; } = string.Empty;

    public long FileSizeBytes { get; set; }

    /// <summary>SHA-256 hash of the file contents, hex-encoded.</summary>
    public string ContentHash { get; set; } = string.Empty;
}
