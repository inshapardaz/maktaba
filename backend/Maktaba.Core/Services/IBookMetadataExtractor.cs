namespace Maktaba.Core.Services;

public record ExtractedIdentifier(string Scheme, string Value);

public record ExtractedBookMetadata(
    string Title,
    IReadOnlyList<string> Authors,
    string? Language,
    string? Publisher,
    DateOnly? PublishedDate,
    string? Description,
    IReadOnlyList<ExtractedIdentifier> Identifiers,
    byte[]? CoverImageBytes,
    string? CoverContentType
);

/// <summary>Extracts metadata and a cover image from a single ebook file. One implementation per format.</summary>
public interface IBookMetadataExtractor
{
    bool CanHandle(string filePath);

    Task<ExtractedBookMetadata> ExtractAsync(string filePath, CancellationToken ct = default);
}
