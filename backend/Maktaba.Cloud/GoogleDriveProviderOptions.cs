namespace Maktaba.Cloud;

/// <summary>
/// GoogleDriveStorageProvider's config, assembled from a library registry entry's ProviderConfig
/// dict (Folder - non-secret) plus a credential supplied transiently by the frontend (the OAuth
/// token set from window.maktaba.connectGoogleDrive() - see GoogleDriveCredential below).
/// </summary>
public record GoogleDriveProviderOptions(
    // Path (relative to "My Drive") this library's files live under, e.g. "Maktaba/My Library".
    // Empty/null means My Drive's own root.
    string Folder,
    string AccessToken,
    string RefreshToken,
    // Epoch milliseconds - matches the frontend/Electron side's Date.now()-based expiresAt rather
    // than the API's own expires_in-seconds-from-response-time shape.
    long ExpiresAtUnixMs)
{
    public const string FolderKey = "folder";

    // The frontend sends {accessToken, refreshToken, expiresAt} (camelCase, from
    // window.maktaba.connectGoogleDrive()'s GoogleDriveTokens shape) - same case-sensitivity
    // pitfall S3Credential/OneDriveCredential's own comments document, so this reuses that fix
    // rather than risking the same silently-empty-fields bug a third time.
    private static readonly System.Text.Json.JsonSerializerOptions CredentialJsonOptions = new()
    {
        PropertyNameCaseInsensitive = true,
    };

    public static GoogleDriveProviderOptions FromConfig(IReadOnlyDictionary<string, string> config, string credentialJson)
    {
        var credential = System.Text.Json.JsonSerializer.Deserialize<GoogleDriveCredential>(credentialJson, CredentialJsonOptions)
            ?? throw new InvalidOperationException("Malformed Google Drive credential.");

        if (string.IsNullOrWhiteSpace(credential.AccessToken) || string.IsNullOrWhiteSpace(credential.RefreshToken))
        {
            throw new InvalidOperationException("Google Drive credential is missing an access or refresh token.");
        }

        return new GoogleDriveProviderOptions(
            config.GetValueOrDefault(FolderKey) ?? "",
            credential.AccessToken,
            credential.RefreshToken,
            credential.ExpiresAt);
    }
}

/// <summary>The JSON shape returned by window.maktaba.connectGoogleDrive() and passed transiently
/// to the backend - see the frontend's Google Drive connect flow.</summary>
public record GoogleDriveCredential(string AccessToken, string RefreshToken, long ExpiresAt);
