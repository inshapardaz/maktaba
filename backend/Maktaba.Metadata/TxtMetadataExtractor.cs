using Maktaba.Core.Services;

namespace Maktaba.Metadata;

public class TxtMetadataExtractor : IBookMetadataExtractor
{
    // Same rough print-page rule of thumb as EpubMetadataExtractor/DocxMetadataExtractor.
    private const int WordsPerEstimatedPage = 275;

    public bool CanHandle(string filePath) =>
        string.Equals(Path.GetExtension(filePath), ".txt", StringComparison.OrdinalIgnoreCase);

    public async Task<ExtractedBookMetadata> ExtractAsync(string filePath, CancellationToken ct = default)
    {
        // Plain text has no metadata fields at all (no title/author/language) - the filename is the
        // only signal available, same fallback EPUB/PDF use when their own metadata is missing.
        var title = Path.GetFileNameWithoutExtension(filePath);

        var text = await File.ReadAllTextAsync(filePath, ct);
        var wordCount = text.Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries).Length;

        return new ExtractedBookMetadata(
            Title: title,
            Authors: [],
            Language: null,
            Publisher: null,
            PublishedDate: null,
            Description: null,
            Identifiers: [],
            CoverImageBytes: null,
            CoverContentType: null,
            PageCount: wordCount > 0 ? Math.Max(1, (int)Math.Round(wordCount / (double)WordsPerEstimatedPage)) : null);
    }
}
