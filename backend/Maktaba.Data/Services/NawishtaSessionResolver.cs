using Maktaba.Core.Services;
using Maktaba.Nawishta;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;

namespace Maktaba.Data.Services;

/// <summary>Scoped (per-request) - resolves and caches the one (raw API client, remote library id,
/// shadow DbContext) tuple a Nawishta-backed active library needs, so <see cref="LibraryQueryServiceFactory"/>
/// and BookEndpoints.cs's PUT/PATCH/DELETE handlers (which build a <see cref="NawishtaBookMutationService"/>
/// on demand rather than going through a registered IBookEditService/IBookRemovalService - see that
/// class's own doc comment) don't each re-resolve the credential/build a second HttpClient/shadow
/// DbContext for the same request.</summary>
public class NawishtaSessionResolver(
    ILibraryService libraryService,
    ICloudCredentialCache credentials,
    ICloudCacheManager cacheManager,
    INawishtaAuthService nawishtaAuth,
    IHttpClientFactory httpClientFactory)
{
    private (NawishtaRawApiClient Api, int RemoteLibraryId, NawishtaShadowDbContext Shadow, ICloudCacheManager CacheManager, string LibraryId)? _cached;

    public bool TryResolve(
        out (NawishtaRawApiClient Api, int RemoteLibraryId, NawishtaShadowDbContext Shadow, ICloudCacheManager CacheManager, string LibraryId) result)
    {
        if (_cached is { } cached)
        {
            result = cached;
            return true;
        }

        var entry = libraryService.Libraries.FirstOrDefault(l => l.Id == libraryService.CurrentLibraryId);
        if (entry?.ProviderType != "nawishta")
        {
            result = default;
            return false;
        }

        if (!credentials.TryGet(entry.Id, out var credentialJson))
        {
            throw new InvalidOperationException(
                "This library's credentials haven't been supplied for this session yet - reopen it with its credential.");
        }

        var options = NawishtaProviderOptions.FromConfig(entry.ProviderConfig ?? new Dictionary<string, string>(), credentialJson);
        var httpClient = httpClientFactory.CreateClient(nameof(NawishtaRawApiClient));
        var api = new NawishtaRawApiClient(httpClient, options.ServerUrl);
        api.SetAccessToken(options.AccessToken, DateTimeOffset.FromUnixTimeMilliseconds(options.AccessTokenExpiresAtUnixMs));
        api.RefreshAccessTokenAsync = NawishtaCredentialRefresher.Create(
            nawishtaAuth, credentials, entry.Id, options.ServerUrl, options.RefreshToken);

        var shadow = new NawishtaShadowDbContext(NawishtaShadowDbContext.GetDbPath(entry.Id));
        EnsureCurrentShadowSchema(shadow);

        var value = (api, options.RemoteLibraryId, shadow, cacheManager, entry.Id);
        _cached = value;
        result = value;
        return true;
    }

    // Same "no real EF Core migrations, EnsureCreated only creates a *missing* file" gap
    // LibraryService.EnsureCurrentSchemaAsync already works around for metadata.db (see that
    // method's own doc comment) - without this, a NawishtaShadow/{libraryId}.db left over from
    // before the read-progress fields were added to NawishtaBookState would throw "no such column"
    // on every read/write of them instead of transparently rebuilding. The shadow DB is documented
    // as local-only, rebuildable state (NawishtaShadowDbContext's own doc comment), so wiping and
    // recreating it on a detected mismatch is the intended recovery, same trade-off as metadata.db.
    private static void EnsureCurrentShadowSchema(NawishtaShadowDbContext shadow)
    {
        shadow.Database.EnsureCreated();

        try
        {
            shadow.BookStates.Select(s => new { s.ChapterId, s.Position }).Take(1).ToList();
            shadow.Collections.Select(c => c.ParentCollectionId).Take(1).ToList();
        }
        catch (SqliteException)
        {
            shadow.Database.EnsureDeleted();
            shadow.Database.EnsureCreated();
        }
    }
}
