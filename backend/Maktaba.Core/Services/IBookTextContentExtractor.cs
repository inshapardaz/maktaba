namespace Maktaba.Core.Services;

/// <summary>
/// Extracts plain reading text from a book file for formats qari (the in-app reader) can't parse
/// natively - currently DOCX and TXT. The extracted text is handed to qari as a Markdown source
/// instead, so the result only needs to preserve paragraph breaks, not original formatting.
/// </summary>
public interface IBookTextContentExtractor
{
    bool CanHandle(string filePath);

    Task<string> ExtractAsync(string filePath, CancellationToken ct = default);
}
