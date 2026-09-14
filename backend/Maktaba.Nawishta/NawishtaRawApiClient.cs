using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Serialization;
using Maktaba.Nawishta.Generated;

namespace Maktaba.Nawishta;

/// <summary>Same {links, pageSize, pageCount, currentPageIndex, totalCount, data} shape every one
/// of Nawishta's paged list endpoints uses (see LibraryViewPageView, the one paged response NSwag
/// *did* generate a type for, from GET /libraries) - reused generically here since the equivalent
/// book/author/series/category page shapes were never generated (see this class's own doc
/// comment).</summary>
public class NawishtaPageView<T>
{
    [JsonPropertyName("data")]
    public List<T>? Data { get; set; }

    [JsonPropertyName("totalCount")]
    public long? TotalCount { get; set; }
}

/// <summary>
/// Nawishta's live swagger document doesn't declare a response schema for ~138 of its 170
/// operations - including every list/get for books, authors, series, and categories - so the
/// NSwag-generated client (NawishtaClient.Generated.cs, #107) returns an untyped <c>Task</c> for
/// all of them; only request bodies came through typed. Rather than blocking this whole epic on a
/// fix to a different repository (C:\code\inshapardaz\api), this hand-written client does its own
/// GET/POST/PUT/DELETE and deserializes responses into the *request-side* model classes NSwag did
/// generate (<see cref="BookView"/>, <see cref="AuthorView"/>, <see cref="SeriesView"/>,
/// <see cref="CategoryView"/>, ...) - safe because Nawishta's own convention is the same
/// <c>{Entity}View</c> shape for both a create/update request body and the resource itself in a
/// response (confirmed by matching field names across both directions in the spec). Reuses
/// <see cref="NawishtaApiException"/> (from the generated client) for error reporting, so callers
/// that already handle it (see NawishtaEndpoints.cs's DescribeNawishtaError) don't need a second
/// exception type to catch.
/// </summary>
public class NawishtaRawApiClient(HttpClient httpClient, string serverUrl)
{
    private readonly string _baseUrl = serverUrl.TrimEnd('/');

    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNameCaseInsensitive = true,
    };

    public void SetAccessToken(string accessToken) =>
        httpClient.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", accessToken);

    public async Task<NawishtaPageView<BookView>> GetBooksAsync(
        int libraryId, string? query, int? pageNumber, int? pageSize, int? authorId, int? seriesId, int? categoryId, CancellationToken ct)
    {
        var qs = BuildQuery(new Dictionary<string, string?>
        {
            ["query"] = query,
            ["pageNumber"] = pageNumber?.ToString(),
            ["pageSize"] = pageSize?.ToString(),
            ["authorId"] = authorId?.ToString(),
            ["seriesId"] = seriesId?.ToString(),
            ["categoryId"] = categoryId?.ToString(),
        });
        return await GetJsonAsync<NawishtaPageView<BookView>>($"{_baseUrl}/libraries/{libraryId}/books{qs}", ct) ?? new();
    }

    public Task<BookView?> GetBookByIdAsync(int libraryId, int bookId, CancellationToken ct) =>
        GetJsonAsync<BookView>($"{_baseUrl}/libraries/{libraryId}/books/{bookId}", ct);

    public async Task<NawishtaPageView<AuthorView>> GetAuthorsAsync(int libraryId, CancellationToken ct) =>
        await GetJsonAsync<NawishtaPageView<AuthorView>>($"{_baseUrl}/libraries/{libraryId}/authors?pageSize=1000", ct) ?? new();

    public async Task<NawishtaPageView<SeriesView>> GetSeriesAsync(int libraryId, CancellationToken ct) =>
        await GetJsonAsync<NawishtaPageView<SeriesView>>($"{_baseUrl}/libraries/{libraryId}/series?pageSize=1000", ct) ?? new();

    public async Task<NawishtaPageView<CategoryView>> GetCategoriesAsync(int libraryId, CancellationToken ct) =>
        await GetJsonAsync<NawishtaPageView<CategoryView>>($"{_baseUrl}/libraries/{libraryId}/categories?pageSize=1000", ct) ?? new();

    public Task<BookView?> CreateBookAsync(int libraryId, BookView body, CancellationToken ct) =>
        PostJsonAsync<BookView>($"{_baseUrl}/libraries/{libraryId}/books", body, ct);

    public Task<BookView?> UpdateBookAsync(int libraryId, int bookId, BookView body, CancellationToken ct) =>
        PutJsonAsync<BookView>($"{_baseUrl}/libraries/{libraryId}/books/{bookId}", body, ct);

    public async Task DeleteBookAsync(int libraryId, int bookId, CancellationToken ct)
    {
        using var response = await httpClient.DeleteAsync($"{_baseUrl}/libraries/{libraryId}/books/{bookId}", ct);
        await ThrowIfErrorAsync(response, ct);
    }

    /// <summary>Downloads one of a book's content files (BookView.Contents[i].Id) as raw bytes -
    /// see NawishtaBookQueryService's doc comment for why a "content" maps 1:1 to a Maktaba
    /// BookFile. Returns (bytes, mimeType, fileName).</summary>
    public async Task<(byte[] Bytes, string? MimeType, string? FileName)> DownloadContentAsync(
        int libraryId, int bookId, long contentId, CancellationToken ct)
    {
        using var response = await httpClient.GetAsync(
            $"{_baseUrl}/libraries/{libraryId}/books/{bookId}/contents/{contentId}", HttpCompletionOption.ResponseHeadersRead, ct);
        await ThrowIfErrorAsync(response, ct);
        var bytes = await response.Content.ReadAsByteArrayAsync(ct);
        return (bytes, response.Content.Headers.ContentType?.MediaType, response.Content.Headers.ContentDisposition?.FileName);
    }

    /// <summary>Uploads a new content file for a book (multipart, matching Nawishta's own
    /// UpdateBookImageAsync/UpdateLibraryImageAsync convention for file uploads elsewhere in the
    /// generated client). <paramref name="language"/> is required by Nawishta's content model
    /// (BookContentView.Language) - defaults to the book's own language field.</summary>
    public async Task<BookContentView?> UploadContentAsync(
        int libraryId, int bookId, string fileName, string mimeType, string language, Stream content, CancellationToken ct)
    {
        using var form = new MultipartFormDataContent();
        using var fileContent = new StreamContent(content);
        fileContent.Headers.ContentType = MediaTypeHeaderValue.Parse(mimeType);
        form.Add(fileContent, "file", fileName);
        form.Add(new StringContent(language), "language");

        using var response = await httpClient.PostAsync($"{_baseUrl}/libraries/{libraryId}/books/{bookId}/contents", form, ct);
        await ThrowIfErrorAsync(response, ct);
        var text = await response.Content.ReadAsStringAsync(ct);
        return string.IsNullOrWhiteSpace(text) ? null : JsonSerializer.Deserialize<BookContentView>(text, JsonOptions);
    }

    private async Task<T?> GetJsonAsync<T>(string url, CancellationToken ct)
    {
        using var response = await httpClient.GetAsync(url, ct);
        if (response.StatusCode == HttpStatusCode.NotFound)
        {
            return default;
        }

        await ThrowIfErrorAsync(response, ct);
        return await response.Content.ReadFromJsonAsync<T>(JsonOptions, ct);
    }

    private async Task<T?> PostJsonAsync<T>(string url, object body, CancellationToken ct)
    {
        using var response = await httpClient.PostAsJsonAsync(url, body, JsonOptions, ct);
        await ThrowIfErrorAsync(response, ct);
        var text = await response.Content.ReadAsStringAsync(ct);
        return string.IsNullOrWhiteSpace(text) ? default : JsonSerializer.Deserialize<T>(text, JsonOptions);
    }

    private async Task<T?> PutJsonAsync<T>(string url, object body, CancellationToken ct)
    {
        using var response = await httpClient.PutAsJsonAsync(url, body, JsonOptions, ct);
        await ThrowIfErrorAsync(response, ct);
        var text = await response.Content.ReadAsStringAsync(ct);
        return string.IsNullOrWhiteSpace(text) ? default : JsonSerializer.Deserialize<T>(text, JsonOptions);
    }

    private static async Task ThrowIfErrorAsync(HttpResponseMessage response, CancellationToken ct)
    {
        if (response.IsSuccessStatusCode)
        {
            return;
        }

        var body = await response.Content.ReadAsStringAsync(ct);
        var headers = response.Headers.ToDictionary(h => h.Key, h => (IEnumerable<string>)h.Value);
        throw new NawishtaApiException(
            $"HTTP {(int)response.StatusCode} calling {response.RequestMessage?.RequestUri}", (int)response.StatusCode, body, headers, null);
    }

    private static string BuildQuery(IReadOnlyDictionary<string, string?> parts)
    {
        var pairs = parts
            .Where(kv => kv.Value is not null)
            .Select(kv => $"{Uri.EscapeDataString(kv.Key)}={Uri.EscapeDataString(kv.Value!)}")
            .ToList();
        return pairs.Count > 0 ? "?" + string.Join("&", pairs) : "";
    }
}
