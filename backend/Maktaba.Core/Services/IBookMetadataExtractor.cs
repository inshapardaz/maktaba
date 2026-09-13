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
    string? CoverContentType,
    // Issue #67: exact for PDF, an estimate for EPUB - see Book.PageCount.
    int? PageCount = null
);

/// <summary>
/// Extracts metadata and a cover image from a single ebook file. One implementation per format.
/// <paramref name="filePath"/> (here and on <see cref="IBookTextContentExtractor"/>) is always a
/// plain local path, never a remote URI or stream - deliberately, per the "local cache mirror"
/// design: every caller resolves a library-relative path to a local path via
/// IStorageProvider.GetLocalPathAsync first (ImportService, BookEditService.ExtractCoverAsync,
/// LibraryRescanService), so extractors - including EpubMetadataExtractor's VersOne.Epub.EpubReader,
/// which only supports reading from a local path - never need a streaming/remote-aware overload.
/// </summary>
public interface IBookMetadataExtractor
{
    bool CanHandle(string filePath);

    Task<ExtractedBookMetadata> ExtractAsync(string filePath, CancellationToken ct = default);
}
