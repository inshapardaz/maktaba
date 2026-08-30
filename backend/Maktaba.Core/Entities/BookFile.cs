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

    // Issue #27: once a user explicitly renames a file (see BookEndpoints' PATCH .../files/{fileId}/name),
    // BookFolderRelocator preserves that name across future folder moves instead of silently
    // overwriting it back to the title-derived name on the next title/author edit.
    public bool IsCustomNamed { get; set; }
}
