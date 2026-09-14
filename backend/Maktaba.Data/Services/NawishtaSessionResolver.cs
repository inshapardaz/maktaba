using Maktaba.Core.Services;
using Maktaba.Nawishta;

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
    IHttpClientFactory httpClientFactory)
{
    private (NawishtaRawApiClient Api, int RemoteLibraryId, NawishtaShadowDbContext Shadow)? _cached;

    public bool TryResolve(out (NawishtaRawApiClient Api, int RemoteLibraryId, NawishtaShadowDbContext Shadow) result)
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
        api.SetAccessToken(options.AccessToken);

        var shadow = new NawishtaShadowDbContext(NawishtaShadowDbContext.GetDbPath(entry.Id));
        shadow.Database.EnsureCreated();

        var value = (api, options.RemoteLibraryId, shadow);
        _cached = value;
        result = value;
        return true;
    }
}
