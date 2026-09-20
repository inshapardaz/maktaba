namespace Maktaba.Nawishta;

/// <summary>
/// A Nawishta-backed library's config, assembled from a library registry entry's ProviderConfig
/// dict (ServerUrl/RemoteLibraryId - non-secret) plus a credential supplied transiently by the
/// frontend (the JWT access/refresh token pair from #108's login flow - see NawishtaCredential
/// below). Mirrors S3ProviderOptions/GoogleDriveProviderOptions/OneDriveProviderOptions' own
/// "non-secret config dict + secret credential JSON" split (Maktaba.Cloud) - kept in
/// Maktaba.Nawishta instead since a Nawishta library isn't an IStorageProvider (see the epic
/// addendum on issue #69: Nawishta replaces both metadata and file storage, not just where files
/// sit).
/// </summary>
public record NawishtaProviderOptions(
    // The Nawishta API instance this library talks to, e.g. "https://api.nawishta.co.uk" - no
    // trailing slash assumed by callers, so this is normalized on the way in (see FromConfig).
    string ServerUrl,
    // Nawishta's own int-typed library id (a Nawishta account can own/access several - see #108's
    // library picker), not one of this app's own Sqids-encoded ids. Never run through IdCodec.
    int RemoteLibraryId,
    string AccessToken,
    string RefreshToken,
    // Epoch milliseconds the access token expires at - same Date.now()-based shape
    // GoogleDriveProviderOptions/OneDriveProviderOptions already use, not the API's own
    // expires_in-seconds-from-response-time shape. Nawishta's access token is short-lived (10 min
    // per the epic addendum), so whatever renews it (#108) is expected to run far more often than
    // the OAuth providers' own refresh cycle.
    long AccessTokenExpiresAtUnixMs)
{
    public const string ServerUrlKey = "serverUrl";
    public const string RemoteLibraryIdKey = "remoteLibraryId";

    // Same case-sensitivity pitfall S3Credential/GoogleDriveCredential/OneDriveCredential's own
    // comments document - the frontend sends {accessToken, refreshToken, expiresAt} camelCase.
    private static readonly System.Text.Json.JsonSerializerOptions CredentialJsonOptions = new()
    {
        PropertyNameCaseInsensitive = true,
    };

    public static NawishtaProviderOptions FromConfig(IReadOnlyDictionary<string, string> config, string credentialJson)
    {
        var credential = System.Text.Json.JsonSerializer.Deserialize<NawishtaCredential>(credentialJson, CredentialJsonOptions)
            ?? throw new InvalidOperationException("Malformed Nawishta credential.");

        if (string.IsNullOrWhiteSpace(credential.AccessToken) || string.IsNullOrWhiteSpace(credential.RefreshToken))
        {
            throw new InvalidOperationException("Nawishta credential is missing an access or refresh token.");
        }

        var serverUrl = config.GetValueOrDefault(ServerUrlKey) ?? throw new InvalidOperationException("Missing Nawishta server URL.");
        var remoteLibraryIdRaw = config.GetValueOrDefault(RemoteLibraryIdKey) ?? throw new InvalidOperationException("Missing Nawishta remote library id.");
        if (!int.TryParse(remoteLibraryIdRaw, out var remoteLibraryId))
        {
            throw new InvalidOperationException("Nawishta remote library id must be an integer.");
        }

        return new NawishtaProviderOptions(
            serverUrl.TrimEnd('/'),
            remoteLibraryId,
            credential.AccessToken,
            credential.RefreshToken,
            credential.ExpiresAt);
    }
}

/// <summary>The JSON shape passed transiently to the backend after #108's login/refresh flow -
/// see the frontend's future Nawishta connect form, and ICloudCredentialCache (Cloud: Phase 1) for
/// why only this backend ever sees it decrypted, and only for the lifetime of one request.
/// Name/Email (added alongside the "show who's signed in" UI - Nawishta's own /authenticate and
/// /refresh-token responses already return both) are display-only, never read by FromConfig - a
/// credential saved before this field existed just parses with them null, same as any other missing
/// optional JSON property.</summary>
public record NawishtaCredential(string AccessToken, string RefreshToken, long ExpiresAt, string? Name = null, string? Email = null);
