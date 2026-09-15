using Maktaba.Api.Dtos;
using Maktaba.Nawishta;
using Maktaba.Nawishta.Generated;

namespace Maktaba.Api.Endpoints;

/// <summary>
/// Nawishta epic #108 - login (email/password) and access-token renewal against a Nawishta server.
/// Deliberately doesn't touch the library registry/ICloudCredentialCache at all (compare
/// LibraryEndpoints.cs's POST /cloud) - unlike S3/Google Drive/OneDrive, actually registering and
/// opening a Nawishta-backed library needs a working IBookQueryService/etc. implementation against
/// it (#110), which doesn't exist yet. These endpoints only get the frontend as far as "authenticated,
/// here's your library list" for the connect form's picker step - see the design addendum on issue
/// #69.
/// </summary>
public static class NawishtaEndpoints
{
    public static void MapNawishtaEndpoints(this WebApplication app)
    {
        var group = app.MapGroup("/api/nawishta");

        group.MapPost("/login", async (NawishtaLoginRequestDto request, INawishtaAuthService auth, CancellationToken ct) =>
        {
            if (string.IsNullOrWhiteSpace(request.ServerUrl) || string.IsNullOrWhiteSpace(request.Email) || string.IsNullOrWhiteSpace(request.Password))
            {
                return Results.BadRequest(new { error = "Server URL, email, and password are all required." });
            }

            try
            {
                var result = await auth.LoginAsync(request.ServerUrl.Trim(), request.Email.Trim(), request.Password, ct);
                var dto = new NawishtaLoginResponseDto(
                    new NawishtaCredentialDto(result.Credential.AccessToken, result.Credential.RefreshToken, result.Credential.ExpiresAt),
                    ToDto(result.Libraries));
                return Results.Ok(dto);
            }
            catch (Exception ex)
            {
                return Results.BadRequest(new { error = DescribeNawishtaError(ex) });
            }
        });

        // Called when a cached access token is (or is about to be) expired - Nawishta's own is
        // short-lived (10 min) so this is expected to run far more often than a reconnect.
        group.MapPost("/refresh", async (NawishtaRefreshRequestDto request, INawishtaAuthService auth, CancellationToken ct) =>
        {
            if (string.IsNullOrWhiteSpace(request.ServerUrl) || string.IsNullOrWhiteSpace(request.RefreshToken))
            {
                return Results.BadRequest(new { error = "Server URL and refresh token are both required." });
            }

            try
            {
                var credential = await auth.RefreshAsync(request.ServerUrl.Trim(), request.RefreshToken, ct);
                return Results.Ok(new NawishtaCredentialDto(credential.AccessToken, credential.RefreshToken, credential.ExpiresAt));
            }
            catch (Exception ex)
            {
                return Results.BadRequest(new { error = DescribeNawishtaError(ex) });
            }
        });

        // Reuses an already-cached access token (from a previously-connected Nawishta library) to
        // list the account's libraries again, so "connect another library" from the same account
        // skips straight to the picker instead of asking for email/password a second time. A 401
        // here means the token has since expired - the frontend falls back to /refresh (using that
        // library's cached refresh token) or, failing that, the normal login form.
        group.MapPost("/libraries", async (NawishtaListLibrariesRequestDto request, INawishtaAuthService auth, CancellationToken ct) =>
        {
            if (string.IsNullOrWhiteSpace(request.ServerUrl) || string.IsNullOrWhiteSpace(request.AccessToken))
            {
                return Results.BadRequest(new { error = "Server URL and access token are both required." });
            }

            try
            {
                var page = await auth.ListLibrariesAsync(
                    request.ServerUrl.Trim(), request.AccessToken,
                    string.IsNullOrWhiteSpace(request.Query) ? null : request.Query.Trim(),
                    request.PageNumber ?? 1, request.PageSize ?? 20, ct);
                return Results.Ok(ToDto(page));
            }
            catch (Exception ex)
            {
                return Results.BadRequest(new { error = DescribeNawishtaError(ex) });
            }
        });
    }

    private static NawishtaLibraryPageDto ToDto(NawishtaLibraryPage page) => new(
        [.. page.Libraries.Select(l => new NawishtaLibrarySummaryDto(l.Id, l.Name, l.Description))],
        page.PageNumber, page.PageCount, page.TotalCount);

    private static string DescribeNawishtaError(Exception ex) => ex switch
    {
        NawishtaApiException { StatusCode: 401 or 403 } => "Invalid email or password.",
        NawishtaApiException { StatusCode: 404 } => "Nawishta server not found at this URL.",
        NawishtaApiException api => $"Nawishta server returned an error (HTTP {api.StatusCode}).",
        HttpRequestException => "Could not reach the Nawishta server - check the URL and your network connection.",
        InvalidOperationException => ex.Message,
        _ => "Could not connect to this Nawishta account.",
    };
}
