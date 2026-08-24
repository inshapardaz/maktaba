using System.Net.Http.Json;
using System.Text.Json;
using Maktaba.Core.Services;

namespace Maktaba.Data.Services;

public class OpenLibraryMetadataLookupService(HttpClient httpClient) : IMetadataLookupService
{
    public async Task<IReadOnlyList<MetadataSearchResult>> SearchAsync(string title, CancellationToken ct = default)
    {
        var url = $"https://openlibrary.org/search.json?q={Uri.EscapeDataString(title)}" +
                   "&fields=key,title,author_name,first_publish_year,isbn,cover_i&limit=10";

        using var response = await httpClient.GetAsync(url, ct);
        if (!response.IsSuccessStatusCode)
        {
            return [];
        }

        using var stream = await response.Content.ReadAsStreamAsync(ct);
        using var doc = await JsonDocument.ParseAsync(stream, cancellationToken: ct);

        if (!doc.RootElement.TryGetProperty("docs", out var docs))
        {
            return [];
        }

        var results = new List<MetadataSearchResult>();
        foreach (var item in docs.EnumerateArray())
        {
            var key = item.TryGetProperty("key", out var keyEl) ? keyEl.GetString() : null;
            var resultTitle = item.TryGetProperty("title", out var titleEl) ? titleEl.GetString() : null;
            if (string.IsNullOrEmpty(key) || string.IsNullOrEmpty(resultTitle))
            {
                continue;
            }

            var authors = item.TryGetProperty("author_name", out var authorsEl) && authorsEl.ValueKind == JsonValueKind.Array
                ? authorsEl.EnumerateArray().Select(a => a.GetString()).Where(a => a is not null).Select(a => a!).ToList()
                : [];

            var firstPublishYear = item.TryGetProperty("first_publish_year", out var yearEl) && yearEl.ValueKind == JsonValueKind.Number
                ? yearEl.GetInt32()
                : (int?)null;

            var isbn = item.TryGetProperty("isbn", out var isbnEl) && isbnEl.ValueKind == JsonValueKind.Array && isbnEl.GetArrayLength() > 0
                ? isbnEl[0].GetString()
                : null;

            var coverUrl = item.TryGetProperty("cover_i", out var coverEl) && coverEl.ValueKind == JsonValueKind.Number
                ? $"https://covers.openlibrary.org/b/id/{coverEl.GetInt32()}-M.jpg"
                : null;

            results.Add(new MetadataSearchResult(key, resultTitle, authors, firstPublishYear, coverUrl, isbn));
        }

        return results;
    }

    public async Task<MetadataDetails?> GetDetailsAsync(string key, string? isbn, CancellationToken ct = default)
    {
        // key is a Work key like "/works/OL45804W" - already absolute-path-shaped from SearchAsync's
        // "key" field, so it's appended directly rather than reconstructed.
        var workUrl = $"https://openlibrary.org{key}.json";

        string title;
        List<string> authors = [];
        string? description = null;

        using (var workResponse = await httpClient.GetAsync(workUrl, ct))
        {
            if (!workResponse.IsSuccessStatusCode)
            {
                return null;
            }

            using var stream = await workResponse.Content.ReadAsStreamAsync(ct);
            using var doc = await JsonDocument.ParseAsync(stream, cancellationToken: ct);
            var root = doc.RootElement;

            title = root.TryGetProperty("title", out var titleEl) ? titleEl.GetString() ?? "" : "";
            description = ExtractDescription(root);

            if (root.TryGetProperty("authors", out var authorsEl) && authorsEl.ValueKind == JsonValueKind.Array)
            {
                foreach (var entry in authorsEl.EnumerateArray())
                {
                    if (!entry.TryGetProperty("author", out var authorRef) || !authorRef.TryGetProperty("key", out var authorKeyEl))
                    {
                        continue;
                    }

                    var authorKey = authorKeyEl.GetString();
                    if (string.IsNullOrEmpty(authorKey))
                    {
                        continue;
                    }

                    var authorName = await FetchAuthorNameAsync(authorKey, ct);
                    if (authorName is not null)
                    {
                        authors.Add(authorName);
                    }
                }
            }
        }

        if (string.IsNullOrEmpty(title))
        {
            return null;
        }

        string? publisher = null;
        DateOnly? publishedDate = null;

        if (!string.IsNullOrEmpty(isbn))
        {
            (publisher, publishedDate) = await FetchEditionDataAsync(isbn, ct);
        }

        return new MetadataDetails(title, authors, description, publisher, publishedDate, isbn);
    }

    private async Task<string?> FetchAuthorNameAsync(string authorKey, CancellationToken ct)
    {
        try
        {
            using var response = await httpClient.GetAsync($"https://openlibrary.org{authorKey}.json", ct);
            if (!response.IsSuccessStatusCode)
            {
                return null;
            }

            var json = await response.Content.ReadFromJsonAsync<JsonElement>(cancellationToken: ct);
            return json.TryGetProperty("name", out var nameEl) ? nameEl.GetString() : null;
        }
        catch (JsonException)
        {
            return null;
        }
    }

    private async Task<(string? Publisher, DateOnly? PublishedDate)> FetchEditionDataAsync(string isbn, CancellationToken ct)
    {
        try
        {
            var url = $"https://openlibrary.org/api/books?bibkeys=ISBN:{Uri.EscapeDataString(isbn)}&jscmd=data&format=json";
            using var response = await httpClient.GetAsync(url, ct);
            if (!response.IsSuccessStatusCode)
            {
                return (null, null);
            }

            using var stream = await response.Content.ReadAsStreamAsync(ct);
            using var doc = await JsonDocument.ParseAsync(stream, cancellationToken: ct);

            if (!doc.RootElement.TryGetProperty($"ISBN:{isbn}", out var edition))
            {
                return (null, null);
            }

            var publisher = edition.TryGetProperty("publishers", out var publishersEl)
                && publishersEl.ValueKind == JsonValueKind.Array
                && publishersEl.GetArrayLength() > 0
                && publishersEl[0].TryGetProperty("name", out var nameEl)
                ? nameEl.GetString()
                : null;

            DateOnly? publishedDate = null;
            if (edition.TryGetProperty("publish_date", out var dateEl) && dateEl.GetString() is { } rawDate)
            {
                publishedDate = ParsePublishDate(rawDate);
            }

            return (publisher, publishedDate);
        }
        catch (JsonException)
        {
            return (null, null);
        }
    }

    // Open Library's publish_date is free text ("1988", "October 1970", "1970-10-01", ...) - a
    // real DateOnly.TryParse is tried first, falling back to just the year (Jan 1) when only a
    // year can be recovered, since that's still useful for the book-edit form's date field.
    private static DateOnly? ParsePublishDate(string rawDate)
    {
        if (DateOnly.TryParse(rawDate, out var parsed))
        {
            return parsed;
        }

        var yearMatch = System.Text.RegularExpressions.Regex.Match(rawDate, @"\b(1[5-9]\d{2}|20\d{2})\b");
        return yearMatch.Success && int.TryParse(yearMatch.Value, out var year) ? new DateOnly(year, 1, 1) : null;
    }

    private static string? ExtractDescription(JsonElement root)
    {
        if (!root.TryGetProperty("description", out var descEl))
        {
            return null;
        }

        return descEl.ValueKind switch
        {
            JsonValueKind.String => descEl.GetString(),
            JsonValueKind.Object when descEl.TryGetProperty("value", out var valueEl) => valueEl.GetString(),
            _ => null,
        };
    }
}
