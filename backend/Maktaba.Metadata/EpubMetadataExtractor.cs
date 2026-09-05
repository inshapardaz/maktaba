using System.Globalization;
using System.Text.RegularExpressions;
using Maktaba.Core.Services;
using VersOne.Epub;

namespace Maktaba.Metadata;

public partial class EpubMetadataExtractor : IBookMetadataExtractor
{
    // Issue #67: EPUB is reflowable and has no real "page" concept, unlike PDF - this is a rough
    // print-page equivalent (the commonly-cited ~250-300 words/printed-page rule of thumb) derived
    // from the book's total word count, not an exact figure.
    private const int WordsPerEstimatedPage = 275;

    public bool CanHandle(string filePath) =>
        string.Equals(Path.GetExtension(filePath), ".epub", StringComparison.OrdinalIgnoreCase);

    public async Task<ExtractedBookMetadata> ExtractAsync(string filePath, CancellationToken ct = default)
    {
        var book = await EpubReader.ReadBookAsync(filePath);
        var opfMetadata = book.Schema.Package.Metadata;

        var title = string.IsNullOrWhiteSpace(book.Title)
            ? Path.GetFileNameWithoutExtension(filePath)
            : book.Title;

        var authors = book.AuthorList
            .Where(a => !string.IsNullOrWhiteSpace(a))
            .ToList();

        var publisher = opfMetadata.Publishers.FirstOrDefault()?.Publisher;
        var language = opfMetadata.Languages.FirstOrDefault()?.Language;
        var publishedDate = opfMetadata.Dates
            .Select(d => TryParseDate(d.Date))
            .FirstOrDefault(d => d is not null);

        var identifiers = opfMetadata.Identifiers
            .Where(i => !string.IsNullOrWhiteSpace(i.Identifier))
            .Select(i => new ExtractedIdentifier(
                string.IsNullOrWhiteSpace(i.Scheme) ? "unknown" : i.Scheme.ToLowerInvariant(),
                i.Identifier))
            .ToList();

        var cover = book.Content.Cover;

        return new ExtractedBookMetadata(
            Title: title,
            Authors: authors,
            Language: language,
            Publisher: publisher,
            PublishedDate: publishedDate,
            Description: book.Description,
            Identifiers: identifiers,
            CoverImageBytes: cover?.Content,
            CoverContentType: cover?.ContentMimeType,
            PageCount: EstimatePageCount(book));
    }

    private static int? EstimatePageCount(EpubBook book)
    {
        var wordCount = 0;
        foreach (var content in book.ReadingOrder)
        {
            if (string.IsNullOrEmpty(content.Content))
            {
                continue;
            }

            var text = HtmlTagRegex().Replace(content.Content, " ");
            wordCount += text.Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries).Length;
        }

        return wordCount > 0 ? Math.Max(1, (int)Math.Round(wordCount / (double)WordsPerEstimatedPage)) : null;
    }

    [GeneratedRegex("<[^>]+>")]
    private static partial Regex HtmlTagRegex();

    private static DateOnly? TryParseDate(string? rawDate)
    {
        if (string.IsNullOrWhiteSpace(rawDate))
        {
            return null;
        }

        if (DateTimeOffset.TryParse(rawDate, CultureInfo.InvariantCulture, DateTimeStyles.None, out var full))
        {
            return DateOnly.FromDateTime(full.Date);
        }

        if (rawDate.Length == 4 && int.TryParse(rawDate, out var year) && year is >= 1 and <= 9999)
        {
            return new DateOnly(year, 1, 1);
        }

        if (DateOnly.TryParseExact(rawDate, "yyyy-MM", CultureInfo.InvariantCulture, DateTimeStyles.None, out var yearMonth))
        {
            return yearMonth;
        }

        return null;
    }
}
