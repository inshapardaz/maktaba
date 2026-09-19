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

    // How long before the token's own reported expiry EnsureFreshTokenAsync treats it as already
    // stale - renewing a little early absorbs request latency/clock skew between this process and
    // Nawishta's own server, rather than racing a request against the exact expiry instant.
    private static readonly TimeSpan RefreshSkew = TimeSpan.FromSeconds(30);

    private DateTimeOffset? _accessTokenExpiresAt;
    private readonly SemaphoreSlim _refreshLock = new(1, 1);

    public void SetAccessToken(string accessToken, DateTimeOffset? expiresAt = null)
    {
        httpClient.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", accessToken);
        _accessTokenExpiresAt = expiresAt;
    }

    // Set by NawishtaSessionResolver/StorageProviderFactory after construction (not a constructor
    // parameter - avoids a circular reference, since building the callback needs a reference to
    // this same client to call SetAccessToken on). Nawishta's access token is short-lived (10
    // minutes) - without this, every request past that window would either 401 or (worse - the real
    // bug that made "authors/series aren't loading" hard to pin down at first) silently return
    // *partial*, not-erroring data for some endpoints once the token's gone stale, with nothing to
    // signal that's what happened. Returns the full renewed credential (not just the access token)
    // so EnsureFreshTokenAsync/GetWithRefreshAsync can update <see cref="_accessTokenExpiresAt"/>
    // from it too, not just the header.
    public Func<CancellationToken, Task<NawishtaCredential>>? RefreshAccessTokenAsync { get; set; }

    // Proactively renews before the token's own tracked expiry, rather than waiting to be told it's
    // stale - called at the start of every request-issuing method (GET and write alike), so a write
    // made after the token's gone stale renews *before* its body is sent instead of after (avoiding
    // the "a consumed StreamContent/MultipartFormDataContent can't be resent" problem the old
    // reactive-only 401 retry had for writes - see CLAUDE.md's Nawishta write-path section, now
    // covered by this rather than left as a gap). A lock (not just a null/time check) guards against
    // a burst of concurrent requests right at the expiry instant each redeeming the same
    // soon-to-be-stale refresh token.
    private async Task EnsureFreshTokenAsync(CancellationToken ct)
    {
        if (RefreshAccessTokenAsync is null || !IsStaleOrUnknown())
        {
            return;
        }

        await _refreshLock.WaitAsync(ct);
        try
        {
            if (!IsStaleOrUnknown())
            {
                return; // Another caller already renewed it while this one waited for the lock.
            }

            var renewed = await RefreshAccessTokenAsync(ct);
            SetAccessToken(renewed.AccessToken, DateTimeOffset.FromUnixTimeMilliseconds(renewed.ExpiresAt));
        }
        finally
        {
            _refreshLock.Release();
        }

        bool IsStaleOrUnknown() =>
            _accessTokenExpiresAt is null || DateTimeOffset.UtcNow >= _accessTokenExpiresAt.Value - RefreshSkew;
    }

    private async Task<HttpResponseMessage> GetWithRefreshAsync(string url, HttpCompletionOption completionOption, CancellationToken ct)
    {
        await EnsureFreshTokenAsync(ct);
        var response = await httpClient.GetAsync(url, completionOption, ct);
        if (response.StatusCode != HttpStatusCode.Unauthorized || RefreshAccessTokenAsync is null)
        {
            return response;
        }

        // Fallback for a 401 EnsureFreshTokenAsync's own expiry tracking didn't predict (a token
        // revoked/invalidated early, clock skew beyond RefreshSkew, ...) - proactive renewal above
        // is expected to make this the rare path, not the common one.
        response.Dispose();
        var renewed = await RefreshAccessTokenAsync(ct);
        SetAccessToken(renewed.AccessToken, DateTimeOffset.FromUnixTimeMilliseconds(renewed.ExpiresAt));
        return await httpClient.GetAsync(url, completionOption, ct);
    }

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

    public Task<AuthorView?> GetAuthorByIdAsync(int libraryId, int authorId, CancellationToken ct) =>
        GetJsonAsync<AuthorView>($"{_baseUrl}/libraries/{libraryId}/authors/{authorId}", ct);

    /// <summary>Issue #141 - same "self" link convention as a book's own cover
    /// (DownloadBookCoverAsync), just on AuthorView's own Links instead of BookView's. Null if the
    /// author has no image set at all, distinct from the fetch itself failing.</summary>
    public async Task<(byte[] Bytes, string? MimeType)?> DownloadAuthorImageAsync(int libraryId, int authorId, CancellationToken ct)
    {
        var author = await GetAuthorByIdAsync(libraryId, authorId, ct);
        var imageUrl = author?.Links?.FirstOrDefault(l => l.Rel == "image")?.Href;
        if (imageUrl is null)
        {
            return null;
        }

        using var response = await GetWithRefreshAsync(imageUrl, HttpCompletionOption.ResponseHeadersRead, ct);
        await ThrowIfErrorAsync(response, ct);
        var bytes = await response.Content.ReadAsByteArrayAsync(ct);
        return (bytes, response.Content.Headers.ContentType?.MediaType);
    }

    /// <summary>PUT .../authors/{authorId}/image (confirmed against the api repo's own
    /// AuthorController - [FromForm] IFormFile "file" - and its reference editor's authors.api.js,
    /// which uploads under that exact field name; the NSwag-generated UpdateAuthorImageAsync guesses
    /// a different, wrong multipart shape for this operation, same class of gap as UploadContentAsync
    /// working around Nawishta's missing content-upload schema). No DELETE-image endpoint exists on
    /// Nawishta's side at all (confirmed absent from AuthorController) - AuthorEndpoints.cs rejects a
    /// delete for a Nawishta-backed author cleanly rather than attempting one.</summary>
    public async Task UpdateAuthorImageAsync(int libraryId, int authorId, string fileName, string mimeType, Stream content, CancellationToken ct)
    {
        await EnsureFreshTokenAsync(ct);
        using var form = new MultipartFormDataContent();
        using var fileContent = new StreamContent(content);
        fileContent.Headers.ContentType = MediaTypeHeaderValue.Parse(mimeType);
        form.Add(fileContent, "file", fileName);

        using var request = new HttpRequestMessage(HttpMethod.Put, $"{_baseUrl}/libraries/{libraryId}/authors/{authorId}/image") { Content = form };
        using var response = await httpClient.SendAsync(request, ct);
        await ThrowIfErrorAsync(response, ct);
    }

    public async Task<NawishtaPageView<SeriesView>> GetSeriesAsync(int libraryId, CancellationToken ct) =>
        await GetJsonAsync<NawishtaPageView<SeriesView>>($"{_baseUrl}/libraries/{libraryId}/series?pageSize=1000", ct) ?? new();

    public async Task<NawishtaPageView<CategoryView>> GetCategoriesAsync(int libraryId, CancellationToken ct) =>
        await GetJsonAsync<NawishtaPageView<CategoryView>>($"{_baseUrl}/libraries/{libraryId}/categories?pageSize=1000", ct) ?? new();

    // Payload shapes ({name} / {name, authorType}) confirmed against Nawishta's own reference
    // editor (library-editor's authorsSelect.jsx/seriesSelect.jsx) - matching find-or-create
    // semantics NawishtaBookMutationService.ResolveAuthorsAsync/ResolveSeriesAsync build on, the
    // same pattern Maktaba's own EntityResolvers.cs already uses for local libraries.
    public Task<AuthorView?> CreateAuthorAsync(int libraryId, string name, CancellationToken ct) =>
        PostJsonAsync<AuthorView>($"{_baseUrl}/libraries/{libraryId}/authors", new { name, authorType = "writer" }, ct);

    // Issue #145 - PUT (not a partial patch), so callers fetch the existing AuthorView via
    // GetAuthorByIdAsync first and send the whole thing back with just Name changed, same
    // "fetch, mutate the one field, PUT the whole representation" pattern
    // NawishtaBookMutationService.UpdateMetadataAsync already uses for books.
    public Task<AuthorView?> UpdateAuthorAsync(int libraryId, int authorId, AuthorView body, CancellationToken ct) =>
        PutJsonAsync<AuthorView>($"{_baseUrl}/libraries/{libraryId}/authors/{authorId}", body, ct);

    public Task<SeriesView?> CreateSeriesAsync(int libraryId, string name, CancellationToken ct) =>
        PostJsonAsync<SeriesView>($"{_baseUrl}/libraries/{libraryId}/series", new { name }, ct);

    public Task<BookView?> CreateBookAsync(int libraryId, BookView body, CancellationToken ct) =>
        PostJsonAsync<BookView>($"{_baseUrl}/libraries/{libraryId}/books", body, ct);

    public Task<BookView?> UpdateBookAsync(int libraryId, int bookId, BookView body, CancellationToken ct) =>
        PutJsonAsync<BookView>($"{_baseUrl}/libraries/{libraryId}/books/{bookId}", body, ct);

    public async Task DeleteBookAsync(int libraryId, int bookId, CancellationToken ct)
    {
        await EnsureFreshTokenAsync(ct);
        using var response = await httpClient.DeleteAsync($"{_baseUrl}/libraries/{libraryId}/books/{bookId}", ct);
        await ThrowIfErrorAsync(response, ct);
    }

    /// <summary>Resolves one of a book's content files (BookView.Contents[i].Id) to its actual
    /// download response - see NawishtaBookQueryService's doc comment for why a "content" maps 1:1
    /// to a Maktaba BookFile.
    ///
    /// GET .../contents/{contentId} itself (confirmed live, against a real account) doesn't return
    /// the file's bytes at all - it returns a BookContentView-shaped JSON description of the
    /// content, whose own "self" link advertises an <c>accept: {mimeType}</c> that content
    /// negotiation *might* satisfy, but its "download" link
    /// (<c>/libraries/{libraryId}/files/{fileId}</c> - a different id than contentId entirely) is
    /// what actually serves the bytes, confirmed by following it directly. This method always takes
    /// that two-step route (fetch the description, follow its "download" link) rather than gambling
    /// on Accept-header content negotiation against the first URL.
    ///
    /// Returns the live HttpResponseMessage (caller disposes) rather than buffering the body into a
    /// byte[] itself - issue #138: the caller (NawishtaStorageProvider) streams straight into
    /// ICloudCacheManager.WriteAsync so its own copy loop can report real download progress, which
    /// a fully-buffered ReadAsByteArrayAsync here would have already finished (silently) by the time
    /// this method returned.</summary>
    public async Task<HttpResponseMessage> DownloadContentResponseAsync(int libraryId, int bookId, long contentId, CancellationToken ct)
    {
        var description = await GetJsonAsync<NawishtaContentDescription>(
            $"{_baseUrl}/libraries/{libraryId}/books/{bookId}/contents/{contentId}", ct);
        var downloadUrl = description?.Links?.FirstOrDefault(l => l.Rel == "download")?.Href
            ?? throw new InvalidOperationException($"Nawishta content {contentId} has no \"download\" link.");

        var response = await GetWithRefreshAsync(downloadUrl, HttpCompletionOption.ResponseHeadersRead, ct);
        await ThrowIfErrorAsync(response, ct);
        return response;
    }

    /// <summary>The book's own "image" (cover) link, same {libraries}/files/{fileId}-via-
    /// FileController.GetLibraryFile mechanism as a content's "download" link (see Nawishta's
    /// BookRenderer.Render - both go through the exact same file-serving endpoint). Null if the
    /// book has no cover set at all (a book.Links with no "image" rel), distinct from that
    /// endpoint failing (an exception) - callers should treat "no cover" and "cover fetch failed"
    /// differently (the former is normal, the latter is worth logging).</summary>
    public async Task<(byte[] Bytes, string? MimeType)?> DownloadBookCoverAsync(int libraryId, int bookId, CancellationToken ct)
    {
        var book = await GetBookByIdAsync(libraryId, bookId, ct);
        var imageUrl = book?.Links?.FirstOrDefault(l => l.Rel == "image")?.Href;
        if (imageUrl is null)
        {
            return null;
        }

        using var response = await GetWithRefreshAsync(imageUrl, HttpCompletionOption.ResponseHeadersRead, ct);
        await ThrowIfErrorAsync(response, ct);
        var bytes = await response.Content.ReadAsByteArrayAsync(ct);
        return (bytes, response.Content.Headers.ContentType?.MediaType);
    }

    private class NawishtaContentDescription
    {
        [JsonPropertyName("fileName")]
        public string? FileName { get; set; }

        [JsonPropertyName("mimeType")]
        public string? MimeType { get; set; }

        [JsonPropertyName("links")]
        public List<NawishtaLink>? Links { get; set; }
    }

    private class NawishtaLink
    {
        [JsonPropertyName("href")]
        public string? Href { get; set; }

        [JsonPropertyName("rel")]
        public string? Rel { get; set; }
    }

    /// <summary>Uploads a new content file for a book (multipart, matching Nawishta's own
    /// UpdateBookImageAsync/UpdateLibraryImageAsync convention for file uploads elsewhere in the
    /// generated client). <paramref name="language"/> is required by Nawishta's content model
    /// (BookContentView.Language) - defaults to the book's own language field.</summary>
    // language goes on the query string, not as a multipart form field - confirmed against
    // Nawishta's own reference editor (library-editor's books.api.js addBookContent, which builds
    // the URL via `url.searchParams.set("language", language)` before POSTing just a "file" part).
    public async Task<BookContentView?> UploadContentAsync(
        int libraryId, int bookId, string fileName, string mimeType, string language, Stream content, CancellationToken ct)
    {
        await EnsureFreshTokenAsync(ct);
        using var form = new MultipartFormDataContent();
        using var fileContent = new StreamContent(content);
        fileContent.Headers.ContentType = MediaTypeHeaderValue.Parse(mimeType);
        form.Add(fileContent, "file", fileName);

        var url = $"{_baseUrl}/libraries/{libraryId}/books/{bookId}/contents?language={Uri.EscapeDataString(language)}";
        using var response = await httpClient.PostAsync(url, form, ct);
        await ThrowIfErrorAsync(response, ct);
        var text = await response.Content.ReadAsStringAsync(ct);
        return string.IsNullOrWhiteSpace(text) ? null : JsonSerializer.Deserialize<BookContentView>(text, JsonOptions);
    }

    /// <summary>Issue #142 - best-effort push of this device's reading progress to Nawishta's own
    /// server (POST .../my/books/{bookId}, ReadProgressView{progressType, progressId, progressValue}),
    /// confirmed against the api repo's own domain model/controller (not just its swagger surface):
    /// <c>progressType</c> is a fixed 4-value enum sent as its exact C# name ("Unknown"/"Chapter"/
    /// "File"/"Pages" - anything else silently coerces to "Unknown" server-side), and
    /// <c>progressValue</c> is a 0-100 percentage. Callers always pass "Pages" here - Maktaba/qari's
    /// own resume-position model (NawishtaBookState's ChapterId/Position - see that type's own doc
    /// comment) has no honest mapping onto Nawishta's numeric ProgressId at all for an EPUB (ChapterId
    /// is a non-numeric spine id string, not a long), so only the one piece that genuinely round-trips
    /// cleanly - the overall percentage - is ever sent; ProgressId is 0 unless CurrentPage is a real
    /// page number (meaningful for PDF, not EPUB).
    ///
    /// Deliberately NOT the corresponding read path: confirmed live-code-audit against the api repo
    /// that reading it back (GET .../books/{bookId} or GET .../my/books) is unreliable - its SQL
    /// Server backend never populates ReadProgress on either endpoint at all, and its MySQL backend
    /// populates it via a RecentBooks join with no AccountId filter, so it isn't guaranteed to even be
    /// the calling user's own progress. Filed upstream as inshapardaz/api#61 rather than building a
    /// read path against a contract confirmed broken. Maktaba's own NawishtaBookState (shadow db)
    /// stays the sole read-side source of truth - see ReaderDataEndpoints.cs's GET /progress.</summary>
    public Task<ReadProgressView?> UpdateUserBookProgressAsync(int libraryId, int bookId, string progressType, long progressId, double progressValue, CancellationToken ct) =>
        PostJsonAsync<ReadProgressView>(
            $"{_baseUrl}/libraries/{libraryId}/my/books/{bookId}",
            new { progressType, progressId, progressValue }, ct);

    // Bookmarks/notes (inshapardaz/api#53/#54) - unlike most of this client's other methods, these
    // endpoints *do* have a typed response schema on Nawishta's own swagger (see BookmarkView/
    // NoteView's own generated definitions), since the [Produces] attribute was added deliberately
    // when they were built - but still routed through this hand-written client rather than the
    // generated UserClient, for the same reason every other call here is: one place with
    // EnsureFreshTokenAsync's proactive token refresh, rather than every caller needing its own.
    public async Task<List<BookmarkView>> GetBookmarksAsync(int libraryId, int bookId, CancellationToken ct) =>
        await GetJsonAsync<List<BookmarkView>>($"{_baseUrl}/libraries/{libraryId}/my/books/{bookId}/bookmarks", ct) ?? [];

    // Nawishta's own PUT here 404s (a clean, non-throwing response server-side) if the book itself
    // doesn't exist - ThrowIfErrorAsync would otherwise turn that into a thrown NawishtaApiException
    // the same as any other failure, so the caller distinguishes "not found" from a real error via
    // NawishtaApiException.StatusCode rather than this method swallowing it into a null return
    // (unlike GetJsonAsync, which already treats 404 as a normal "nothing there" case for a read).
    public Task<BookmarkView?> UpsertBookmarkAsync(int libraryId, int bookId, string clientId, BookmarkView body, CancellationToken ct) =>
        PutJsonAsync<BookmarkView>(
            $"{_baseUrl}/libraries/{libraryId}/my/books/{bookId}/bookmarks/{Uri.EscapeDataString(clientId)}", body, ct);

    public async Task DeleteBookmarkAsync(int libraryId, int bookId, string clientId, CancellationToken ct)
    {
        await EnsureFreshTokenAsync(ct);
        using var response = await httpClient.DeleteAsync(
            $"{_baseUrl}/libraries/{libraryId}/my/books/{bookId}/bookmarks/{Uri.EscapeDataString(clientId)}", ct);
        await ThrowIfErrorAsync(response, ct);
    }

    public async Task<List<NoteView>> GetNotesAsync(int libraryId, int bookId, CancellationToken ct) =>
        await GetJsonAsync<List<NoteView>>($"{_baseUrl}/libraries/{libraryId}/my/books/{bookId}/notes", ct) ?? [];

    public Task<NoteView?> UpsertNoteAsync(int libraryId, int bookId, string clientId, NoteView body, CancellationToken ct) =>
        PutJsonAsync<NoteView>(
            $"{_baseUrl}/libraries/{libraryId}/my/books/{bookId}/notes/{Uri.EscapeDataString(clientId)}", body, ct);

    public async Task DeleteNoteAsync(int libraryId, int bookId, string clientId, CancellationToken ct)
    {
        await EnsureFreshTokenAsync(ct);
        using var response = await httpClient.DeleteAsync(
            $"{_baseUrl}/libraries/{libraryId}/my/books/{bookId}/notes/{Uri.EscapeDataString(clientId)}", ct);
        await ThrowIfErrorAsync(response, ct);
    }

    // Issue #140 - Bookshelves (BookShelfClient in the generated client returns bare Task for every
    // method, same missing-response-schema situation as Books/Authors/Series/Categories, so these go
    // through this hand-written client too). Confirmed against the api repo's own source
    // (BookShelfController/BookShelfRepository, not just its swagger surface): BookShelf<->Book is a
    // real many-to-many join table (BookShelfBook), and "add book to shelf" is purely additive - a
    // book can sit on any number of shelves at once, matching Maktaba's own Collections semantics.
    // BookShelfView itself has no parent/nesting field at all (confirmed both in the generated DTO
    // and the api repo's own BookShelfModel/migration) - Nawishta has no nesting concept, so
    // NawishtaCollectionQueryService/CollectionEndpoints.cs keep parent/child relationships local-only
    // (NawishtaShadowDbContext), layered on top of these real, flat shelves.
    public async Task<List<BookShelfView>> GetBookShelvesAsync(int libraryId, CancellationToken ct) =>
        (await GetJsonAsync<NawishtaPageView<BookShelfView>>($"{_baseUrl}/libraries/{libraryId}/bookshelves?pageSize=1000", ct))?.Data ?? [];

    public Task<BookShelfView?> CreateBookShelfAsync(int libraryId, string name, CancellationToken ct) =>
        PostJsonAsync<BookShelfView>($"{_baseUrl}/libraries/{libraryId}/bookshelves", new { name }, ct);

    public Task<BookShelfView?> UpdateBookShelfAsync(int libraryId, int bookShelfId, string name, CancellationToken ct) =>
        PutJsonAsync<BookShelfView>($"{_baseUrl}/libraries/{libraryId}/bookshelves/{bookShelfId}", new { name }, ct);

    public async Task DeleteBookShelfAsync(int libraryId, int bookShelfId, CancellationToken ct)
    {
        await EnsureFreshTokenAsync(ct);
        using var response = await httpClient.DeleteAsync($"{_baseUrl}/libraries/{libraryId}/bookshelves/{bookShelfId}", ct);
        await ThrowIfErrorAsync(response, ct);
    }

    // Additive (confirmed server-side - see this section's own doc comment above): adding a book
    // already on another shelf does not move it, it just gains a second membership row.
    public async Task AddBookToBookShelfAsync(int libraryId, int bookShelfId, int bookId, CancellationToken ct)
    {
        await EnsureFreshTokenAsync(ct);
        using var response = await httpClient.PostAsJsonAsync(
            $"{_baseUrl}/libraries/{libraryId}/bookshelves/{bookShelfId}/books", new { bookId }, JsonOptions, ct);
        await ThrowIfErrorAsync(response, ct);
    }

    public async Task RemoveBookFromBookShelfAsync(int libraryId, int bookShelfId, int bookId, CancellationToken ct)
    {
        await EnsureFreshTokenAsync(ct);
        using var response = await httpClient.DeleteAsync(
            $"{_baseUrl}/libraries/{libraryId}/bookshelves/{bookShelfId}/books/{bookId}", ct);
        await ThrowIfErrorAsync(response, ct);
    }

    private async Task<T?> GetJsonAsync<T>(string url, CancellationToken ct)
    {
        using var response = await GetWithRefreshAsync(url, HttpCompletionOption.ResponseContentRead, ct);
        if (response.StatusCode == HttpStatusCode.NotFound)
        {
            return default;
        }

        await ThrowIfErrorAsync(response, ct);
        return await response.Content.ReadFromJsonAsync<T>(JsonOptions, ct);
    }

    private async Task<T?> PostJsonAsync<T>(string url, object body, CancellationToken ct)
    {
        await EnsureFreshTokenAsync(ct);
        using var response = await httpClient.PostAsJsonAsync(url, body, JsonOptions, ct);
        await ThrowIfErrorAsync(response, ct);
        var text = await response.Content.ReadAsStringAsync(ct);
        return string.IsNullOrWhiteSpace(text) ? default : JsonSerializer.Deserialize<T>(text, JsonOptions);
    }

    private async Task<T?> PutJsonAsync<T>(string url, object body, CancellationToken ct)
    {
        await EnsureFreshTokenAsync(ct);
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
