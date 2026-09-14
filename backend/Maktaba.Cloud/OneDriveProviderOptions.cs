namespace Maktaba.Cloud;

/// <summary>
/// OneDriveStorageProvider's config, assembled from a library registry entry's ProviderConfig dict
/// (Folder - non-secret) plus a credential supplied transiently by the frontend (the OAuth token
/// set from window.maktaba.connectOneDrive() - see OneDriveCredential below).
/// </summary>
public record OneDriveProviderOptions(
    // Path (relative to the signed-in account's OneDrive root) this library's files live under,
    // e.g. "Apps/Maktaba/My Library". Empty/null means the OneDrive root itself.
    string Folder,
    string AccessToken,
    string RefreshToken,
    // Epoch milliseconds - matches the frontend/Electron side's Date.now()-based expiresAt rather
    // than Graph's own expires_in-seconds-from-response-time shape, so no clock-skew math is
    // needed converting between the two ends of the credential's JSON round-trip.
    long ExpiresAtUnixMs)
{
    public const string FolderKey = "folder";

    // The frontend sends {accessToken, refreshToken, expiresAt} (camelCase, from
    // window.maktaba.connectOneDrive()'s OneDriveTokens shape) - same case-sensitivity pitfall
    // S3Credential's own CredentialJsonOptions comment documents, so this reuses that fix rather
    // than risking the same silently-empty-fields bug a second time.
    private static readonly System.Text.Json.JsonSerializerOptions CredentialJsonOptions = new()
    {
        PropertyNameCaseInsensitive = true,
    };

    public static OneDriveProviderOptions FromConfig(IReadOnlyDictionary<string, string> config, string credentialJson)
    {
        var credential = System.Text.Json.JsonSerializer.Deserialize<OneDriveCredential>(credentialJson, CredentialJsonOptions)
            ?? throw new InvalidOperationException("Malformed OneDrive credential.");

        if (string.IsNullOrWhiteSpace(credential.AccessToken) || string.IsNullOrWhiteSpace(credential.RefreshToken))
        {
            throw new InvalidOperationException("OneDrive credential is missing an access or refresh token.");
        }

        return new OneDriveProviderOptions(
            config.GetValueOrDefault(FolderKey) ?? "",
            credential.AccessToken,
            credential.RefreshToken,
            credential.ExpiresAt);
    }
}

/// <summary>The JSON shape returned by window.maktaba.connectOneDrive() and passed transiently to
/// the backend - see the frontend's OneDrive connect flow.</summary>
public record OneDriveCredential(string AccessToken, string RefreshToken, long ExpiresAt);
