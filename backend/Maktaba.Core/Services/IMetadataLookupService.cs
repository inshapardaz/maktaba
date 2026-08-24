namespace Maktaba.Core.Services;

public record MetadataSearchResult(
    string Key, string Title, IReadOnlyList<string> Authors, int? FirstPublishYear, string? CoverUrl, string? Isbn);

public record MetadataDetails(
    string Title,
    IReadOnlyList<string> Authors,
    string? Description,
    string? Publisher,
    DateOnly? PublishedDate,
    string? Isbn);

/// <summary>
/// Issue #24: "find book metadata online, pick a match, copy it into the book" - implemented
/// against Open Library's free, key-less public API rather than Goodreads', which Goodreads shut
/// down to new API consumers in December 2020 and has no supported replacement for; scraping
/// goodreads.com directly would violate its Terms of Service, so this substitutes a legitimate
/// equivalent data source serving the same user-facing feature.
/// </summary>
public interface IMetadataLookupService
{
    Task<IReadOnlyList<MetadataSearchResult>> SearchAsync(string title, CancellationToken ct = default);

    Task<MetadataDetails?> GetDetailsAsync(string key, string? isbn, CancellationToken ct = default);
}
