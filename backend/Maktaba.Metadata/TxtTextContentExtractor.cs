using System.Text.RegularExpressions;
using Maktaba.Core.Services;

namespace Maktaba.Metadata;

/// <summary>Feeds a plain-text file to qari as a Markdown source. Most .txt files are hard-wrapped
/// at a fixed column, so a naive pass-through would render every wrapped line as its own paragraph;
/// this reflows single line breaks within a paragraph into spaces and only keeps blank-line-
/// separated breaks, matching how a word processor would display the same text.</summary>
public partial class TxtTextContentExtractor : IBookTextContentExtractor
{
    public bool CanHandle(string filePath) =>
        string.Equals(Path.GetExtension(filePath), ".txt", StringComparison.OrdinalIgnoreCase);

    public async Task<string> ExtractAsync(string filePath, CancellationToken ct = default)
    {
        var text = await File.ReadAllTextAsync(filePath, ct);

        var paragraphs = BlankLineRegex().Split(text)
            .Select(p => SingleNewlineRegex().Replace(p, " ").Trim())
            .Where(p => p.Length > 0);

        return string.Join("\n\n", paragraphs);
    }

    [GeneratedRegex(@"\r?\n\s*\r?\n")]
    private static partial Regex BlankLineRegex();

    [GeneratedRegex(@"\r?\n")]
    private static partial Regex SingleNewlineRegex();
}
