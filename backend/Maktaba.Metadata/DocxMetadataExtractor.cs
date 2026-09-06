using DocumentFormat.OpenXml.Packaging;
using Maktaba.Core.Services;

namespace Maktaba.Metadata;

public class DocxMetadataExtractor : IBookMetadataExtractor
{
    // Same rough print-page rule of thumb as EpubMetadataExtractor - DOCX has no fixed page count
    // either (that depends on the reading application's own layout/font choices).
    private const int WordsPerEstimatedPage = 275;

    public bool CanHandle(string filePath) =>
        string.Equals(Path.GetExtension(filePath), ".docx", StringComparison.OrdinalIgnoreCase);

    public Task<ExtractedBookMetadata> ExtractAsync(string filePath, CancellationToken ct = default)
    {
        using var doc = WordprocessingDocument.Open(filePath, isEditable: false);
        var props = doc.PackageProperties;

        var title = string.IsNullOrWhiteSpace(props.Title)
            ? Path.GetFileNameWithoutExtension(filePath)
            : props.Title.Trim();

        IReadOnlyList<string> authors = string.IsNullOrWhiteSpace(props.Creator)
            ? []
            : props.Creator.Split([';', ','], StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);

        var paragraphs = DocxTextExtractor.ExtractParagraphs(filePath);
        var wordCount = paragraphs.Sum(p => p.Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries).Length);

        var metadata = new ExtractedBookMetadata(
            Title: title,
            Authors: authors,
            Language: props.Language,
            Publisher: null,
            PublishedDate: props.Created.HasValue ? DateOnly.FromDateTime(props.Created.Value) : null,
            Description: string.IsNullOrWhiteSpace(props.Description) ? null : props.Description.Trim(),
            Identifiers: [],
            CoverImageBytes: null,
            CoverContentType: null,
            PageCount: wordCount > 0 ? Math.Max(1, (int)Math.Round(wordCount / (double)WordsPerEstimatedPage)) : null);

        return Task.FromResult(metadata);
    }
}
