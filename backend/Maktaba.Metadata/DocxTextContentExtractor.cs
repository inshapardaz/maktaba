using Maktaba.Core.Services;

namespace Maktaba.Metadata;

/// <summary>Feeds a DOCX's body text to qari as a Markdown source, since qari has no native DOCX
/// parser - paragraph breaks are all that's preserved, not run-level formatting.</summary>
public class DocxTextContentExtractor : IBookTextContentExtractor
{
    public bool CanHandle(string filePath) =>
        string.Equals(Path.GetExtension(filePath), ".docx", StringComparison.OrdinalIgnoreCase);

    public Task<string> ExtractAsync(string filePath, CancellationToken ct = default)
    {
        var paragraphs = DocxTextExtractor.ExtractParagraphs(filePath);
        return Task.FromResult(string.Join("\n\n", paragraphs));
    }
}
