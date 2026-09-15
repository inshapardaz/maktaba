using System.Text.Json;

namespace Maktaba.Nawishta;

/// <summary>
/// Builds the refresh callback <see cref="NawishtaRawApiClient.RefreshAccessTokenAsync"/> calls -
/// proactively, once the client's own tracked expiry says the access token is due to go stale, and
/// reactively as a fallback on an actual 401 (see that client's own doc comment for why both exist:
/// Nawishta silently returns *partial*, not-erroring data for some endpoints when the token has
/// expired, so waiting for a 401 alone misses that case entirely) - shared by NawishtaSessionResolver
/// (the query/mutation-service path) and StorageProviderFactory (the file/cover-serving path), which
/// each build their own <see cref="NawishtaRawApiClient"/> instance but need identical refresh
/// behavior. Renews via <see cref="INawishtaAuthService.RefreshAsync"/> and writes the renewed
/// credential straight back into <see cref="Maktaba.Core.Services.ICloudCredentialCache"/>
/// (in-memory, cleared every backend restart - same as every other cloud provider's credential) so a
/// later request in the same session reuses the renewed token/refresh-token/expiry triple instead of
/// renewing again from the (now-stale) one this session started with.
/// </summary>
public static class NawishtaCredentialRefresher
{
    public static Func<CancellationToken, Task<NawishtaCredential>> Create(
        INawishtaAuthService auth, Maktaba.Core.Services.ICloudCredentialCache credentials,
        string libraryId, string serverUrl, string initialRefreshToken)
    {
        // Nawishta's own refresh token is itself replaced on every renewal (not reused indefinitely -
        // see AuthenticateResponse.RefreshTokenExiry's 2-day TTL) - captured here as mutable local
        // state (not re-read from the credential cache each call) so a rapid burst of concurrent
        // renewals right after the access token expires doesn't each try to redeem the same
        // now-already-spent refresh token against Nawishta's own server.
        var refreshToken = initialRefreshToken;

        return async ct =>
        {
            var renewed = await auth.RefreshAsync(serverUrl, refreshToken, ct);
            refreshToken = renewed.RefreshToken;
            credentials.Set(libraryId, JsonSerializer.Serialize(renewed));
            return renewed;
        };
    }
}
