using System.Net.Http.Headers;
using System.Text.Json.Serialization;
using Maktaba.Core.Services;
using Microsoft.Graph;
using Microsoft.Graph.Drives.Item.Items.Item.CreateUploadSession;
using Microsoft.Graph.Models;
using Microsoft.Graph.Models.ODataErrors;
using Microsoft.Kiota.Abstractions.Authentication;

namespace Maktaba.Cloud;

/// <summary>
/// Second concrete cloud IStorageProvider (Cloud: Phase 4), following the exact shape
/// S3StorageProvider established: a local cache mirror (via ICloudCacheManager) that every method
/// downloads into first if a file isn't cached yet, so everything above the provider layer still
/// just works with plain local paths. Talks to the signed-in account's OneDrive via the Microsoft
/// Graph SDK, addressing items by path under <see cref="OneDriveProviderOptions.Folder"/> rather
/// than by item id - simpler to reason about and matches how S3StorageProvider addresses objects
/// by key rather than needing to track ids of its own.
///
/// Unlike S3 (a flat key-value bucket), OneDrive has real folders that must exist before something
/// can be uploaded into them - CreateDirectoryAsync/NotifyWrittenAsync both ensure the parent chain
/// exists rather than assuming a nested "key" just works.
///
/// NOT live-tested yet (Cloud: Phase 4, implemented before a real Azure AD app registration/access
/// token was available) - see oneDriveAuth.ts's CLIENT_ID comment. Build-verified only.
/// </summary>
public class OneDriveStorageProvider : IStorageProvider, IDisposable
{
    private const string DatabaseRelativePath = "metadata.db";

    // Graph recommends upload session chunk sizes be a multiple of 320 KiB; this is comfortably
    // under the simple-PUT 4 MiB ceiling's replacement threshold while staying a reasonable chunk
    // count for a typical ebook file.
    private const int UploadChunkSize = 320 * 1024 * 16; // 5 MiB
    private const long SimpleUploadCeiling = 4 * 1024 * 1024; // 4 MiB - Graph's PUT .../content limit

    private readonly string _libraryId;
    private readonly OneDriveProviderOptions _options;
    private readonly ICloudCacheManager _cache;
    private readonly OneDriveTokenManager _tokenManager;
    private readonly HttpClient _http;
    private readonly GraphServiceClient _graph;

    public OneDriveStorageProvider(string libraryId, OneDriveProviderOptions options, ICloudCacheManager cache)
    {
        _libraryId = libraryId;
        _options = options;
        _cache = cache;
        _http = new HttpClient();
        _tokenManager = new OneDriveTokenManager(_http, options);
        _graph = new GraphServiceClient(new BaseBearerTokenAuthenticationProvider(new OneDriveAccessTokenProvider(_tokenManager)));
    }

    public string ProviderType => "onedrive";

    public void Dispose() => _http.Dispose();

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

    // Graph's path-based item addressing ("/drive/root:/{itemPath}:/...") requires each segment
    // percent-encoded (a book title/author name can contain ':', '#', '?', etc., any of which
    // would otherwise be parsed as part of the address syntax rather than the item's name).
    private static string EncodeItemPath(string itemPath) =>
        string.Join('/', itemPath.Split('/').Select(Uri.EscapeDataString));

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
        try
        {
            var itemPath = EncodeItemPath(ToItemPath(relativePath));
            using var stream = await _graph.Drives[await MyDriveIdAsync(ct)].Root.ItemWithPath(itemPath).Content.GetAsync(cancellationToken: ct);
            if (stream is not null)
            {
                await _cache.WriteAsync(_libraryId, relativePath, stream, ct);
            }
        }
        catch (ODataError ex) when (ex.ResponseStatusCode == 404)
        {
            // No remote item yet (e.g. a brand-new file about to be written locally then pushed via
            // NotifyWrittenAsync) - leave nothing cached, same as S3StorageProvider's equivalent.
        }
    }

    // The Graph SDK's fluent Me.Drive shortcut needs the drive's own id for some request builders
    // (CreateUploadSession in particular); resolved once and reused rather than looked up per call.
    private string? _driveId;

    private async Task<string> MyDriveIdAsync(CancellationToken ct)
    {
        if (_driveId is not null)
        {
            return _driveId;
        }

        var drive = await _graph.Me.Drive.GetAsync(cancellationToken: ct)
            ?? throw new InvalidOperationException("Could not resolve the signed-in account's OneDrive.");
        _driveId = drive.Id ?? throw new InvalidOperationException("OneDrive returned a drive with no id.");
        return _driveId;
    }

    public async Task NotifyWrittenAsync(string relativePath, CancellationToken ct = default)
    {
        var localPath = _cache.GetLocalPath(_libraryId, relativePath);
        var itemPath = ToItemPath(relativePath);
        await EnsureParentFolderExistsAsync(itemPath, ct);

        await using var stream = File.OpenRead(localPath);
        var driveId = await MyDriveIdAsync(ct);
        var encodedPath = EncodeItemPath(itemPath);

        if (stream.Length <= SimpleUploadCeiling)
        {
            await _graph.Drives[driveId].Root.ItemWithPath(encodedPath).Content.PutAsync(stream, cancellationToken: ct);
            return;
        }

        await UploadLargeFileAsync(driveId, encodedPath, stream, ct);
    }

    private async Task UploadLargeFileAsync(string driveId, string encodedItemPath, FileStream stream, CancellationToken ct)
    {
        var session = await _graph.Drives[driveId].Root.ItemWithPath(encodedItemPath).CreateUploadSession.PostAsync(
            new CreateUploadSessionPostRequestBody
            {
                Item = new DriveItemUploadableProperties
                {
                    AdditionalData = new Dictionary<string, object> { ["@microsoft.graph.conflictBehavior"] = "replace" },
                },
            }, cancellationToken: ct);

        if (session?.UploadUrl is null)
        {
            throw new InvalidOperationException("OneDrive did not return an upload session.");
        }

        var totalLength = stream.Length;
        var buffer = new byte[UploadChunkSize];
        long uploaded = 0;

        while (uploaded < totalLength)
        {
            ct.ThrowIfCancellationRequested();
            var toRead = (int)Math.Min(UploadChunkSize, totalLength - uploaded);
            var read = await stream.ReadAsync(buffer.AsMemory(0, toRead), ct);
            using var content = new ByteArrayContent(buffer, 0, read);
            content.Headers.ContentLength = read;
            content.Headers.ContentRange = new ContentRangeHeaderValue(uploaded, uploaded + read - 1, totalLength);

            // Upload session URLs are pre-authenticated (embed their own short-lived token) - a
            // plain HttpClient call, not routed through the Graph SDK/its own auth provider.
            using var response = await _http.PutAsync(session.UploadUrl, content, ct);
            response.EnsureSuccessStatusCode();
            uploaded += read;
        }
    }

    private async Task EnsureParentFolderExistsAsync(string itemPath, CancellationToken ct)
    {
        var lastSlash = itemPath.LastIndexOf('/');
        if (lastSlash < 0)
        {
            // Uploading directly under the library's root folder - that folder itself still needs
            // to exist (it's never auto-created just by PUTting into it, unlike S3's flat keyspace).
            if (itemPath.Length > 0)
            {
                return;
            }

            return;
        }

        await CreateDirectoryAsync(itemPath[..lastSlash], ct);
    }

    public async Task CreateDirectoryAsync(string relativePath, CancellationToken ct = default)
    {
        Directory.CreateDirectory(_cache.GetLocalPath(_libraryId, relativePath));

        var itemPath = ToItemPath(relativePath);
        if (itemPath.Length == 0)
        {
            return;
        }

        // Creates every missing segment from the root down, since a nested folder can't be created
        // in one call - each POST is a no-op (Graph reports 409 Conflict, swallowed below) if that
        // segment already exists.
        var segments = itemPath.Split('/');
        var driveId = await MyDriveIdAsync(ct);
        var builtPath = "";

        foreach (var segment in segments)
        {
            var parentPath = builtPath;
            builtPath = builtPath.Length == 0 ? segment : $"{builtPath}/{segment}";

            try
            {
                var folder = new DriveItem { Name = segment, Folder = new Folder() };
                if (parentPath.Length == 0)
                {
                    await _graph.Drives[driveId].Items["root"].Children.PostAsync(folder, cancellationToken: ct);
                }
                else
                {
                    await _graph.Drives[driveId].Root.ItemWithPath(EncodeItemPath(parentPath)).Children.PostAsync(folder, cancellationToken: ct);
                }
            }
            catch (ODataError ex) when (ex.ResponseStatusCode == 409)
            {
                // Already exists - exactly what makes this safe to call unconditionally before
                // every upload, the same way Directory.CreateDirectory is idempotent locally.
            }
        }
    }

    public async Task DeleteAsync(string relativePath, bool recursive = false, CancellationToken ct = default)
    {
        _cache.Delete(_libraryId, relativePath, recursive);

        try
        {
            var driveId = await MyDriveIdAsync(ct);
            // A Graph DELETE on a folder item already deletes everything under it - recursive is
            // just what the caller expects to happen, not a separate code path to implement here.
            await _graph.Drives[driveId].Root.ItemWithPath(EncodeItemPath(ToItemPath(relativePath))).DeleteAsync(cancellationToken: ct);
        }
        catch (ODataError ex) when (ex.ResponseStatusCode == 404)
        {
            // Already gone remotely - deleting something that only ever existed in the local cache
            // (never pushed) shouldn't be an error.
        }
    }

    public async Task MoveAsync(string fromRelativePath, string toRelativePath, CancellationToken ct = default)
    {
        var driveId = await MyDriveIdAsync(ct);
        var fromItemPath = ToItemPath(fromRelativePath);
        var toItemPath = ToItemPath(toRelativePath);
        var toParent = toItemPath.Contains('/') ? toItemPath[..toItemPath.LastIndexOf('/')] : "";
        var toName = toItemPath.Contains('/') ? toItemPath[(toItemPath.LastIndexOf('/') + 1)..] : toItemPath;

        if (toParent.Length > 0)
        {
            await CreateDirectoryAsync(toParent, ct);
        }

        var update = new DriveItem
        {
            Name = toName,
            ParentReference = new ItemReference
            {
                Path = toParent.Length == 0 ? "/drive/root:" : $"/drive/root:/{toParent}",
            },
        };

        await _graph.Drives[driveId].Root.ItemWithPath(EncodeItemPath(fromItemPath)).PatchAsync(update, cancellationToken: ct);

        if (_cache.Exists(_libraryId, fromRelativePath))
        {
            _cache.Move(_libraryId, fromRelativePath, toRelativePath);
        }
    }

    public async Task<bool> ExistsAsync(string relativePath, CancellationToken ct = default) =>
        _cache.Exists(_libraryId, relativePath) || await ExistsRemoteAsync(relativePath, ct);

    public async Task<bool> ExistsRemoteAsync(string relativePath, CancellationToken ct = default)
    {
        try
        {
            var driveId = await MyDriveIdAsync(ct);
            var item = await _graph.Drives[driveId].Root.ItemWithPath(EncodeItemPath(ToItemPath(relativePath))).GetAsync(cancellationToken: ct);
            return item is not null;
        }
        catch (ODataError ex) when (ex.ResponseStatusCode == 404)
        {
            return false;
        }
    }

    public async IAsyncEnumerable<StorageEntry> EnumerateAsync(
        string relativePath, [System.Runtime.CompilerServices.EnumeratorCancellation] CancellationToken ct = default)
    {
        var itemPath = ToItemPath(relativePath);
        var driveId = await MyDriveIdAsync(ct);

        DriveItemCollectionResponse? page;
        try
        {
            page = itemPath.Length == 0
                ? await _graph.Drives[driveId].Items["root"].Children.GetAsync(cancellationToken: ct)
                : await _graph.Drives[driveId].Root.ItemWithPath(EncodeItemPath(itemPath)).Children.GetAsync(cancellationToken: ct);
        }
        catch (ODataError ex) when (ex.ResponseStatusCode == 404)
        {
            yield break;
        }

        while (page is not null)
        {
            foreach (var item in page.Value ?? [])
            {
                if (item.Name is null)
                {
                    continue;
                }

                var childRelative = relativePath.Length == 0 ? item.Name : $"{relativePath.TrimEnd('/')}/{item.Name}";
                yield return new StorageEntry(childRelative, item.Folder is not null);
            }

            page = page.OdataNextLink is null
                ? null
                : await _graph.Drives[driveId].Items["root"].Children.WithUrl(page.OdataNextLink).GetAsync(cancellationToken: ct);
        }
    }

    public async Task<string> PullDatabaseAsync(CancellationToken ct = default)
    {
        await DownloadIntoCacheAsync(DatabaseRelativePath, ct);
        return _cache.GetLocalPath(_libraryId, DatabaseRelativePath);
    }

    public Task PushDatabaseAsync(CancellationToken ct = default) => NotifyWrittenAsync(DatabaseRelativePath, ct);

    // Diagnostic-only, same purpose as S3StorageProvider.ToString() - surfaced in error messages
    // (e.g. migration verification failures) without needing a debugger.
    public override string ToString() =>
        $"onedrive folder={(string.IsNullOrEmpty(_options.Folder) ? "(root)" : _options.Folder)}";
}

/// <summary>Refreshes and caches a OneDrive access token in-memory for this provider instance's
/// lifetime. Deliberately duplicates CLIENT_ID/the token endpoint from oneDriveAuth.ts rather than
/// sharing a constant across the TypeScript/C# boundary - see that file's comment for why. A
/// rotated refresh token (Microsoft may issue a new one on every refresh) is kept for the rest of
/// this process's lifetime but never relayed back to Electron's encrypted storage - a known v1
/// limitation matching S3StorageProvider's own documented v1 caching gaps, not an oversight; if it
/// ever causes a stale saved credential, the Reconnect action (Settings -> Libraries) already
/// covers exactly this recovery path.</summary>
internal sealed class OneDriveTokenManager(HttpClient http, OneDriveProviderOptions initial)
{
    // TODO(Cloud: Phase 4 #96/#97): must match oneDriveAuth.ts's CLIENT_ID once a real Azure AD app
    // registration exists - see that file's comment for the exact setup steps.
    private const string ClientId = "00000000-0000-0000-0000-000000000000";
    // /consumers/, not /common/ - CLIENT_ID's Azure AD app registration is "Personal Microsoft
    // accounts only" (see oneDriveAuth.ts's matching comment), and /common/ against a
    // consumers-only registration is a common source of "application not found" errors.
    private const string TokenEndpoint = "https://login.microsoftonline.com/consumers/oauth2/v2.0/token";
    private const string Scopes = "offline_access Files.ReadWrite User.Read";

    private readonly SemaphoreSlim _refreshLock = new(1, 1);
    private string _accessToken = initial.AccessToken;
    private string _refreshToken = initial.RefreshToken;
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
                    ["grant_type"] = "refresh_token",
                    ["refresh_token"] = _refreshToken,
                    ["scope"] = Scopes,
                }),
                ct);

            var body = await response.Content.ReadAsStringAsync(ct);
            if (!response.IsSuccessStatusCode)
            {
                throw new InvalidOperationException($"OneDrive token refresh failed: {body}");
            }

            var json = System.Text.Json.JsonSerializer.Deserialize<TokenResponse>(body)
                ?? throw new InvalidOperationException("OneDrive token refresh returned an empty response.");

            _accessToken = json.AccessToken;
            _refreshToken = json.RefreshToken ?? _refreshToken;
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
        [property: JsonPropertyName("refresh_token")] string? RefreshToken,
        [property: JsonPropertyName("expires_in")] long ExpiresIn);
}

internal sealed class OneDriveAccessTokenProvider(OneDriveTokenManager tokenManager) : IAccessTokenProvider
{
    public AllowedHostsValidator AllowedHostsValidator { get; } = new();

    public async Task<string> GetAuthorizationTokenAsync(
        Uri uri, Dictionary<string, object>? additionalAuthenticationContext = null, CancellationToken cancellationToken = default) =>
        await tokenManager.GetAccessTokenAsync(cancellationToken);
}
