using System.Net.Http.Headers;
using Maktaba.Nawishta.Generated;

namespace Maktaba.Nawishta;

/// <summary>One of the current account's libraries, as returned by Nawishta's own GET /libraries
/// (scoped server-side to whatever the authenticated account can see) - shown in the frontend's
/// library picker after a successful login, since one Nawishta account can belong to several
/// libraries (see the design addendum on issue #69).</summary>
public record NawishtaLibrarySummary(int Id, string Name, string? Description);

public record NawishtaLoginResult(NawishtaCredential Credential, IReadOnlyList<NawishtaLibrarySummary> Libraries);

/// <summary>
/// Logs in against Nawishta's /authenticate and renews via /refresh-token (10 min access token /
/// 2 day refresh token TTLs per the design addendum on issue #69). Doesn't touch
/// ICloudCredentialCache/safeStorage itself - same as GoogleDriveTokenManager/OneDriveTokenManager,
/// this only produces/renews the token pair; the endpoint layer and frontend are what actually
/// persist it (see NawishtaProviderOptions.cs's doc comment).
/// </summary>
public interface INawishtaAuthService
{
    /// <summary>Authenticates and lists the account's libraries in one call, so the frontend's
    /// connect form can go straight from "email/password" to a library picker without a second
    /// round trip.</summary>
    Task<NawishtaLoginResult> LoginAsync(string serverUrl, string email, string password, CancellationToken ct = default);

    Task<NawishtaCredential> RefreshAsync(string serverUrl, string refreshToken, CancellationToken ct = default);

    /// <summary>Lists the account's libraries using an already-issued access token, without a fresh
    /// email/password login - lets the frontend offer "add another library from this account" once
    /// one Nawishta library is already connected, reusing its cached credential instead of asking
    /// the user to sign in again (one Nawishta account can own several libraries - see the design
    /// addendum on issue #69).</summary>
    Task<IReadOnlyList<NawishtaLibrarySummary>> ListLibrariesAsync(string serverUrl, string accessToken, CancellationToken ct = default);
}

public class NawishtaAuthService(HttpClient httpClient) : INawishtaAuthService
{
    public async Task<NawishtaLoginResult> LoginAsync(string serverUrl, string email, string password, CancellationToken ct = default)
    {
        var baseUrl = serverUrl.TrimEnd('/');
        var accountsClient = new AccountsClient(baseUrl, httpClient);

        var auth = await accountsClient.AuthenticateAsync(new AuthenticateRequest { Email = email, Password = password }, ct);
        var credential = ToCredential(auth.AccessToken, auth.RefreshToken, auth.AccessTokenExpiry);

        // The generated clients don't know about auth - PrepareRequest is per-instance/per-class,
        // so setting it on the shared HttpClient's DefaultRequestHeaders is the simplest way to get
        // this one authenticated call through, and safe here since this method owns the only use of
        // httpClient for the duration of this call (no concurrent request could observe/reuse a
        // stale header - see RefreshAsync's own comment for why it deliberately doesn't set this).
        httpClient.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", credential.AccessToken);
        try
        {
            var libraries = await FetchLibrariesAsync(baseUrl, ct);
            return new NawishtaLoginResult(credential, libraries);
        }
        finally
        {
            httpClient.DefaultRequestHeaders.Authorization = null;
        }
    }

    public async Task<IReadOnlyList<NawishtaLibrarySummary>> ListLibrariesAsync(string serverUrl, string accessToken, CancellationToken ct = default)
    {
        var baseUrl = serverUrl.TrimEnd('/');

        // Same DefaultRequestHeaders dance as LoginAsync's own try/finally - see that method's
        // comment for why this is safe (this call owns httpClient for its own duration).
        httpClient.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", accessToken);
        try
        {
            return await FetchLibrariesAsync(baseUrl, ct);
        }
        finally
        {
            httpClient.DefaultRequestHeaders.Authorization = null;
        }
    }

    private async Task<IReadOnlyList<NawishtaLibrarySummary>> FetchLibrariesAsync(string baseUrl, CancellationToken ct)
    {
        var libraryClient = new LibraryClient(baseUrl, httpClient);
        var page = await libraryClient.GetLibrariesAsync(null, 1, 200, ct);
        return (page.Data ?? [])
            .Where(l => l.Id is not null && l.Name is not null)
            .Select(l => new NawishtaLibrarySummary(l.Id!.Value, l.Name!, l.Description))
            .ToList();
    }

    public async Task<NawishtaCredential> RefreshAsync(string serverUrl, string refreshToken, CancellationToken ct = default)
    {
        // /refresh-token is unauthenticated (it's how a request gets its next access token in the
        // first place - see the auth flow doc comment above), so unlike LoginAsync this never
        // touches httpClient.DefaultRequestHeaders at all.
        var baseUrl = serverUrl.TrimEnd('/');
        var accountsClient = new AccountsClient(baseUrl, httpClient);
        var response = await accountsClient.RefreshTokenAsync(new RefreshTokenRequest { RefreshToken = refreshToken }, ct);
        return ToCredential(response.AccessToken, response.RefreshToken, response.AccessTokenExpiry);
    }

    private static NawishtaCredential ToCredential(string? accessToken, string? refreshToken, DateTimeOffset? expiresAt)
    {
        if (string.IsNullOrWhiteSpace(accessToken) || string.IsNullOrWhiteSpace(refreshToken))
        {
            throw new InvalidOperationException("Nawishta did not return an access/refresh token.");
        }

        // Falls back to a conservative 5-minute assumed TTL if Nawishta ever omits accessTokenExpiry
        // (optional in the response DTO) - shorter than the documented 10-minute TTL so a caller
        // that trusts this value renews a bit early rather than risks trusting an already-expired
        // token for the next 10 minutes.
        var expiry = expiresAt ?? DateTimeOffset.UtcNow.AddMinutes(5);
        return new NawishtaCredential(accessToken, refreshToken, expiry.ToUnixTimeMilliseconds());
    }
}
