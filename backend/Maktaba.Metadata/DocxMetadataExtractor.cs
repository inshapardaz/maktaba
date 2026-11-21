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

    // Office wraps a password-protected .docx in a legacy OLE compound file (MS-OFFCRYPTO), so it's
    // not actually a zip - WordprocessingDocument.Open can't read it. This is that container's fixed
    // 8-byte signature; checking for it up front avoids trying (and failing) to open the file.
    private static readonly byte[] CompoundFileSignature = [0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1];

    public Task<ExtractedBookMetadata> ExtractAsync(string filePath, CancellationToken ct = default)
    {
        if (IsPasswordProtected(filePath))
        {
            return Task.FromResult(FilenameOnlyMetadata(filePath));
        }

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

    private static bool IsPasswordProtected(string filePath)
    {
        using var stream = File.OpenRead(filePath);
        Span<byte> header = stackalloc byte[CompoundFileSignature.Length];
        return stream.Read(header) == header.Length && header.SequenceEqual(CompoundFileSignature);
    }

    private static ExtractedBookMetadata FilenameOnlyMetadata(string filePath) => new(
        Title: Path.GetFileNameWithoutExtension(filePath),
        Authors: [],
        Language: null,
        Publisher: null,
        PublishedDate: null,
        Description: null,
        Identifiers: [],
        CoverImageBytes: null,
        CoverContentType: null,
        PageCount: null);
}
