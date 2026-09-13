using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json.Serialization;
using Maktaba.Core.Services;

namespace Maktaba.Cloud;

/// <summary>
/// Third concrete cloud IStorageProvider (Cloud: Phase 5), following the same local-cache-mirror
/// shape S3StorageProvider/OneDriveStorageProvider established. Talks to the Google Drive API v3
/// directly over HttpClient (no client SDK - Drive v3 is a small, simple REST surface, and this
/// avoids adding another heavy generated-client dependency to Maktaba.Cloud on top of the AWS and
/// Graph SDKs already there).
///
/// Unlike both S3 (flat keys) and OneDrive (path-based item addressing), Drive has neither - every
/// file/folder is linked to its parent purely by id, and Drive even allows two files with the same
/// name under the same parent. ResolveFolderIdAsync/FindChildAsync are this provider's own
/// substitute for path addressing: walk one segment at a time, matching (and, for folders, creating)
/// by name under each resolved parent id, caching the path->id mapping so a repeated path doesn't
/// re-walk from the root every time.
///
/// NOT live-tested yet (Cloud: Phase 5, implemented before a real Google Cloud OAuth client was
/// available) - see googleDriveAuth.ts's CLIENT_ID/CLIENT_SECRET comment. Build-verified only.
/// </summary>
public class GoogleDriveStorageProvider : IStorageProvider, IDisposable
{
    private const string DatabaseRelativePath = "metadata.db";
    private const string ApiBase = "https://www.googleapis.com/drive/v3";
    private const string UploadBase = "https://www.googleapis.com/upload/drive/v3";
    private const string FolderMimeType = "application/vnd.google-apps.folder";

    // Drive's simple/multipart upload endpoints are capped at 5 MiB combined metadata+content;
    // anything larger must use a resumable upload session instead.
    private const long SimpleUploadCeiling = 5 * 1024 * 1024;
    private const int UploadChunkSize = 256 * 1024 * 20; // 5 MiB, a multiple of Drive's 256 KiB requirement

    private readonly string _libraryId;
    private readonly GoogleDriveProviderOptions _options;
    private readonly ICloudCacheManager _cache;
    private readonly GoogleDriveTokenManager _tokenManager;
    private readonly HttpClient _http;

    // Path -> Drive id, scoped to this provider instance's lifetime only (not persisted) - purely
    // an optimization so a library with many books doesn't re-walk the same parent folder chain
    // from "root" on every single file operation.
    private readonly Dictionary<string, string> _idCache = new(StringComparer.Ordinal);

    public GoogleDriveStorageProvider(string libraryId, GoogleDriveProviderOptions options, ICloudCacheManager cache)
    {
        _libraryId = libraryId;
        _options = options;
        _cache = cache;
        _http = new HttpClient();
        _tokenManager = new GoogleDriveTokenManager(_http, options);
    }

    public string ProviderType => "googledrive";

    public void Dispose() => _http.Dispose();

    private async Task<HttpRequestMessage> AuthorizedAsync(HttpMethod method, string url, CancellationToken ct)
    {
        var request = new HttpRequestMessage(method, url);
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", await _tokenManager.GetAccessTokenAsync(ct));
        return request;
    }

    private string ToItemPath(string relativePath)
    {
        var normalized = relativePath.Replace('\\', '/').Trim('/');
        var folder = _options.Folder.Trim('/');
        if (string.IsNullOrEmpty(folder))
        {
            return normalized;
        }

        // Same double-slash pitfall S3StorageProvider.ToKey hit for an empty relativePath under a
        // configured prefix (Cloud: Phase 3 bugfix) - avoided here from the start.
        return normalized.Length == 0 ? folder : $"{folder}/{normalized}";
    }

    private static string EscapeQueryLiteral(string value) => value.Replace("\\", "\\\\").Replace("'", "\\'");

    /// <summary>Resolves a "/"-separated folder path (relative to My Drive's root) to its Drive id,
    /// walking and caching one segment at a time. With createIfMissing, creates any missing folder
    /// segment along the way (tolerating a name that already exists - Drive has no atomic
    /// create-if-missing, so this checks first rather than relying on a conflict response).</summary>
    private async Task<string?> ResolveFolderIdAsync(string folderPath, bool createIfMissing, CancellationToken ct)
    {
        if (folderPath.Length == 0)
        {
            return "root";
        }

        if (_idCache.TryGetValue(folderPath, out var cached))
        {
            return cached;
        }

        var segments = folderPath.Split('/');
        var parentId = "root";
        var builtPath = "";

        foreach (var segment in segments)
        {
            builtPath = builtPath.Length == 0 ? segment : $"{builtPath}/{segment}";
            if (_idCache.TryGetValue(builtPath, out var cachedSegment))
            {
                parentId = cachedSegment;
                continue;
            }

            var childId = await FindChildAsync(parentId, segment, ct);
            if (childId is null)
            {
                if (!createIfMissing)
                {
                    return null;
                }

                childId = await CreateFolderAsync(parentId, segment, ct);
            }

            _idCache[builtPath] = childId;
            parentId = childId;
        }

        return parentId;
    }

    /// <summary>Splits an item path into its parent folder path and leaf name, resolves the parent
    /// (never creating it - only NotifyWrittenAsync/CreateDirectoryAsync do that), and looks up the
    /// leaf by name under it. Returns null if either the parent or the leaf doesn't exist.</summary>
    private async Task<string?> FindItemIdAsync(string itemPath, CancellationToken ct)
    {
        var lastSlash = itemPath.LastIndexOf('/');
        var parentPath = lastSlash < 0 ? "" : itemPath[..lastSlash];
        var leafName = lastSlash < 0 ? itemPath : itemPath[(lastSlash + 1)..];

        var parentId = await ResolveFolderIdAsync(parentPath, createIfMissing: false, ct);
        return parentId is null ? null : await FindChildAsync(parentId, leafName, ct);
    }

    private async Task<string?> FindChildAsync(string parentId, string name, CancellationToken ct)
    {
        var query = Uri.EscapeDataString($"'{parentId}' in parents and name = '{EscapeQueryLiteral(name)}' and trashed = false");
        var request = await AuthorizedAsync(HttpMethod.Get, $"{ApiBase}/files?q={query}&fields=files(id)&spaces=drive&pageSize=1", ct);
        using var response = await _http.SendAsync(request, ct);
        response.EnsureSuccessStatusCode();
        var body = await response.Content.ReadFromJsonAsync<FileListResponse>(cancellationToken: ct);
        return body?.Files?.FirstOrDefault()?.Id;
    }

    private async Task<string> CreateFolderAsync(string parentId, string name, CancellationToken ct)
    {
        var request = await AuthorizedAsync(HttpMethod.Post, $"{ApiBase}/files?fields=id", ct);
        request.Content = JsonContent.Create(new DriveFileCreateRequest(name, FolderMimeType, [parentId]));
        using var response = await _http.SendAsync(request, ct);
        response.EnsureSuccessStatusCode();
        var body = await response.Content.ReadFromJsonAsync<DriveFile>(cancellationToken: ct)
            ?? throw new InvalidOperationException("Google Drive did not return the created folder's id.");
        return body.Id ?? throw new InvalidOperationException("Google Drive returned a folder with no id.");
    }

    public async Task<string> GetLocalPathAsync(string relativePath, CancellationToken ct = default)
    {
        if (!_cache.Exists(_libraryId, relativePath))
        {
            await DownloadIntoCacheAsync(relativePath, ct);
        }

        return _cache.GetLocalPath(_libraryId, relativePath);
    }

    private async Task DownloadIntoCacheAsync(string relativePath, CancellationToken ct)
    {
        var itemId = await FindItemIdAsync(ToItemPath(relativePath), ct);
        if (itemId is null)
        {
            // No remote item yet (e.g. a brand-new file about to be written locally then pushed via
            // NotifyWrittenAsync) - leave nothing cached, same as the other providers' equivalent.
            return;
        }

        var request = await AuthorizedAsync(HttpMethod.Get, $"{ApiBase}/files/{itemId}?alt=media", ct);
        using var response = await _http.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, ct);
        response.EnsureSuccessStatusCode();
        await using var stream = await response.Content.ReadAsStreamAsync(ct);
        await _cache.WriteAsync(_libraryId, relativePath, stream, ct);
    }

    public async Task NotifyWrittenAsync(string relativePath, CancellationToken ct = default)
    {
        var localPath = _cache.GetLocalPath(_libraryId, relativePath);
        var itemPath = ToItemPath(relativePath);
        var lastSlash = itemPath.LastIndexOf('/');
        var parentPath = lastSlash < 0 ? "" : itemPath[..lastSlash];
        var leafName = lastSlash < 0 ? itemPath : itemPath[(lastSlash + 1)..];

        var parentId = await ResolveFolderIdAsync(parentPath, createIfMissing: true, ct)
            ?? throw new InvalidOperationException($"Could not resolve or create the parent folder for \"{relativePath}\".");
        var existingId = await FindChildAsync(parentId, leafName, ct);

        await using var stream = File.OpenRead(localPath);

        if (stream.Length <= SimpleUploadCeiling)
        {
            await SimpleUploadAsync(existingId, parentId, leafName, stream, ct);
        }
        else
        {
            await ResumableUploadAsync(existingId, parentId, leafName, stream, ct);
        }
    }

    private async Task SimpleUploadAsync(string? existingId, string parentId, string name, FileStream stream, CancellationToken ct)
    {
        var boundary = Guid.NewGuid().ToString("N");
        using var content = new MultipartContent("related", boundary);
        var metadata = existingId is null
            ? JsonContent.Create(new DriveFileCreateRequest(name, null, [parentId]))
            : JsonContent.Create(new { name });
        content.Add(metadata);

        var mediaContent = new StreamContent(stream);
        mediaContent.Headers.ContentType = new MediaTypeHeaderValue("application/octet-stream");
        content.Add(mediaContent);

        var url = existingId is null
            ? $"{UploadBase}/files?uploadType=multipart&fields=id"
            : $"{UploadBase}/files/{existingId}?uploadType=multipart&fields=id";
        var request = await AuthorizedAsync(existingId is null ? HttpMethod.Post : HttpMethod.Patch, url, ct);
        request.Content = content;

        using var response = await _http.SendAsync(request, ct);
        response.EnsureSuccessStatusCode();
    }

    private async Task ResumableUploadAsync(string? existingId, string parentId, string name, FileStream stream, CancellationToken ct)
    {
        var url = existingId is null
            ? $"{UploadBase}/files?uploadType=resumable&fields=id"
            : $"{UploadBase}/files/{existingId}?uploadType=resumable&fields=id";
        var sessionRequest = await AuthorizedAsync(existingId is null ? HttpMethod.Post : HttpMethod.Patch, url, ct);
        sessionRequest.Content = existingId is null
            ? JsonContent.Create(new DriveFileCreateRequest(name, null, [parentId]))
            : JsonContent.Create(new { name });

        using var sessionResponse = await _http.SendAsync(sessionRequest, ct);
        sessionResponse.EnsureSuccessStatusCode();
        var sessionUri = sessionResponse.Headers.Location
            ?? throw new InvalidOperationException("Google Drive did not return a resumable upload session URI.");

        var totalLength = stream.Length;
        var buffer = new byte[UploadChunkSize];
        long uploaded = 0;

        while (uploaded < totalLength)
        {
            ct.ThrowIfCancellationRequested();
            var toRead = (int)Math.Min(UploadChunkSize, totalLength - uploaded);
            var read = await stream.ReadAsync(buffer.AsMemory(0, toRead), ct);
            using var chunkContent = new ByteArrayContent(buffer, 0, read);
            chunkContent.Headers.ContentLength = read;
            chunkContent.Headers.ContentRange = new ContentRangeHeaderValue(uploaded, uploaded + read - 1, totalLength);

            var chunkRequest = await AuthorizedAsync(HttpMethod.Put, sessionUri.ToString(), ct);
            chunkRequest.Content = chunkContent;
            using var chunkResponse = await _http.SendAsync(chunkRequest, ct);
            // 308 Resume Incomplete is Drive's "keep going" response for every chunk but the last.
            if (chunkResponse.StatusCode != System.Net.HttpStatusCode.PermanentRedirect && !chunkResponse.IsSuccessStatusCode)
            {
                chunkResponse.EnsureSuccessStatusCode();
            }

            uploaded += read;
        }
    }

    public Task CreateDirectoryAsync(string relativePath, CancellationToken ct = default)
    {
        Directory.CreateDirectory(_cache.GetLocalPath(_libraryId, relativePath));
        var itemPath = ToItemPath(relativePath);
        return itemPath.Length == 0 ? Task.CompletedTask : ResolveFolderIdAsync(itemPath, createIfMissing: true, ct);
    }

    public async Task DeleteAsync(string relativePath, bool recursive = false, CancellationToken ct = default)
    {
        _cache.Delete(_libraryId, relativePath, recursive);

        var itemPath = ToItemPath(relativePath);
        var itemId = await FindItemIdAsync(itemPath, ct);
        if (itemId is null)
        {
            // Already gone remotely - deleting something that only ever existed in the local cache
            // (never pushed) shouldn't be an error.
            return;
        }

        // Deleting a Drive folder already deletes everything under it, same as S3/OneDrive's
        // recursive delete - recursive is just what the caller expects to happen, not a separate
        // API call here. Trashing rather than permanently deleting matches user expectation (the
        // item shows up in Drive's own Trash, recoverable) - PermanentDelete would skip that.
        var request = await AuthorizedAsync(HttpMethod.Delete, $"{ApiBase}/files/{itemId}", ct);
        using var response = await _http.SendAsync(request, ct);
        if (response.StatusCode != System.Net.HttpStatusCode.NotFound)
        {
            response.EnsureSuccessStatusCode();
        }

        _idCache.Remove(itemPath);
    }

    public async Task MoveAsync(string fromRelativePath, string toRelativePath, CancellationToken ct = default)
    {
        var fromItemPath = ToItemPath(fromRelativePath);
        var toItemPath = ToItemPath(toRelativePath);

        var fromLastSlash = fromItemPath.LastIndexOf('/');
        var fromParentPath = fromLastSlash < 0 ? "" : fromItemPath[..fromLastSlash];
        var fromLeafName = fromLastSlash < 0 ? fromItemPath : fromItemPath[(fromLastSlash + 1)..];

        var toLastSlash = toItemPath.LastIndexOf('/');
        var toParentPath = toLastSlash < 0 ? "" : toItemPath[..toLastSlash];
        var toLeafName = toLastSlash < 0 ? toItemPath : toItemPath[(toLastSlash + 1)..];

        var fromParentId = await ResolveFolderIdAsync(fromParentPath, createIfMissing: false, ct)
            ?? throw new InvalidOperationException($"Source folder for \"{fromRelativePath}\" doesn't exist.");
        var itemId = await FindChildAsync(fromParentId, fromLeafName, ct)
            ?? throw new InvalidOperationException($"\"{fromRelativePath}\" doesn't exist on Google Drive.");
        var toParentId = await ResolveFolderIdAsync(toParentPath, createIfMissing: true, ct)
            ?? throw new InvalidOperationException($"Could not resolve or create the target folder for \"{toRelativePath}\".");

        var url = $"{ApiBase}/files/{itemId}?addParents={toParentId}&removeParents={fromParentId}&fields=id";
        var request = await AuthorizedAsync(HttpMethod.Patch, url, ct);
        request.Content = JsonContent.Create(new { name = toLeafName });
        using var response = await _http.SendAsync(request, ct);
        response.EnsureSuccessStatusCode();

        _idCache.Remove(fromItemPath);

        if (_cache.Exists(_libraryId, fromRelativePath))
        {
            _cache.Move(_libraryId, fromRelativePath, toRelativePath);
        }
    }

    public async Task<bool> ExistsAsync(string relativePath, CancellationToken ct = default) =>
        _cache.Exists(_libraryId, relativePath) || await ExistsRemoteAsync(relativePath, ct);

    public async Task<bool> ExistsRemoteAsync(string relativePath, CancellationToken ct = default) =>
        await FindItemIdAsync(ToItemPath(relativePath), ct) is not null;

    public async IAsyncEnumerable<StorageEntry> EnumerateAsync(
        string relativePath, [System.Runtime.CompilerServices.EnumeratorCancellation] CancellationToken ct = default)
    {
        var folderId = await ResolveFolderIdAsync(ToItemPath(relativePath), createIfMissing: false, ct);
        if (folderId is null)
        {
            yield break;
        }

        string? pageToken = null;
        do
        {
            var query = Uri.EscapeDataString($"'{folderId}' in parents and trashed = false");
            var pageParam = pageToken is null ? "" : $"&pageToken={Uri.EscapeDataString(pageToken)}";
            var request = await AuthorizedAsync(
                HttpMethod.Get, $"{ApiBase}/files?q={query}&fields=nextPageToken,files(id,name,mimeType)&pageSize=1000&spaces=drive{pageParam}", ct);
            using var response = await _http.SendAsync(request, ct);
            response.EnsureSuccessStatusCode();
            var page = await response.Content.ReadFromJsonAsync<FileListResponse>(cancellationToken: ct);

            foreach (var file in page?.Files ?? [])
            {
                if (file.Name is null)
                {
                    continue;
                }

                var childRelative = relativePath.Length == 0 ? file.Name : $"{relativePath.TrimEnd('/')}/{file.Name}";
                yield return new StorageEntry(childRelative, file.MimeType == FolderMimeType);
            }

            pageToken = page?.NextPageToken;
        } while (pageToken is not null);
    }

    public async Task<string> PullDatabaseAsync(CancellationToken ct = default)
    {
        await DownloadIntoCacheAsync(DatabaseRelativePath, ct);
        return _cache.GetLocalPath(_libraryId, DatabaseRelativePath);
    }

    public Task PushDatabaseAsync(CancellationToken ct = default) => NotifyWrittenAsync(DatabaseRelativePath, ct);

    // Diagnostic-only, same purpose as S3StorageProvider/OneDriveStorageProvider's ToString().
    public override string ToString() =>
        $"googledrive folder={(string.IsNullOrEmpty(_options.Folder) ? "(My Drive root)" : _options.Folder)}";

    private sealed record DriveFile(
        [property: JsonPropertyName("id")] string? Id,
        [property: JsonPropertyName("name")] string? Name,
        [property: JsonPropertyName("mimeType")] string? MimeType);

    private sealed record FileListResponse(
        [property: JsonPropertyName("files")] List<DriveFile>? Files,
        [property: JsonPropertyName("nextPageToken")] string? NextPageToken);

    private sealed record DriveFileCreateRequest(
        [property: JsonPropertyName("name")] string Name,
        [property: JsonPropertyName("mimeType")] string? MimeType,
        [property: JsonPropertyName("parents")] string[] Parents);
}

/// <summary>Refreshes and caches a Google Drive access token in-memory for this provider instance's
/// lifetime. Deliberately duplicates CLIENT_ID/CLIENT_SECRET/the token endpoint from
/// googleDriveAuth.ts rather than sharing a constant across the TypeScript/C# boundary - see that
/// file's comment for why (and why the client secret isn't treated as confidential for this OAuth
/// client type). Unlike OneDrive, Google does not normally rotate the refresh token on every
/// refresh, so there's no equivalent v1 "rotated token not persisted" gap here - the same refresh
/// token keeps working until the user revokes access.</summary>
internal sealed class GoogleDriveTokenManager(HttpClient http, GoogleDriveProviderOptions initial)
{
    // TODO(Cloud: Phase 5 #99/#100): must match googleDriveAuth.ts's CLIENT_ID/CLIENT_SECRET once a
    // real Google Cloud OAuth client exists - see that file's comment for the exact setup steps.
    private const string ClientId = "REDACTED";
    private const string ClientSecret = "REDACTED";
    private const string TokenEndpoint = "https://oauth2.googleapis.com/token";

    private readonly SemaphoreSlim _refreshLock = new(1, 1);
    private string _accessToken = initial.AccessToken;
    private long _expiresAtUnixMs = initial.ExpiresAtUnixMs;

    public async Task<string> GetAccessTokenAsync(CancellationToken ct)
    {
        // 60s safety buffer so a request never starts with a token that expires mid-flight.
        if (DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() < _expiresAtUnixMs - 60_000)
        {
            return _accessToken;
        }

        await _refreshLock.WaitAsync(ct);
        try
        {
            // Another caller may have already refreshed while this one waited for the lock.
            if (DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() < _expiresAtUnixMs - 60_000)
            {
                return _accessToken;
            }

            using var response = await http.PostAsync(
                TokenEndpoint,
                new FormUrlEncodedContent(new Dictionary<string, string>
                {
                    ["client_id"] = ClientId,
                    ["client_secret"] = ClientSecret,
                    ["grant_type"] = "refresh_token",
                    ["refresh_token"] = initial.RefreshToken,
                }),
                ct);

            var body = await response.Content.ReadAsStringAsync(ct);
            if (!response.IsSuccessStatusCode)
            {
                throw new InvalidOperationException($"Google Drive token refresh failed: {body}");
            }

            var json = System.Text.Json.JsonSerializer.Deserialize<TokenResponse>(body)
                ?? throw new InvalidOperationException("Google Drive token refresh returned an empty response.");

            _accessToken = json.AccessToken;
            _expiresAtUnixMs = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() + json.ExpiresIn * 1000;
            return _accessToken;
        }
        finally
        {
            _refreshLock.Release();
        }
    }

    private sealed record TokenResponse(
        [property: JsonPropertyName("access_token")] string AccessToken,
        [property: JsonPropertyName("expires_in")] long ExpiresIn);
}
