using Maktaba.Core.Services;
using PDFtoImage;
using SkiaSharp;
using UglyToad.PdfPig;

namespace Maktaba.Metadata;

public class PdfMetadataExtractor : IBookMetadataExtractor
{
    private static readonly string[] AuthorSeparators = [";", " and ", "&"];

    public bool CanHandle(string filePath) =>
        string.Equals(Path.GetExtension(filePath), ".pdf", StringComparison.OrdinalIgnoreCase);

    public Task<ExtractedBookMetadata> ExtractAsync(string filePath, CancellationToken ct = default)
    {
        using var document = PdfDocument.Open(filePath);
        var info = document.Information;

        var title = string.IsNullOrWhiteSpace(info.Title)
            ? Path.GetFileNameWithoutExtension(filePath)
            : info.Title.Trim();

        var (coverBytes, coverContentType) = TryRenderFirstPageCover(filePath);

        var metadata = new ExtractedBookMetadata(
            Title: title,
            Authors: SplitAuthors(info.Author),
            // The standard PDF info dictionary has no publisher/language fields, unlike EPUB's OPF metadata.
            Language: null,
            Publisher: null,
            PublishedDate: TryParsePdfDate(info.CreationDate),
            Description: string.IsNullOrWhiteSpace(info.Subject) ? null : info.Subject.Trim(),
            Identifiers: [],
            CoverImageBytes: coverBytes,
            CoverContentType: coverContentType);

        return Task.FromResult(metadata);
    }

    private static (byte[]? Bytes, string? ContentType) TryRenderFirstPageCover(string filePath)
    {
        try
        {
            var pdfBytes = File.ReadAllBytes(filePath);
            using var bitmap = Conversion.ToImage(
                pdfBytes, 0, password: null, options: new RenderOptions(Width: 600, WithAspectRatio: true));
            using var encoded = bitmap.Encode(SKEncodedImageFormat.Jpeg, quality: 85);
            return (encoded.ToArray(), "image/jpeg");
        }
        catch (Exception)
        {
            // Encrypted/malformed/zero-page PDFs can fail to rasterize; import proceeds without a cover.
            return (null, null);
        }
    }

    private static IReadOnlyList<string> SplitAuthors(string? rawAuthor)
    {
        if (string.IsNullOrWhiteSpace(rawAuthor))
        {
            return [];
        }

        var parts = rawAuthor.Split(
            AuthorSeparators, StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
        return parts.Length > 0 ? parts : [rawAuthor.Trim()];
    }

    private static DateOnly? TryParsePdfDate(string? rawDate)
    {
        if (string.IsNullOrWhiteSpace(rawDate))
        {
            return null;
        }

        // PDF date format: "D:YYYYMMDDHHmmSS[+-]HH'mm'" (ISO 32000-1 §7.9.4).
        var value = rawDate.StartsWith("D:", StringComparison.Ordinal) ? rawDate[2..] : rawDate;
        if (value.Length >= 8 &&
            int.TryParse(value[..4], out var year) &&
            int.TryParse(value.Substring(4, 2), out var month) &&
            int.TryParse(value.Substring(6, 2), out var day))
        {
            try
            {
                return new DateOnly(year, month, day);
            }
            catch (ArgumentOutOfRangeException)
            {
                return null;
            }
        }

        return DateTime.TryParse(value, out var parsed) ? DateOnly.FromDateTime(parsed) : null;
    }
}
