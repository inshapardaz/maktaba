using Maktaba.Api.Dtos;
using Maktaba.Core.Services;

namespace Maktaba.Api.Endpoints;

/// <summary>Issue #24: "find metadata online, pick a match, copy it into the book" - see
/// IMetadataLookupService's doc comment for why this is backed by Open Library rather than
/// Goodreads.</summary>
public static class MetadataEndpoints
{
    public static void MapMetadataEndpoints(this WebApplication app)
    {
        var group = app.MapGroup("/api/metadata");

        group.MapGet("/search", async (string? title, IMetadataLookupService lookup, CancellationToken ct) =>
        {
            if (string.IsNullOrWhiteSpace(title))
            {
                return Results.BadRequest(new { error = "Title is required." });
            }

            try
            {
                var results = await lookup.SearchAsync(title.Trim(), ct);
                return Results.Ok(results.Select(r =>
                    new MetadataSearchResultDto(r.Key, r.Title, [.. r.Authors], r.FirstPublishYear, r.CoverUrl, r.Isbn)));
            }
            catch (HttpRequestException)
            {
                return Results.Json(new { error = "Couldn't reach the metadata lookup service." }, statusCode: StatusCodes.Status503ServiceUnavailable);
            }
            catch (TaskCanceledException)
            {
                return Results.Json(new { error = "The metadata lookup timed out." }, statusCode: StatusCodes.Status503ServiceUnavailable);
            }
        });

        group.MapGet("/details", async (string? key, string? isbn, IMetadataLookupService lookup, CancellationToken ct) =>
        {
            if (string.IsNullOrWhiteSpace(key))
            {
                return Results.BadRequest(new { error = "key is required." });
            }

            try
            {
                var details = await lookup.GetDetailsAsync(key, isbn, ct);
                if (details is null)
                {
                    return Results.NotFound();
                }

                return Results.Ok(new MetadataDetailsDto(
                    details.Title, [.. details.Authors], details.Description, details.Publisher, details.PublishedDate, details.Isbn));
            }
            catch (HttpRequestException)
            {
                return Results.Json(new { error = "Couldn't reach the metadata lookup service." }, statusCode: StatusCodes.Status503ServiceUnavailable);
            }
            catch (TaskCanceledException)
            {
                return Results.Json(new { error = "The metadata lookup timed out." }, statusCode: StatusCodes.Status503ServiceUnavailable);
            }
        });
    }
}
