using System.Text.Json;

namespace Maktaba.Nawishta;

/// <summary>
/// Builds the refresh callback <see cref="NawishtaRawApiClient.RefreshAccessTokenAsync"/> calls on a
/// 401 - shared by NawishtaSessionResolver (the query/mutation-service path) and
/// StorageProviderFactory (the file/cover-serving path), which each build their own
/// <see cref="NawishtaRawApiClient"/> instance but need identical refresh behavior. Renews via
/// <see cref="INawishtaAuthService.RefreshAsync"/> and writes the renewed credential straight back
/// into <see cref="Maktaba.Core.Services.ICloudCredentialCache"/> (in-memory, cleared every backend
/// restart - same as every other cloud provider's credential) so a later request in the same
/// session reuses the renewed token/refresh-token pair instead of renewing again from the
/// (now-stale) one this session started with.
/// </summary>
public static class NawishtaCredentialRefresher
{
    public static Func<CancellationToken, Task<string>> Create(
        INawishtaAuthService auth, Maktaba.Core.Services.ICloudCredentialCache credentials,
        string libraryId, string serverUrl, string initialRefreshToken)
    {
        // Nawishta's own refresh token is itself replaced on every renewal (not reused indefinitely -
        // see AuthenticateResponse.RefreshTokenExiry's 2-day TTL) - captured here as mutable local
        // state (not re-read from the credential cache each call) so a rapid burst of concurrent 401s
        // right after the access token expires doesn't each try to redeem the same now-already-spent
        // refresh token against Nawishta's own server.
        var refreshToken = initialRefreshToken;

        return async ct =>
        {
            var renewed = await auth.RefreshAsync(serverUrl, refreshToken, ct);
            refreshToken = renewed.RefreshToken;
            credentials.Set(libraryId, JsonSerializer.Serialize(renewed));
            return renewed.AccessToken;
        };
    }
}
