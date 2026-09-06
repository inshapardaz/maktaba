using DocumentFormat.OpenXml.Packaging;
using DocumentFormat.OpenXml.Wordprocessing;

namespace Maktaba.Metadata;

/// <summary>Shared body-text extraction for .docx, used by both the metadata extractor (word count
/// for the page-count estimate) and the reader's plain-text content extractor.</summary>
internal static class DocxTextExtractor
{
    public static IReadOnlyList<string> ExtractParagraphs(string filePath)
    {
        using var doc = WordprocessingDocument.Open(filePath, isEditable: false);
        var body = doc.MainDocumentPart?.Document.Body;
        if (body is null)
        {
            return [];
        }

        return body.Elements<Paragraph>()
            .Select(p => p.InnerText.Trim())
            .Where(text => text.Length > 0)
            .ToList();
    }
}
