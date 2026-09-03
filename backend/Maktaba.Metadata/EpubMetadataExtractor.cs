using System.Globalization;
using Maktaba.Core.Services;
using VersOne.Epub;

namespace Maktaba.Metadata;

public class EpubMetadataExtractor : IBookMetadataExtractor
{
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
            CoverContentType: cover?.ContentMimeType);
    }

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
